import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "./database";
import {
  assignArm,
  canonicalHash,
  compareGroups,
  CrmError,
  GroupResult,
  operationalDate,
  protectIdentity,
  retentionSegment,
  RULE_VERSION,
  SEGMENTS,
} from "./campaign-domain";

type Tx = Prisma.TransactionClient;
export type CampaignInput = {
  name: string;
  objective: string;
  segment: string;
  startDate: string;
  endDate: string;
  message: string;
  benefit: string;
  costBudgetCents: number;
  unitCostCents: number;
  fixedCostCents: number;
};
export type ImportRow = {
  externalId: string;
  externalCustomerId: string;
  occurredAt: string;
  netRevenueCents: number;
  reversed: boolean;
  revision: number;
  reason: string;
};
type StoredRow = Omit<ImportRow, "externalCustomerId"> & { contactId: string };
export const lockStore = (tx: Tx, storeId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm:${storeId}`}))`;

export async function mutation(
  storeId: string,
  actorId: string,
  key: string,
  payload: unknown,
  work: (tx: Tx) => Promise<unknown>,
) {
  const payloadHash = canonicalHash(payload);
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await lockStore(tx, storeId);
          const previous = await tx.crmMutation.findUnique({
            where: { storeId_actorId_key: { storeId, actorId, key } },
          });
          if (previous) {
            if (previous.payloadHash !== payloadHash)
              throw new CrmError(
                "IDEMPOTENCY_CONFLICT",
                "Esta chave já foi usada com outros dados.",
              );
            return previous.result;
          }
          const result = JSON.parse(
            JSON.stringify(await work(tx)),
          ) as Prisma.InputJsonValue;
          await tx.crmMutation.create({
            data: { storeId, actorId, key, payloadHash, result },
          });
          return result;
        },
        { isolationLevel: "Serializable", timeout: 20_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3
      )
        continue;
      throw error;
    }
  }
}

export function audit(
  tx: Tx,
  storeId: string,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  data: Prisma.InputJsonValue = {},
) {
  return tx.crmAuditEvent.create({
    data: { storeId, actorId, entityType, entityId, action, data },
  });
}

export async function requireExperiment(tx: Tx, storeId: string, id: string) {
  const experiment = await tx.crmExperiment.findFirst({
    where: { id, storeId },
  });
  if (!experiment)
    throw new CrmError("NOT_FOUND", "Campanha não encontrada nesta loja.", 404);
  return experiment;
}

export async function recordConsent(
  tx: Tx,
  storeId: string,
  contactId: string,
  actorId: string,
  status: "OPT_IN" | "OPT_OUT",
  source: string,
  proofRef?: string,
  channel = "LOCAL",
) {
  const contact = await tx.crmContact.findFirst({
    where: { id: contactId, storeId, active: true },
  });
  if (!contact)
    throw new CrmError("NOT_FOUND", "Contato não encontrado nesta loja.", 404);
  if (status === "OPT_IN" && !proofRef)
    throw new CrmError(
      "PROOF_REQUIRED",
      "Informe a referência do consentimento para autorizar este canal.",
      400,
    );
  const event = await tx.crmConsent.create({
    data: { storeId, contactId, actorId, status, source, proofRef, channel },
  });
  await tx.crmContact.update({
    where: { id: contactId },
    data: { marketingOptIn: status === "OPT_IN" },
  });
  await audit(tx, storeId, actorId, "CrmConsent", event.id, status, {
    contactId,
    channel,
    source,
  });
  return { id: event.id, status: event.status, effectiveAt: event.effectiveAt };
}

