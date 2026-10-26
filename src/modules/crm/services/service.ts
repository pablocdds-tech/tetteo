import { Prisma, IntegrationSource, CrmActivityType } from "@prisma/client";
import { prisma } from "./database";
import { crmSegment, normalizeBrazilPhone, CrmSegment } from "./domain";
import { lockStore, recordConsent } from "./campaign-service";

export interface ContactInput {
  storeId: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  marketingOptIn: boolean;
}

const contactSelect = {
  id: true,
  storeId: true,
  name: true,
  phone: true,
  email: true,
  notes: true,
  marketingOptIn: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function createContact(input: ContactInput, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await lockStore(tx, input.storeId);
    const contact = await tx.crmContact.create({
      data: { ...input, phone: normalizeBrazilPhone(input.phone) },
      select: contactSelect,
    });
    if (input.marketingOptIn)
      await recordConsent(
        tx,
        input.storeId,
        contact.id,
        actorId,
        "OPT_IN",
        "MANUAL_CONTACT",
        `manual:${actorId}`,
      );
    await tx.crmAuditEvent.create({
      data: {
        storeId: input.storeId,
        actorId,
        entityType: "CrmContact",
        entityId: contact.id,
        action: "CREATE",
        data: { marketingOptIn: input.marketingOptIn },
      },
    });
    return contact;
  });
}

export async function updateContact(
  storeId: string,
  id: string,
  data: Partial<Omit<ContactInput, "storeId">>,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    await lockStore(tx, storeId);
    const result = await tx.crmContact.updateMany({
      where: { id, storeId, active: true },
      data: {
        ...data,
        ...(["name", "phone", "email"].some((key) => key in data)
          ? { saiposManaged: false }
          : {}),
        ...(data.phone === undefined
          ? {}
          : { phone: normalizeBrazilPhone(data.phone) }),
      },
    });
    if (!result.count) return null;
    if (data.marketingOptIn !== undefined)
      await recordConsent(
        tx,
        storeId,
        id,
        actorId,
        data.marketingOptIn ? "OPT_IN" : "OPT_OUT",
        "MANUAL_CONTACT",
        data.marketingOptIn ? `manual:${actorId}` : undefined,
      );
    await tx.crmAuditEvent.create({
      data: {
        storeId,
        actorId,
        entityType: "CrmContact",
        entityId: id,
        action: "UPDATE",
        data: {
          fields: Object.keys(data),
          ...(data.marketingOptIn === undefined
            ? {}
            : { marketingOptIn: data.marketingOptIn }),
        },
      },
    });
    return tx.crmContact.findFirst({
      where: { id, storeId },
      select: contactSelect,
    });
  });
}

// Only completed, explicitly linked sales count toward customer behavior.
// Customer links come from a stable provider identity or an explicit manual link.
const statsCte = (scope: Prisma.Sql) => Prisma.sql`
  WITH stats AS (
    SELECT c."id", c."storeId", c."name", c."phone", c."email", c."marketingOptIn", c."createdAt",
      COUNT(s."id")::int AS purchases,
      COALESCE(SUM(s."totalAmount"), 0) AS spent,
      MIN(s."soldAt") AS "firstPurchaseAt", MAX(s."soldAt") AS "lastPurchaseAt"
    FROM "CrmContact" c
    LEFT JOIN "CrmSale" s ON s."storeId" = c."storeId" AND s."crmContactId" = c."id" AND s."status" = 'COMPLETED'
    WHERE c."active" = true AND ${scope}
    GROUP BY c."id"
  ), classified AS (
    SELECT *, CASE
      WHEN purchases = 0 THEN 'LEAD'
      WHEN "lastPurchaseAt" <= NOW() - INTERVAL '90 days' THEN 'LOST'
      WHEN "lastPurchaseAt" <= NOW() - INTERVAL '30 days' THEN 'AT_RISK'
      WHEN purchases = 1 THEN 'NEW'
      ELSE 'ACTIVE'
    END AS segment FROM stats
  )`;

type ContactRow = {
  id: string;
  storeId: string;
  name: string;
  phone: string;
  email: string | null;
  marketingOptIn: boolean;
  createdAt: Date;
  purchases: number;
  spent: Prisma.Decimal;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  segment: CrmSegment;
  total: bigint;
};

