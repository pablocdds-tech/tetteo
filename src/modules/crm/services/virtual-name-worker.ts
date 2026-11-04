import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import type { ChannelManagementFactory } from "@/server/atendimento-provedor";
import { applyVirtualCustomerName } from "./virtual-name-state";

const responseSchema = z
  .object({
    trustedPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    names: z
      .array(
        z
          .object({
            name: z.string().max(500),
            source: z.enum([
              "DEVICE_CONTACT",
              "PROVIDER_CONTACT",
              "WHATSAPP_PROFILE",
            ]),
            updatedAt: z.string().datetime().nullable(),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();

/** A durable lookup per conversation; HTTP is outside transactions and never sends. */
export async function processVirtualNameLookups(
  factory: ChannelManagementFactory,
  accountId?: string,
) {
  const rows = await db.avConversation.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      account: {
        mode: "EVOLUTION",
        store: {
          ativa: true,
          excluidoEm: null,
          organizacao: { ativa: true, excluidoEm: null },
        },
        connection: {
          is: { connectionState: "VERIFIED", verifiedAt: { not: null } },
        },
      },
      nameLookupAttempts: { lt: 3 },
      AND: [
        {
          OR: [
            { nameLookupRevision: null, nameLookupAfter: null },
            { nameLookupAfter: { lte: new Date() } },
          ],
        },
        {
          OR: [
            { nameLookupLeaseUntil: null },
            { nameLookupLeaseUntil: { lte: new Date() } },
          ],
        },
      ],
    },
    orderBy: [{ pendingSince: "asc" }, { updatedAt: "asc" }],
    take: 3,
    include: { account: { include: { connection: true } } },
  });
  let completed = 0;
  for (const row of rows) {
    const revision = row.account.connection?.revision;
    if (
      !revision ||
      revision !== row.account.connection?.verifiedRevision ||
      !/^\+[1-9]\d{7,14}$/.test(row.externalCustomerId)
    )
      continue;
    const owner = randomUUID();
    const claimed = await db.$queryRaw<{ id: string }[]>`
      UPDATE "AvConversation" SET "nameLookupLeaseOwner"=${owner}, "nameLookupLeaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+INTERVAL '60 seconds', "nameLookupAttempts"="nameLookupAttempts"+1, "nameLookupLastAt"=(clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id"=${row.id} AND "organizationId"=${row.organizationId} AND "storeId"=${row.storeId} AND "accountId"=${row.accountId}
        AND "nameLookupAttempts"<3 AND (("nameLookupRevision" IS NULL AND "nameLookupAfter" IS NULL) OR "nameLookupAfter"<=(clock_timestamp() AT TIME ZONE 'UTC'))
        AND ("nameLookupLeaseUntil" IS NULL OR "nameLookupLeaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC')) RETURNING "id"
    `;
    if (!claimed.length) continue;
    try {
      const adapter = await factory(row.accountId),
        identity = adapter.identify();
      if (
        identity.mode !== "EVOLUTION" ||
        identity.accountKey !== row.accountId ||
        identity.revision !== revision ||
        !adapter.lookupContactNames
      )
        throw new Error("NAME_LOOKUP_UNAVAILABLE");
      const result = responseSchema.parse(
        await adapter.lookupContactNames({
          trustedPhone: row.externalCustomerId,
        }),
      );
      if (result.trustedPhone !== row.externalCustomerId)
        throw new Error("NAME_PHONE_MISMATCH");
      await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${row.accountId}`}))`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:conversation:${row.id}`}))`;
          const owned = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM "AvConversation" WHERE "id"=${row.id} AND "organizationId"=${row.organizationId} AND "storeId"=${row.storeId} AND "accountId"=${row.accountId} AND "nameLookupLeaseOwner"=${owner} AND "nameLookupLeaseUntil">(clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
          const connection = await tx.avChannelConnection.findFirst({
            where: {
              organizationId: row.organizationId,
              storeId: row.storeId,
              accountId: row.accountId,
              revision,
              verifiedRevision: revision,
              connectionState: "VERIFIED",
            },
            select: { id: true },
          });
          if (!owned.length || !connection)
            throw new Error("NAME_LOOKUP_STALE");
          const current = await tx.avConversation.findUniqueOrThrow({
            where: { id: row.id },
          });
          if (current.externalCustomerId !== result.trustedPhone)
            throw new Error("NAME_LOOKUP_STALE");
          await applyVirtualCustomerName(tx, current, undefined, result.names);
          await tx.avConversation.update({
            where: { id: row.id },
            data: {
              nameLookupRevision: revision,
              nameLookupAfter: null,
              nameLookupLastAt: new Date(),
              nameLookupLeaseOwner: null,
              nameLookupLeaseUntil: null,
              nameLookupAttempts: 0,
              nameLookupError: null,
            },
          });
        },
        { timeout: 20000 },
      );
      completed++;
    } catch {
      await db.avConversation.updateMany({
        where: {
          id: row.id,
          organizationId: row.organizationId,
          storeId: row.storeId,
          accountId: row.accountId,
          nameLookupLeaseOwner: owner,
        },
        data: {
          nameLookupLeaseOwner: null,
          nameLookupLeaseUntil: null,
          nameLookupAfter: new Date(Date.now() + 10000),
          nameLookupLastAt: new Date(),
          nameLookupError:
            "Não foi possível atualizar o nome do contato no WhatsApp.",
        },
      });
    }
  }
  return completed;
}

const state = globalThis as unknown as {
  virtualNameTimer?: ReturnType<typeof setInterval>;
};
export function startVirtualNameWorker(factory: ChannelManagementFactory) {
  if (
    process.env.AV_NAMES_WORKER_ENABLED === "false" ||
    process.env.NODE_ENV === "test" ||
    state.virtualNameTimer
  )
    return;
  let active = false;
  state.virtualNameTimer = setInterval(() => {
    if (active) return;
    active = true;
    void processVirtualNameLookups(factory)
      .catch(() =>
        console.error(
          "[atendimento-nomes] Atualização pendente; nenhuma mensagem enviada.",
        ),
      )
      .finally(() => {
        active = false;
      });
  }, 1000);
  state.virtualNameTimer.unref();
}