export async function registerIdentity(
  tx: Tx,
  storeId: string,
  contactId: string,
  actorId: string,
  type: string,
  value: string,
) {
  if (
    !(await tx.crmContact.findFirst({
      where: { id: contactId, storeId, active: true },
    }))
  )
    throw new CrmError("NOT_FOUND", "Contato não encontrado.", 404);
  const protectedValue = protectIdentity(storeId, type, value);
  const existing = await tx.crmIdentity.findUnique({
    where: {
      storeId_type_normalizedHash: {
        storeId,
        type,
        normalizedHash: protectedValue.normalizedHash,
      },
    },
  });
  if (existing && existing.contactId !== contactId)
    throw new CrmError(
      "IDENTITY_CONFLICT",
      "Identificador vinculado a outra pessoa. Confira as fichas e confirme a unificação.",
    );
  const identity =
    existing ??
    (await tx.crmIdentity.create({
      data: {
        storeId,
        contactId,
        type,
        ...protectedValue,
        verifiedAt: new Date(),
        verifiedById: actorId,
      },
    }));
  await audit(tx, storeId, actorId, "CrmIdentity", identity.id, "VERIFY", {
    contactId,
    type,
  });
  return { id: identity.id, contactId, type, verifiedAt: identity.verifiedAt };
}

export async function mergeContacts(
  tx: Tx,
  storeId: string,
  sourceId: string,
  targetId: string,
  actorId: string,
  reason: string,
) {
  if (sourceId === targetId)
    throw new CrmError("INVALID_MERGE", "Escolha duas fichas diferentes.", 400);
  const contacts = await tx.crmContact.findMany({
    where: { id: { in: [sourceId, targetId] }, storeId, active: true },
  });
  if (contacts.length !== 2)
    throw new CrmError(
      "NOT_FOUND",
      "As duas fichas precisam pertencer a esta loja.",
      404,
    );
  if (
    await tx.crmAssignment.count({
      where: { storeId, contactId: { in: [sourceId, targetId] } },
    })
  )
    throw new CrmError(
      "FROZEN_CUSTOMER",
      "Há público congelado envolvendo estas fichas. A unificação exige revisão dos experimentos e fica bloqueada.",
    );
  await tx.crmSale.updateMany({
    where: { storeId, crmContactId: sourceId },
    data: { crmContactId: targetId },
  });
  await tx.crmIdentity.updateMany({
    where: { storeId, contactId: sourceId },
    data: { contactId: targetId },
  });
  await tx.crmContact.update({
    where: { id: sourceId },
    data: { active: false, mergedIntoId: targetId, marketingOptIn: false },
  });
  await tx.crmSegmentSnapshot.deleteMany({
    where: { storeId, contactId: { in: [sourceId, targetId] } },
  });
  await tx.crmContact.update({
    where: { id: targetId },
    data: { saiposManaged: false },
  });
  // No consent is inherited by a merge. Historical events stay on their original record.
  await recordConsent(
    tx,
    storeId,
    targetId,
    actorId,
    "OPT_OUT",
    "MERGE_REVIEW",
  );
  await audit(tx, storeId, actorId, "CrmContact", sourceId, "MERGE", {
    targetId,
    reason,
  });
  return { merged: true, targetId, requiresNewConsent: true };
}

export async function acceptImport(
  tx: Tx,
  storeId: string,
  actorId: string,
  rows: ImportRow[],
) {
  const stored: StoredRow[] = [];
  const errors: { line: number; code: string }[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const hash = protectIdentity(
      storeId,
      "LOCAL_JSON",
      row.externalCustomerId,
    ).normalizedHash;
    const identity = await tx.crmIdentity.findUnique({
      where: {
        storeId_type_normalizedHash: {
          storeId,
          type: "LOCAL_JSON",
          normalizedHash: hash,
        },
      },
      include: { contact: true },
    });
    if (!identity?.contact.active) {
      errors.push({ line: index + 1, code: "VERIFIED_IDENTITY_REQUIRED" });
      continue;
    }
    if (seen.has(row.externalId)) {
      errors.push({ line: index + 1, code: "DUPLICATE_ROW" });
      continue;
    }
    seen.add(row.externalId);
    const { externalCustomerId: _privateIdentifier, ...fields } = row;
    stored.push({ ...fields, contactId: identity.contactId });
  }
  const batch = await tx.crmImport.create({
    data: {
      storeId,
      actorId,
      rows: stored,
      errors,
      status: errors.length ? "FAILED" : "ACCEPTED",
    },
  });
  await audit(tx, storeId, actorId, "CrmImport", batch.id, "ACCEPT", {
    lines: rows.length,
    rejected: errors.length,
  });
  return { importId: batch.id, status: batch.status, errors };
}

