import { Prisma } from "@prisma/client";
import { prisma } from "./database";
import {
  aggregateOutcomes,
  audit,
  hasConsent,
  lockStore,
  processImport,
  segmentPage,
} from "./campaign-service";
import { operationalDate } from "./campaign-domain";

export interface LocalAdapter {
  send(
    tx: Prisma.TransactionClient,
    deliveryId: string,
  ): Promise<{ providerId: string; acceptedAt: Date }>;
  reconcile(
    deliveryId: string,
  ): Promise<{ providerId: string; acceptedAt: Date } | null>;
}

// There is no network transport here. A receipt is simulation evidence only.
export const localAdapter: LocalAdapter = {
  async send(tx, deliveryId) {
    return tx.crmLocalReceipt.upsert({
      where: { deliveryId },
      update: {},
      create: { deliveryId, providerId: `local:${deliveryId}` },
    });
  },
  reconcile: (deliveryId) =>
    prisma.crmLocalReceipt.findUnique({ where: { deliveryId } }),
};

function setting(name: string, fallback: number, min: number, max: number) {
  const value =
    process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error("Configuração de frequência ou horário do CRM inválida.");
  return value;
}

export async function processDelivery(
  id: string,
  now = new Date(),
  adapter = localAdapter,
) {
  const candidate = await prisma.crmDelivery.findUnique({
    where: { id },
    include: { assignment: { include: { experiment: true } } },
  });
  if (!candidate || candidate.state !== "PENDING") return;
  const experiment = candidate.assignment.experiment;
  if (
    experiment.status !== "RUNNING" ||
    now < experiment.startAt ||
    now >= experiment.endAt
  )
    return;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  const startHour = setting("CRM_SEND_HOUR_START", 8, 0, 23),
    endHour = setting("CRM_SEND_HOUR_END", 20, 1, 24);
  const minHours = setting("CRM_MIN_HOURS_BETWEEN_SENDS", 24, 1, 720);
  if (endHour <= startHour || hour < startHour || hour >= endHour) return;
  // Atomic claim is committed before calling the adapter. An interrupted claim
  // is UNCERTAIN and can only be resolved against provider history.
  const claim = await prisma.crmDelivery.updateMany({
    where: { id, state: "PENDING" },
    data: { state: "CLAIMED", claimedAt: now },
  });
  if (!claim.count) return;
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockStore(tx, candidate.storeId);
        const delivery = await tx.crmDelivery.findUniqueOrThrow({
          where: { id },
          include: {
            assignment: { include: { contact: true, experiment: true } },
          },
        });
        if (delivery.state !== "CLAIMED") return;
        const { assignment } = delivery,
          current = assignment.experiment;
        const approval = await tx.crmApproval.findUnique({
          where: {
            experimentId_version: {
              experimentId: current.id,
              version: current.version,
            },
          },
        });
        let blocked: string | null = null;
        if (
          assignment.arm !== "TREATMENT" ||
          current.status !== "RUNNING" ||
          approval?.previewHash !== current.previewHash ||
          delivery.messageVersion !== current.messageVersion
        )
          blocked = "NOT_APPROVED";
        if (
          !assignment.contact.active ||
          !assignment.contact.phone ||
          !(await hasConsent(
            tx,
            delivery.storeId,
            assignment.contactId,
            assignment.contact.marketingOptIn,
          ))
        )
          blocked = "OPT_OUT";
        const previous = await tx.crmDelivery.findFirst({
          where: {
            storeId: delivery.storeId,
            id: { not: id },
            state: { in: ["SIMULATED", "UNCERTAIN", "CLAIMED"] },
            assignment: { contactId: assignment.contactId },
            OR: [
              {
                sentAt: { gte: new Date(now.getTime() - minHours * 3_600_000) },
              },
              {
                claimedAt: {
                  gte: new Date(now.getTime() - minHours * 3_600_000),
                },
              },
            ],
          },
        });
        if (previous) blocked = "FREQUENCY_LIMIT";
        if (blocked) {
          await tx.crmDelivery.update({
            where: { id },
            data: { state: "BLOCKED", failedCode: blocked },
          });
          return;
        }
        const receipt = await adapter.send(tx, id);
        await tx.crmDelivery.update({
          where: { id },
          data: {
            state: "SIMULATED",
            providerId: receipt.providerId,
            sentAt: now,
            costCents: current.unitCostCents,
          },
        });
        await audit(
          tx,
          delivery.storeId,
          current.createdById,
          "CrmDelivery",
          id,
          "SIMULATE",
          { version: current.version, experimentId: current.id },
        );
      },
      { timeout: 10_000 },
    );
  } catch {
    // A timeout can follow acceptance. Never return this recipient to PENDING.
    await prisma.crmDelivery.updateMany({
      where: { id, state: "CLAIMED" },
      data: {
        state: "UNCERTAIN",
        failedCode: "RECONCILIATION_REQUIRED",
        sentAt: now,
        costCents: experiment.unitCostCents,
      },
    });
  }
}

