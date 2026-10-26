import { Prisma } from "@prisma/client";
import type { ClienteVenda, VendaCliente } from "@/server/contratos-clientes";
import { prisma } from "./database";
import { protectIdentity } from "./campaign-domain";
import { lockStore } from "./campaign-service";

const sameName = (a: string, b: string) =>
  a.normalize("NFKC").trim().toLocaleLowerCase("pt-BR") ===
  b.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
type Scope = { organizacaoId: string; storeId: string };
type Tx = Prisma.TransactionClient;
async function audit(tx: Tx, scope: Scope, entityId: string, action: string) {
  await tx.crmAuditEvent.create({
    data: {
      storeId: scope.storeId,
      actorId: "system:saipos",
      entityType: "SaiposCustomerImport",
      entityId,
      action,
      data: { source: "SAIPOS" },
    },
  });
}
async function resolveContact(
  tx: Tx,
  scope: Scope,
  customer: ClienteVenda,
  updatedAt: Date,
) {
  const identity = protectIdentity(
    scope.storeId,
    "SAIPOS",
    customer.externalId,
  );
  const existing = await tx.crmIdentity.findUnique({
    where: {
      storeId_type_normalizedHash: {
        storeId: scope.storeId,
        type: "SAIPOS",
        normalizedHash: identity.normalizedHash,
      },
    },
    include: { contact: true },
  });
  if (existing) {
    const contact = existing.contact;
    if (!contact.active) return { contact: null, conflict: true };
    if (
      contact.saiposManaged &&
      (!contact.saiposUpdatedAt || updatedAt > contact.saiposUpdatedAt)
    ) {
      const occupied = customer.phone
        ? await tx.crmContact.findUnique({
            where: {
              storeId_phone: { storeId: scope.storeId, phone: customer.phone },
            },
          })
        : null;
      if (occupied && occupied.id !== contact.id)
        return { contact, conflict: true };
      await tx.crmContact.update({
        where: { id: contact.id },
        data: {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          saiposUpdatedAt: updatedAt,
        },
      });
      await audit(tx, scope, contact.id, "UPDATE_PROFILE");
    }
    return { contact, conflict: false };
  }
  const phoneMatch = customer.phone
    ? await tx.crmContact.findUnique({
        where: {
          storeId_phone: { storeId: scope.storeId, phone: customer.phone },
        },
        include: {
          identities: { where: { type: "SAIPOS" }, select: { id: true } },
        },
      })
    : null;
  // A shared phone is ambiguous: never merge different names or provider IDs.
  if (
    phoneMatch &&
    (!phoneMatch.active ||
      !sameName(phoneMatch.name, customer.name) ||
      phoneMatch.identities.length)
  )
    return { contact: null, conflict: true };
  const contact =
    phoneMatch ??
    (await tx.crmContact.create({
      data: {
        storeId: scope.storeId,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        saiposManaged: true,
        saiposUpdatedAt: updatedAt,
        marketingOptIn: false,
      },
    }));
  await tx.crmIdentity.create({
    data: {
      storeId: scope.storeId,
      contactId: contact.id,
      type: "SAIPOS",
      ...identity,
      verifiedAt: new Date(),
      verifiedById: "system:saipos",
    },
  });
  await audit(
    tx,
    scope,
    contact.id,
    phoneMatch ? "LINK_IDENTITY" : "CREATE_PROFILE",
  );
  return { contact, conflict: false };
}

export async function importSaiposCustomers(
  scope: Scope,
  rows: VendaCliente[],
  checkpoint?: (tx: Tx) => Promise<void>,
) {
  return prisma.$transaction(
    async (tx) => {
      await lockStore(tx, scope.storeId);
      if (
        !(await tx.unidade.findFirst({
          where: {
            id: scope.storeId,
            organizacaoId: scope.organizacaoId,
            ativa: true,
            excluidoEm: null,
            organizacao: { ativa: true, excluidoEm: null },
          },
          select: { id: true },
        }))
      )
        throw new Error("Unidade do CRM não autorizada.");
      let linked = 0,
        conflicts = 0;
      const latest = new Map<string, VendaCliente>();
      for (const row of rows) {
        const previous = latest.get(row.externalId);
        if (!previous || row.updatedAt >= previous.updatedAt)
          latest.set(row.externalId, row);
      }
      for (const row of latest.values()) {
        const key = {
          storeId: scope.storeId,
          source: "SAIPOS" as const,
          externalId: row.externalId,
        };
        const sale = await tx.crmSale.findUnique({
          where: { storeId_source_externalId: key },
        });
        if (sale?.providerUpdatedAt && sale.providerUpdatedAt > row.updatedAt)
          continue;
        const resolved = row.customer
          ? await resolveContact(tx, scope, row.customer, row.updatedAt)
          : { contact: null, conflict: false };
        const contactId = resolved.contact?.id ?? null;
        const conflict =
          resolved.conflict ||
          !!(
            sale?.crmContactId &&
            contactId &&
            sale.crmContactId !== contactId
          );
        if (conflict) conflicts++;
        const source = await tx.saiposVenda.findUnique({
          where: {
            organizacaoId_unidadeId_vendaExternaId: {
              organizacaoId: scope.organizacaoId,
              unidadeId: scope.storeId,
              vendaExternaId: row.externalId,
            },
          },
          select: { id: true },
        });
        const fields = {
          totalAmount: new Prisma.Decimal(row.totalCents).div(100),
          netRevenueCents: null,
          status: row.cancelled
            ? ("CANCELLED" as const)
            : ("COMPLETED" as const),
          soldAt: row.soldAt,
          shiftDate: row.shiftDate,
          providerUpdatedAt: row.updatedAt,
          ...(source ? { saiposVendaId: source.id } : {}),
          ...(!conflict && contactId && !sale?.crmContactId
            ? { crmContactId: contactId }
            : {}),
        };
        await tx.crmSale.upsert({
          where: { storeId_source_externalId: key },
          create: { ...key, ...fields, itemsJson: [] },
          update: fields,
        });
        if (contactId && !conflict) linked++;
        if (conflict)
          await audit(
            tx,
            scope,
            sale?.id ?? scope.storeId,
            "IDENTITY_CONFLICT",
          );
      }
      if (checkpoint) await checkpoint(tx);
      return { processed: latest.size, linked, conflicts };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