export async function processImport(id: string) {
  const batch = await prisma.crmImport.findUniqueOrThrow({ where: { id } });
  const started = Date.now();
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockStore(tx, batch.storeId);
        const claimed = await tx.crmImport.updateMany({
          where: { id, status: "ACCEPTED" },
          data: { status: "VALIDATED" },
        });
        if (!claimed.count) return;
        let applied = 0;
        const rows = batch.rows as unknown as StoredRow[];
        for (const row of rows) {
          const key = {
            storeId: batch.storeId,
            source: "GENERIC_WEBHOOK" as const,
            externalId: `crm-json:${row.externalId}`,
          };
          const current = await tx.crmSale.findUnique({
            where: { storeId_source_externalId: key },
          });
          const previousRevision = await tx.crmVisitRevision.findFirst({
            where: { storeId: batch.storeId, saleId: current?.id ?? "" },
            orderBy: { revision: "desc" },
          });
          const next = {
            contactId: row.contactId,
            occurredAt: new Date(row.occurredAt).toISOString(),
            netRevenueCents: row.netRevenueCents,
            reversed: row.reversed,
            revision: row.revision,
          };
          if (current && previousRevision) {
            const before = previousRevision.after as unknown as typeof next;
            if (canonicalHash(before) === canonicalHash(next)) continue;
            if (row.revision <= before.revision)
              throw new CrmError(
                "STALE_REVISION",
                "Correção exige uma revisão maior que a anterior.",
              );
            if (current.crmContactId !== row.contactId)
              throw new CrmError(
                "IDENTITY_CONFLICT",
                "A visita já pertence a outra pessoa.",
              );
          }
          const fields = {
            crmContactId: row.contactId,
            totalAmount: new Prisma.Decimal(row.netRevenueCents).div(100),
            netRevenueCents: row.netRevenueCents,
            status: row.reversed
              ? ("CANCELLED" as const)
              : ("COMPLETED" as const),
            soldAt: new Date(row.occurredAt),
            itemsJson: [],
          };
          const sale = await tx.crmSale.upsert({
            where: { storeId_source_externalId: key },
            create: { ...key, ...fields },
            update: fields,
          });
          await tx.crmVisitRevision.create({
            data: {
              storeId: batch.storeId,
              saleId: sale.id,
              importId: id,
              actorId: batch.actorId,
              before: previousRevision?.after ?? Prisma.JsonNull,
              after: next,
              reason: row.reason,
              revision: row.revision,
            },
          });
          applied++;
        }
        await tx.crmImport.update({
          where: { id },
          data: {
            status: "APPLIED",
            applied,
            durationMs: Date.now() - started,
          },
        });
        await tx.crmSegmentJob.create({
          data: { storeId: batch.storeId, actorId: batch.actorId },
        });
        await audit(
          tx,
          batch.storeId,
          batch.actorId,
          "CrmImport",
          id,
          "APPLY",
          { applied },
        );
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    await prisma.crmImport.updateMany({
      where: { id, status: "ACCEPTED" },
      data: {
        status: "FAILED",
        durationMs: Date.now() - started,
        errors: [
          {
            code: error instanceof CrmError ? error.code : "IMPORT_FAILED",
            message:
              "Lote não aplicado. Corrija a origem e importe uma nova revisão.",
          },
        ],
      },
    });
  }
}

