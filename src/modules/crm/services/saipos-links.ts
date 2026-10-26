import { prisma } from "./database";

// Copy only explicitly identified sales. This projection never writes Analytics.
// Cancellations and revised totals are refreshed before CRM metrics are queried.
export async function syncSaiposLinks(storeId: string) {
  await prisma.$executeRaw`
    UPDATE "CrmSale" c SET
      "totalAmount" = s."totalCentavos"::numeric / 100,
      "netRevenueCents" = NULL,
      "status" = CASE WHEN s.cancelada OR s."excluidoEm" IS NOT NULL THEN 'CANCELLED'::"SaleStatus" ELSE 'COMPLETED'::"SaleStatus" END,
      "soldAt" = s."criadaNoSaiposEm", "updatedAt" = NOW()
    FROM saipos_venda s
    WHERE c."storeId" = ${storeId} AND s."unidadeId" = c."storeId" AND s.id = c."saiposVendaId"
      AND (c."totalAmount" IS DISTINCT FROM s."totalCentavos"::numeric / 100
        OR c.status::text IS DISTINCT FROM CASE WHEN s.cancelada OR s."excluidoEm" IS NOT NULL THEN 'CANCELLED' ELSE 'COMPLETED' END
        OR c."soldAt" IS DISTINCT FROM s."criadaNoSaiposEm")`;
}
