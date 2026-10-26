import { prisma } from "./database";
import {
  aggregateOutcomes,
  processImport,
  segmentPage,
} from "./campaign-service";
import { syncSaiposLinks } from "./saipos-links";
import { processDelivery, reconcileDelivery } from "./campaign-worker";

// Request-scoped processing: no process timers or privileged cross-tenant worker.
// Each polling request advances at most one page in the authorized unit.
export async function advanceCrmJobs(storeId: string) {
  await syncSaiposLinks(storeId);
  if (process.env.CRM_LOCAL_DELIVERY_ENABLED === "true") {
    // A process can stop after committing a claim. It must never be retried
    // blindly: mark uncertain and reconcile only against the local receipt.
    const cutoff = new Date(Date.now() - 60_000);
    await prisma.$executeRaw`UPDATE "CrmDelivery" d
      SET state = 'UNCERTAIN', "failedCode" = 'INTERRUPTED_CLAIM',
        "sentAt" = d."claimedAt", "costCents" = e."unitCostCents"
      FROM "CrmAssignment" a JOIN "CrmExperiment" e
        ON e.id = a."experimentId" AND e."storeId" = a."storeId"
      WHERE d."storeId" = ${storeId} AND d."assignmentId" = a.id
        AND d."storeId" = a."storeId" AND d.state = 'CLAIMED'
        AND d."claimedAt" < (${cutoff}::timestamptz AT TIME ZONE 'UTC')`;
    const uncertain = await prisma.crmDelivery.findMany({
      where: { storeId, state: "UNCERTAIN" },
      take: 10,
      select: { id: true },
    });
    for (const delivery of uncertain) await reconcileDelivery(delivery.id);
    const pending = await prisma.crmDelivery.findMany({
      where: {
        storeId,
        state: "PENDING",
        assignment: {
          experiment: {
            status: "RUNNING",
            startAt: { lte: new Date() },
            endAt: { gt: new Date() },
          },
        },
      },
      take: 10,
      select: { id: true },
    });
    for (const delivery of pending) await processDelivery(delivery.id);
  }
  const batch = await prisma.crmImport.findFirst({
    where: { storeId, status: "ACCEPTED" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (batch) await processImport(batch.id);
  const job = await prisma.crmSegmentJob.findFirst({
    where: { storeId, status: { in: ["ACCEPTED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (job) await segmentPage(job.id);
  const due = await prisma.crmExperiment.findFirst({
    where: {
      storeId,
      status: { in: ["RUNNING", "CLOSED"] },
      endAt: { lte: new Date() },
    },
    orderBy: { updatedAt: "asc" },
    select: { id: true },
  });
  if (due) await aggregateOutcomes(due.id);
}