export async function segmentPage(jobId: string, pageSize = 100) {
  return prisma.$transaction(
    async (tx) => {
      const job = await tx.crmSegmentJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      await lockStore(tx, job.storeId);
      const fresh = await tx.crmSegmentJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      if (fresh.status === "APPLIED") return { done: true };
      const contacts = await tx.crmContact.findMany({
        where: {
          storeId: job.storeId,
          active: true,
          createdAt: { lte: job.asOf },
          ...(fresh.cursor ? { id: { gt: fresh.cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: pageSize,
        select: { id: true },
      });
      const stats = await tx.crmSale.groupBy({
        by: ["crmContactId"],
        where: {
          storeId: job.storeId,
          crmContactId: { in: contacts.map((c) => c.id) },
          status: "COMPLETED",
          soldAt: { lte: job.asOf },
        },
        _count: { id: true },
        _max: { soldAt: true },
      });
      const byId = new Map(stats.map((s) => [s.crmContactId, s]));
      for (const contact of contacts) {
        const stat = byId.get(contact.id);
        const visits = stat?._count.id ?? 0,
          lastVisitAt = stat?._max.soldAt ?? null;
        const data = {
          storeId: job.storeId,
          visits,
          lastVisitAt,
          segment: retentionSegment(visits, lastVisitAt, job.asOf),
          asOf: job.asOf,
          ruleVersion: RULE_VERSION,
        };
        const existing = await tx.crmSegmentSnapshot.findUnique({
          where: { contactId: contact.id },
        });
        if (!existing || existing.asOf <= job.asOf)
          await tx.crmSegmentSnapshot.upsert({
            where: { contactId: contact.id },
            create: { contactId: contact.id, ...data },
            update: data,
          });
      }
      const done = contacts.length < pageSize;
      await tx.crmSegmentJob.update({
        where: { id: jobId },
        data: {
          cursor: contacts.at(-1)?.id ?? fresh.cursor,
          status: done ? "APPLIED" : "RUNNING",
          processed: { increment: contacts.length },
        },
      });
      return { done };
    },
    { timeout: 20_000 },
  );
}

export async function audienceOverview(storeId: string) {
  const [groups, stats, total, job, latestImport] = await Promise.all([
    prisma.crmSegmentSnapshot.groupBy({
      by: ["segment"],
      where: { storeId, contact: { active: true } },
      _count: { contactId: true },
    }),
    prisma.crmSegmentSnapshot.aggregate({
      where: { storeId, contact: { active: true } },
      _min: { asOf: true },
      _max: { asOf: true },
    }),
    prisma.crmContact.count({ where: { storeId, active: true } }),
    prisma.crmSegmentJob.findFirst({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, processed: true, asOf: true },
    }),
    prisma.crmImport.findFirst({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        applied: true,
        errors: true,
        durationMs: true,
        updatedAt: true,
      },
    }),
  ]);
  const counts = Object.fromEntries(SEGMENTS.map((s) => [s, 0]));
  for (const group of groups) counts[group.segment] = group._count.contactId;
  return {
    counts,
    total,
    covered: Object.values(counts).reduce((a, b) => a + b, 0),
    oldestSnapshotAt: stats._min.asOf,
    latestSnapshotAt: stats._max.asOf,
    ruleVersion: RULE_VERSION,
    job,
    latestImport,
    source:
      "Vendas concluídas e explicitamente vinculadas nesta loja; visitas históricas, sem somar outras lojas.",
  };
}

function campaignFields(input: CampaignInput) {
  const startAt = operationalDate(input.startDate),
    endAt = operationalDate(input.endDate);
  if (endAt <= startAt)
    throw new CrmError(
      "INVALID_WINDOW",
      "O fim exclusivo deve ser posterior ao início.",
      400,
    );
  if (endAt.getTime() - startAt.getTime() > 90 * 86_400_000)
    throw new CrmError("INVALID_WINDOW", "Use uma janela de até 90 dias.", 400);
  const { startDate: _start, endDate: _end, ...fields } = input;
  return { ...fields, startAt, endAt };
}

export async function createCampaign(
  tx: Tx,
  storeId: string,
  actorId: string,
  input: CampaignInput,
) {
  const experiment = await tx.crmExperiment.create({
    data: {
      storeId,
      ...campaignFields(input),
      assignmentSalt: randomBytes(24).toString("hex"),
      ruleVersion: RULE_VERSION,
      createdById: actorId,
    },
  });
  await audit(tx, storeId, actorId, "CrmExperiment", experiment.id, "CREATE", {
    version: experiment.version,
  });
  return publicCampaign(experiment);
}

export async function updateCampaign(
  tx: Tx,
  storeId: string,
  id: string,
  actorId: string,
  version: number,
  input: CampaignInput,
) {
  const experiment = await requireExperiment(tx, storeId, id);
  if (experiment.status !== "DRAFT" || experiment.version !== version)
    throw new CrmError(
      "VERSION_CONFLICT",
      "Rascunho alterado ou já aprovado. Recarregue a campanha.",
    );
  await tx.crmAssignment.deleteMany({ where: { experimentId: id, storeId } });
  const updated = await tx.crmExperiment.update({
    where: { id },
    data: {
      ...campaignFields(input),
      version: { increment: 1 },
      messageVersion: { increment: 1 },
      previewHash: null,
      eligibleAt: null,
      snapshotAsOf: null,
      excluded: 0,
    },
  });
  await audit(tx, storeId, actorId, "CrmExperiment", id, "UPDATE", {
    version: updated.version,
  });
  return publicCampaign(updated);
}

export function publicCampaign<
  T extends {
    assignmentSalt: string;
    costBudgetCents: Prisma.Decimal;
    unitCostCents: Prisma.Decimal;
    fixedCostCents: Prisma.Decimal;
  },
>(row: T) {
  const { assignmentSalt: _privateSalt, ...fields } = row;
  return {
    ...fields,
    costBudgetCents: Number(row.costBudgetCents),
    unitCostCents: Number(row.unitCostCents),
    fixedCostCents: Number(row.fixedCostCents),
  };
}

export async function previewCampaign(
  tx: Tx,
  storeId: string,
  id: string,
  actorId: string,
  version: number,
) {
  const experiment = await requireExperiment(tx, storeId, id);
  if (experiment.status !== "DRAFT" || experiment.version !== version)
    throw new CrmError(
      "VERSION_CONFLICT",
      "Atualize o rascunho antes de revisar o público.",
    );
  if (experiment.startAt <= new Date())
    throw new CrmError(
      "WINDOW_STARTED",
      "A janela precisa começar em um dia futuro para congelar o público.",
    );
  const total = await tx.crmContact.count({ where: { storeId, active: true } });
  const covered = await tx.crmSegmentSnapshot.count({
    where: {
      storeId,
      ruleVersion: RULE_VERSION,
      asOf: { gte: new Date(Date.now() - 86_400_000) },
      contact: { active: true },
    },
  });
  if (total !== covered)
    throw new CrmError(
      "STALE_SEGMENTS",
      "Atualize os públicos e aguarde a conclusão antes de revisar a campanha.",
    );
  const rows = await tx.crmSegmentSnapshot.findMany({
    where: {
      storeId,
      segment: experiment.segment,
      ruleVersion: RULE_VERSION,
      contact: { active: true },
    },
    orderBy: { contactId: "asc" },
    take: 5001,
    include: { contact: { select: { marketingOptIn: true, phone: true } } },
  });
  if (rows.length > 5000)
    throw new CrmError(
      "AUDIENCE_LIMIT",
      "Esta etapa suporta até 5.000 pessoas por público. Divida a campanha antes de continuar.",
    );
  const eligibleAt = new Date();
  const assignments: {
    storeId: string;
    experimentId: string;
    contactId: string;
    arm: string;
    eligibleAt: Date;
    segmentAtEntry: string;
  }[] = [];
  const consentIds = rows.length
    ? await validConsentIds(
        tx,
        storeId,
        rows.map((r) => r.contactId),
      )
    : new Set<string>();
  for (const row of rows) {
    if (
      row.contact.phone &&
      row.contact.marketingOptIn &&
      consentIds.has(row.contactId)
    )
      assignments.push({
        storeId,
        experimentId: id,
        contactId: row.contactId,
        arm: assignArm(row.contactId, id, experiment.assignmentSalt),
        eligibleAt,
        segmentAtEntry: row.segment,
      });
  }
  await tx.crmAssignment.deleteMany({ where: { experimentId: id, storeId } });
  if (assignments.length)
    await tx.crmAssignment.createMany({ data: assignments });
  const previewHash = canonicalHash({
    version,
    experiment: publicCampaign(experiment),
    audience: assignments.map(({ contactId, arm }) => ({ contactId, arm })),
    eligibleAt,
  });
  const snapshotAsOf = rows.length
    ? new Date(Math.min(...rows.map((r) => r.asOf.getTime())))
    : null;
  await tx.crmExperiment.update({
    where: { id },
    data: {
      previewHash,
      eligibleAt,
      snapshotAsOf,
      excluded: rows.length - assignments.length,
    },
  });
  await audit(tx, storeId, actorId, "CrmExperiment", id, "PREVIEW", {
    version,
    previewHash,
    assigned: assignments.length,
  });
  return {
    previewHash,
    version,
    assigned: assignments.length,
    control: assignments.filter((a) => a.arm === "CONTROL").length,
    treatment: assignments.filter((a) => a.arm === "TREATMENT").length,
    excluded: rows.length - assignments.length,
    eligibleAt,
    snapshotAsOf,
  };
}

async function validConsentIds(tx: Tx, storeId: string, contactIds: string[]) {
  const rows = await tx.$queryRaw<{ contactId: string }[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("contactId") "contactId", status, "proofRef", "effectiveAt"
      FROM "CrmConsent" WHERE "storeId" = ${storeId} AND channel = 'LOCAL'
        AND "contactId" IN (${Prisma.join(contactIds)}) AND "effectiveAt" <= (${new Date()}::timestamptz AT TIME ZONE 'UTC')
      ORDER BY "contactId", "effectiveAt" DESC, "createdAt" DESC
    ) SELECT latest."contactId" FROM latest WHERE status = 'OPT_IN' AND "proofRef" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "CrmConsent" blocked WHERE blocked."storeId" = ${storeId}
        AND blocked."contactId" = latest."contactId" AND blocked.channel = 'LOCAL'
        AND blocked.status = 'OPT_OUT' AND blocked."effectiveAt" = latest."effectiveAt")`;
  return new Set(rows.map((row) => row.contactId));
}

export async function hasConsent(
  tx: Tx,
  storeId: string,
  contactId: string,
  marketingOptIn: boolean,
) {
  return (
    marketingOptIn &&
    (await validConsentIds(tx, storeId, [contactId])).has(contactId)
  );
}

export async function approveCampaign(
  tx: Tx,
  storeId: string,
  id: string,
  actorId: string,
  version: number,
  previewHash: string,
) {
  const experiment = await requireExperiment(tx, storeId, id);
  if (
    experiment.status !== "DRAFT" ||
    experiment.version !== version ||
    experiment.previewHash !== previewHash ||
    !experiment.eligibleAt
  )
    throw new CrmError(
      "VERSION_CONFLICT",
      "A prévia mudou. Revise o público e aprove a versão atual.",
    );
  if (experiment.startAt <= new Date())
    throw new CrmError(
      "WINDOW_STARTED",
      "A janela já começou. Ajuste as datas do rascunho.",
    );
  const treatment = await tx.crmAssignment.findMany({
    where: { storeId, experimentId: id, arm: "TREATMENT" },
  });
  if (!treatment.length)
    throw new CrmError(
      "EMPTY_AUDIENCE",
      "Não há pessoas no tratamento para aprovar.",
    );
  const maximumCost = experiment.unitCostCents
    .mul(treatment.length)
    .add(experiment.fixedCostCents);
  if (maximumCost.gt(experiment.costBudgetCents))
    throw new CrmError(
      "BUDGET_EXCEEDED",
      "O custo máximo excede o orçamento aprovado.",
    );
  await tx.crmApproval.create({
    data: { storeId, experimentId: id, version, previewHash, actorId },
  });
  await tx.crmDelivery.createMany({
    data: treatment.map((a) => ({
      storeId,
      assignmentId: a.id,
      messageVersion: experiment.messageVersion,
    })),
  });
  await tx.crmExperiment.update({
    where: { id },
    data: { status: "APPROVED" },
  });
  await audit(tx, storeId, actorId, "CrmExperiment", id, "APPROVE", {
    version,
    previewHash,
    maximumCostCents: maximumCost.toString(),
  });
  return {
    approved: true,
    version,
    maximumCostCents: Number(maximumCost),
    status: "APPROVED",
  };
}

export async function campaignDetail(storeId: string, id: string) {
  const experiment = await requireExperiment(prisma, storeId, id);
  const [groups, deliveries, approvals] = await Promise.all([
    prisma.crmAssignment.groupBy({
      by: ["arm"],
      where: { storeId, experimentId: id },
      _count: { id: true },
    }),
    prisma.crmDelivery.groupBy({
      by: ["state"],
      where: { storeId, assignment: { experimentId: id } },
      _count: { id: true },
    }),
    prisma.crmApproval.findMany({
      where: { storeId, experimentId: id },
      select: {
        version: true,
        actorId: true,
        approvedAt: true,
        previewHash: true,
      },
    }),
  ]);
  return {
    ...publicCampaign(experiment),
    groups: Object.fromEntries(groups.map((g) => [g.arm, g._count.id])),
    deliveries: Object.fromEntries(
      deliveries.map((g) => [g.state, g._count.id]),
    ),
    approvals,
  };
}

export async function aggregateOutcomes(id: string, now = new Date()) {
  await prisma.$transaction(
    async (tx) => {
      const experiment = await tx.crmExperiment.findUniqueOrThrow({
        where: { id },
      });
      await lockStore(tx, experiment.storeId);
      if (
        !["RUNNING", "CLOSED"].includes(experiment.status) ||
        now < experiment.endAt
      )
        return;
      await tx.$executeRaw`
      INSERT INTO "CrmOutcome" ("assignmentId", "storeId", returned, "netRevenueCents", visits, contaminated, "calculatedAt")
      SELECT a.id, a."storeId", COUNT(s.id) > 0,
        CASE WHEN COUNT(s.id) FILTER (WHERE s."netRevenueCents" IS NULL) > 0 THEN NULL ELSE COALESCE(SUM(s."netRevenueCents"), 0) END,
        COUNT(s.id)::int,
        EXISTS (SELECT 1 FROM "CrmDelivery" d JOIN "CrmAssignment" exposed ON exposed.id = d."assignmentId" AND exposed."storeId" = d."storeId"
          WHERE d."storeId" = a."storeId" AND exposed."contactId" = a."contactId" AND exposed."experimentId" <> a."experimentId"
          AND d.state IN ('SIMULATED', 'UNCERTAIN') AND d."sentAt" >= (${experiment.startAt}::timestamptz AT TIME ZONE 'UTC') AND d."sentAt" < (${experiment.endAt}::timestamptz AT TIME ZONE 'UTC')),
        (${now}::timestamptz AT TIME ZONE 'UTC')
      FROM "CrmAssignment" a LEFT JOIN "CrmSale" s ON s."storeId" = a."storeId" AND s."crmContactId" = a."contactId"
        AND s.status = 'COMPLETED' AND s."soldAt" >= (${experiment.startAt}::timestamptz AT TIME ZONE 'UTC') AND s."soldAt" < (${experiment.endAt}::timestamptz AT TIME ZONE 'UTC')
      WHERE a."experimentId" = ${id} AND a."storeId" = ${experiment.storeId}
      GROUP BY a.id
      ON CONFLICT ("assignmentId") DO UPDATE SET returned = EXCLUDED.returned, "netRevenueCents" = EXCLUDED."netRevenueCents",
        visits = EXCLUDED.visits, contaminated = EXCLUDED.contaminated, "calculatedAt" = EXCLUDED."calculatedAt"`;
      await tx.crmDelivery.updateMany({
        where: {
          storeId: experiment.storeId,
          state: "PENDING",
          assignment: { experimentId: id },
        },
        data: { state: "BLOCKED", failedCode: "WINDOW_ENDED" },
      });
      if (experiment.status !== "CLOSED") {
        await audit(
          tx,
          experiment.storeId,
          experiment.createdById,
          "CrmExperiment",
          id,
          "CLOSE",
          { version: experiment.version, reason: "WINDOW_ENDED" },
        );
      }
      await tx.crmExperiment.update({
        where: { id },
        data: { status: "CLOSED", lastCalculatedAt: now },
      });
    },
    { timeout: 30_000 },
  );
}

export async function campaignResult(
  storeId: string,
  id: string,
  now = new Date(),
) {
  const experiment = await requireExperiment(prisma, storeId, id);
  if (
    now < experiment.endAt ||
    !["RUNNING", "CLOSED"].includes(experiment.status)
  )
    return { status: "WAITING_WINDOW", endAt: experiment.endAt };
  const rows = await prisma.crmAssignment.findMany({
    where: { storeId, experimentId: id },
    include: { outcome: true, delivery: true },
  });
  if (rows.some((r) => !r.outcome))
    return { status: "WAITING_AGGREGATION", endAt: experiment.endAt };
  const group = (arm: string): GroupResult => {
    const assigned = rows.filter((r) => r.arm === arm);
    const revenue = assigned.some((r) => r.outcome?.netRevenueCents === null)
      ? null
      : Number(
          assigned.reduce(
            (sum, r) => sum.add(r.outcome!.netRevenueCents!),
            new Prisma.Decimal(0),
          ),
        );
    if (revenue !== null && !Number.isSafeInteger(revenue))
      throw new CrmError(
        "MONEY_RANGE",
        "Receita fora do limite de centavos representáveis com segurança.",
      );
    return {
      assigned: assigned.length,
      returned: assigned.filter((r) => r.outcome?.returned).length,
      visits: assigned.reduce((sum, r) => sum + (r.outcome?.visits ?? 0), 0),
      netRevenueCents: revenue,
      simulated: assigned.filter((r) => r.delivery?.state === "SIMULATED")
        .length,
      uncertain: assigned.filter((r) => r.delivery?.state === "UNCERTAIN")
        .length,
      blocked: assigned.filter((r) => r.delivery?.state === "BLOCKED").length,
      failed: assigned.filter((r) => r.delivery?.state === "FAILED").length,
      contaminated: assigned.filter((r) => r.outcome?.contaminated).length,
    };
  };
  const treatment = group("TREATMENT"),
    control = group("CONTROL");
  const costCents =
    Number(experiment.fixedCostCents) +
    rows.reduce((sum, r) => sum + Number(r.delivery?.costCents ?? 0), 0);
  return {
    status: "READY",
    treatment,
    control,
    ...compareGroups(treatment, control, costCents),
    calculatedAt: rows.reduce<Date | null>(
      (min, r) =>
        r.outcome && (!min || r.outcome.calculatedAt < min)
          ? r.outcome.calculatedAt
          : min,
      null,
    ),
    note: "Simulação local. Comparação descritiva por pessoa alocada; amostra pequena não prova efeito causal ou significância. Aceite não comprova leitura. Receita ausente permanece desconhecida.",
  };
}