export async function listContacts(options: {
  storeIds: string[];
  allStores: boolean;
  search?: string;
  segment?: CrmSegment;
  marketingOnly?: boolean;
  minPurchases?: number;
  maxDaysSincePurchase?: number;
  minSpent?: number;
  page: number;
  pageSize: number;
}) {
  const scope =
    options.allStores && options.storeIds.length === 0
      ? Prisma.sql`TRUE`
      : options.storeIds.length
        ? Prisma.sql`c."storeId" IN (${Prisma.join(options.storeIds)})`
        : Prisma.sql`FALSE`;
  const escapedSearch = options.search?.replace(/[\\%_]/g, "\\$&");
  const phoneDigits = options.search?.replace(/\D/g, "") ?? "";
  const phoneSearch =
    phoneDigits.length >= 3
      ? Prisma.sql`OR "phone" LIKE ${`%${phoneDigits}%`}`
      : Prisma.empty;
  const search = escapedSearch
    ? Prisma.sql`AND ("name" ILIKE ${`%${escapedSearch}%`} ${phoneSearch} OR "email" ILIKE ${`%${escapedSearch}%`})`
    : Prisma.empty;
  const segment = options.segment
    ? Prisma.sql`AND segment = ${options.segment}`
    : Prisma.empty;
  const marketing = options.marketingOnly
    ? Prisma.sql`AND "marketingOptIn" = true`
    : Prisma.empty;
  const purchases =
    options.minPurchases === undefined
      ? Prisma.empty
      : Prisma.sql`AND purchases >= ${options.minPurchases}`;
  const spent =
    options.minSpent === undefined
      ? Prisma.empty
      : Prisma.sql`AND spent >= ${options.minSpent}`;
  const recency =
    options.maxDaysSincePurchase === undefined
      ? Prisma.empty
      : Prisma.sql`AND "lastPurchaseAt" >= NOW() - ${options.maxDaysSincePurchase} * INTERVAL '1 day'`;
  const rows = await prisma.$queryRaw<ContactRow[]>`${statsCte(scope)}
    SELECT *, COUNT(*) OVER() AS total FROM classified WHERE TRUE ${search} ${segment} ${marketing} ${purchases} ${spent} ${recency}
    ORDER BY "createdAt" DESC, "id" DESC LIMIT ${options.pageSize} OFFSET ${(options.page - 1) * options.pageSize}`;
  return {
    items: rows.map(({ total: _total, spent, ...row }) => ({
      ...row,
      spent: Number(spent),
    })),
    total: Number(rows[0]?.total ?? 0),
    page: options.page,
    pageSize: options.pageSize,
  };
}

export async function getCrmOverview(storeIds: string[], allStores: boolean) {
  const scope =
    allStores && storeIds.length === 0
      ? Prisma.sql`TRUE`
      : storeIds.length
        ? Prisma.sql`c."storeId" IN (${Prisma.join(storeIds)})`
        : Prisma.sql`FALSE`;
  const rows = await prisma.$queryRaw<
    Array<{ segment: CrmSegment; count: bigint; optedIn: bigint }>
  >`${statsCte(scope)}
    SELECT segment, COUNT(*) AS count, COUNT(*) FILTER (WHERE "marketingOptIn") AS "optedIn"
    FROM classified GROUP BY segment`;
  const counts: Record<CrmSegment, number> = {
    LEAD: 0,
    NEW: 0,
    ACTIVE: 0,
    AT_RISK: 0,
    LOST: 0,
  };
  let optedIn = 0;
  for (const row of rows) {
    counts[row.segment] = Number(row.count);
    optedIn += Number(row.optedIn);
  }
  return {
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    optedIn,
  };
}

export async function getCrmInsights(storeIds: string[], allStores: boolean) {
  const contactScope =
    allStores && !storeIds.length
      ? Prisma.sql`TRUE`
      : storeIds.length
        ? Prisma.sql`c."storeId" IN (${Prisma.join(storeIds)})`
        : Prisma.sql`FALSE`;
  const saleScope =
    allStores && !storeIds.length
      ? Prisma.sql`TRUE`
      : storeIds.length
        ? Prisma.sql`s."storeId" IN (${Prisma.join(storeIds)})`
        : Prisma.sql`FALSE`;
  const [contacts, sales] = await Promise.all([
    prisma.$queryRaw<
      Array<{ buyers: bigint; recurring: bigint }>
    >`${statsCte(contactScope)}
      SELECT COUNT(*) FILTER (WHERE purchases > 0) AS buyers,
        COUNT(*) FILTER (WHERE purchases > 1) AS recurring FROM stats`,
    prisma.$queryRaw<Array<{ total: bigint; identified: bigint }>>`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE identified) AS identified FROM (
        SELECT s."crmContactId" IS NOT NULL AS identified FROM "CrmSale" s
        WHERE s."status" = 'COMPLETED' AND s."saiposVendaId" IS NULL AND ${saleScope}
        UNION ALL
        SELECT EXISTS (SELECT 1 FROM "CrmSale" c WHERE c."saiposVendaId" = v.id
          AND c."storeId" = v."unidadeId" AND c."crmContactId" IS NOT NULL) AS identified
        FROM saipos_venda v WHERE v."unidadeId" IN (${Prisma.join(storeIds.length ? storeIds : [""])})
          AND v.cancelada = false AND v."excluidoEm" IS NULL
      ) coverage`,
  ]);
  const buyers = Number(contacts[0]?.buyers ?? 0);
  const recurring = Number(contacts[0]?.recurring ?? 0);
  const totalSales = Number(sales[0]?.total ?? 0);
  const identifiedSales = Number(sales[0]?.identified ?? 0);
  return {
    buyers,
    recurring,
    repeatRate: buyers ? recurring / buyers : 0,
    totalSales,
    identifiedSales,
    identificationRate: totalSales ? identifiedSales / totalSales : 0,
  };
}