export async function reconcileDelivery(id: string, adapter = localAdapter) {
  const receipt = await adapter.reconcile(id);
  if (!receipt) return { reconciled: false };
  const result = await prisma.crmDelivery.updateMany({
    where: { id, state: "UNCERTAIN" },
    data: {
      state: "SIMULATED",
      providerId: receipt.providerId,
      failedCode: null,
    },
  });
  return { reconciled: result.count === 1 };
}

let busy = false;
export async function runCrmJobs(now = new Date()) {
  if (busy) return;
  busy = true;
  try {
    const imports = await prisma.crmImport.findMany({
      where: { status: "ACCEPTED" },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { id: true },
    });
    for (const batch of imports) await processImport(batch.id);
    const jobs = await prisma.crmSegmentJob.findMany({
      where: { status: { in: ["ACCEPTED", "RUNNING"] } },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { id: true },
    });
    for (const job of jobs) await segmentPage(job.id);
    await prisma.$executeRaw`UPDATE "CrmDelivery" d SET state = 'UNCERTAIN', "failedCode" = 'INTERRUPTED_CLAIM', "sentAt" = d."claimedAt", "costCents" = e."unitCostCents"
      FROM "CrmAssignment" a JOIN "CrmExperiment" e ON e.id = a."experimentId" AND e."storeId" = a."storeId"
      WHERE d."assignmentId" = a.id AND d."storeId" = a."storeId" AND d.state = 'CLAIMED' AND d."claimedAt" < (${new Date(now.getTime() - 60_000)}::timestamptz AT TIME ZONE 'UTC')`;
    const uncertain = await prisma.crmDelivery.findMany({
      where: { state: "UNCERTAIN" },
      take: 25,
      select: { id: true },
    });
    for (const delivery of uncertain) await reconcileDelivery(delivery.id);
    if (process.env.CRM_LOCAL_DELIVERY_ENABLED === "true") {
      const pending = await prisma.crmDelivery.findMany({
        where: {
          state: "PENDING",
          assignment: {
            experiment: {
              status: "RUNNING",
              startAt: { lte: now },
              endAt: { gt: now },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        take: 25,
        select: { id: true },
      });
      for (const delivery of pending) await processDelivery(delivery.id, now);
    }
    // Reprocess CLOSED as well, so a later reversal changes the next aggregate.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const due = await prisma.crmExperiment.findMany({
      where: {
        status: { in: ["RUNNING", "CLOSED"] },
        endAt: { lte: now },
        OR: [
          { lastCalculatedAt: null },
          { lastCalculatedAt: { lt: operationalDate(today) } },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: 5,
      select: { id: true },
    });
    for (const experiment of due) await aggregateOutcomes(experiment.id, now);
  } finally {
    busy = false;
  }
}

export function startCrmJobs() {
  if (process.env.CRM_JOBS_ENABLED !== "true") return () => undefined;
  const timer = setInterval(() => {
    void runCrmJobs().catch(() =>
      console.error(
        "[crm/jobs] Falha ao processar tarefas; consulte o estado dos lotes.",
      ),
    );
  }, 5_000);
  timer.unref();
  return () => clearInterval(timer);
}