export async function getContact(storeId: string, id: string) {
  const contact = await prisma.crmContact.findFirst({
    where: { id, storeId, active: true },
    select: contactSelect,
  });
  if (!contact) return null;
  const where = { storeId, crmContactId: id, status: "COMPLETED" as const };
  const [aggregate, sales, activities] = await Promise.all([
    prisma.crmSale.aggregate({
      where,
      _count: { id: true },
      _sum: { totalAmount: true },
      _min: { soldAt: true },
      _max: { soldAt: true },
    }),
    prisma.crmSale.findMany({
      where: { storeId, crmContactId: id },
      orderBy: { soldAt: "desc" },
      take: 50,
      select: {
        id: true,
        source: true,
        externalId: true,
        totalAmount: true,
        status: true,
        soldAt: true,
      },
    }),
    prisma.crmActivity.findMany({
      where: { storeId, contactId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        summary: true,
        createdAt: true,
        createdBy: { select: { nome: true } },
      },
    }),
  ]);
  return {
    ...contact,
    metrics: {
      purchases: aggregate._count.id,
      spent: Number(aggregate._sum.totalAmount ?? 0),
      firstPurchaseAt: aggregate._min.soldAt,
      lastPurchaseAt: aggregate._max.soldAt,
      segment: crmSegment(aggregate._count.id, aggregate._max.soldAt),
    },
    sales: sales.map((sale) => ({
      ...sale,
      totalAmount: Number(sale.totalAmount),
    })),
    activities: activities.map(({ createdBy, ...activity }) => ({
      ...activity,
      createdBy: createdBy.nome,
    })),
  };
}

export async function addActivity(
  storeId: string,
  contactId: string,
  type: CrmActivityType,
  summary: string,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const contact = await tx.crmContact.findFirst({
      where: { id: contactId, storeId },
      select: { id: true },
    });
    if (!contact) return null;
    const activity = await tx.crmActivity.create({
      data: { storeId, contactId, type, summary, createdById: actorId },
      select: { id: true, type: true, summary: true, createdAt: true },
    });
    await tx.crmAuditEvent.create({
      data: {
        storeId,
        actorId,
        entityType: "CrmActivity",
        entityId: activity.id,
        action: "CREATE",
        data: { contactId, type },
      },
    });
    return activity;
  });
}

export async function linkSale(
  storeId: string,
  contactId: string,
  source: IntegrationSource,
  externalId: string,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    await lockStore(tx, storeId);
    const contact = await tx.crmContact.findFirst({
      where: { id: contactId, storeId, active: true },
      select: { id: true },
    });
    if (!contact) return "CONTACT_NOT_FOUND" as const;
    if (source === "SAIPOS") {
      const original = await tx.saiposVenda.findFirst({
        where: {
          unidadeId: storeId,
          vendaExternaId: externalId,
          excluidoEm: null,
        },
      });
      if (!original) return "SALE_NOT_FOUND" as const;
      await tx.crmSale.upsert({
        where: { storeId_source_externalId: { storeId, source, externalId } },
        update: {},
        create: {
          storeId,
          source,
          externalId,
          saiposVendaId: original.id,
          totalAmount: new Prisma.Decimal(original.totalCentavos).div(100),
          netRevenueCents: null,
          status: original.cancelada ? "CANCELLED" : "COMPLETED",
          soldAt: original.criadaNoSaiposEm,
          itemsJson: [],
        },
      });
    }
    const sale = await tx.crmSale.findUnique({
      where: { storeId_source_externalId: { storeId, source, externalId } },
      select: { id: true, crmContactId: true },
    });
    if (!sale) return "SALE_NOT_FOUND" as const;
    if (sale.crmContactId && sale.crmContactId !== contactId)
      return "ALREADY_LINKED" as const;
    if (!sale.crmContactId) {
      const updated = await tx.crmSale.updateMany({
        where: { id: sale.id, storeId, crmContactId: null },
        data: { crmContactId: contactId },
      });
      if (!updated.count) return "ALREADY_LINKED" as const;
      await tx.crmAuditEvent.create({
        data: {
          storeId,
          actorId,
          entityType: "Sale",
          entityId: sale.id,
          action: "CRM_LINK",
          data: { contactId },
        },
      });
      await tx.crmSegmentJob.create({ data: { storeId, actorId } });
    }
    return "OK" as const;
  });
}
