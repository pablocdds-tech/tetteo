import { Router, Request, Response } from "./http-router";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { can } from "./scope";
import { assertStoreAccess } from "./scope";
import { prisma } from "./database";
import { CrmError, SEGMENTS } from "./campaign-domain";
import {
  acceptImport,
  approveCampaign,
  audienceOverview,
  audit,
  campaignDetail,
  campaignResult,
  createCampaign,
  mergeContacts,
  mutation,
  previewCampaign,
  publicCampaign,
  recordConsent,
  registerIdentity,
  requireExperiment,
  updateCampaign,
} from "./campaign-service";

const router = Router();
const money = z.number().int().min(0).max(1_000_000_000);
const id = z.string().uuid();
const version = z.number().int().positive();
const campaign = z
  .object({
    name: z.string().trim().min(2).max(120),
    objective: z.string().trim().min(3).max(500),
    segment: z.enum(SEGMENTS),
    startDate: z.string(),
    endDate: z.string(),
    message: z.string().trim().min(5).max(2000),
    benefit: z.string().trim().min(1).max(500),
    costBudgetCents: money,
    unitCostCents: money,
    fixedCostCents: money,
  })
  .strict();
const visit = z
  .object({
    externalId: z.string().trim().min(1).max(150),
    externalCustomerId: z.string().trim().min(1).max(150),
    occurredAt: z
      .string()
      .datetime({ offset: true })
      .refine(
        (v) => new Date(v) <= new Date(),
        "Uma visita finalizada não pode estar no futuro.",
      ),
    netRevenueCents: money,
    reversed: z.boolean().default(false),
    revision: z.number().int().min(1).default(1),
    reason: z.string().trim().min(2).max(300),
  })
  .strict();

async function scope(req: Request) {
  const query = z
    .object({
      storeId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\w-]+$/),
    })
    .strict()
    .parse(req.query);
  assertStoreAccess(req.user!, query.storeId);
  if (
    !(await prisma.unidade.findFirst({
      where: { id: query.storeId, ativa: true, excluidoEm: null },
      select: { id: true },
    }))
  )
    throw new CrmError("NOT_FOUND", "Loja não encontrada.", 404);
  return query.storeId;
}

function fail(res: Response, error: unknown, requestId: string) {
  res.setHeader("Cache-Control", "private, no-store");
  if (error instanceof CrmError)
    return res.status(error.status).json({
      code: error.code,
      message: error.message,
      error: error.message,
      requestId,
    });
  if (error instanceof Error && error.name === "AuthorizationError")
    return res.status(403).json({
      code: "FORBIDDEN",
      message: "Sem acesso a esta loja.",
      error: "Sem acesso a esta loja.",
      requestId,
    });
  if (error instanceof z.ZodError)
    return res.status(400).json({
      code: "VALIDATION",
      message: "Confira os dados informados.",
      error: "Confira os dados informados.",
      fieldErrors: error.flatten(),
      requestId,
    });
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2034"].includes(error.code)
  )
    return res.status(409).json({
      code: "CONFLICT",
      message: "Os dados mudaram. Atualize e tente novamente.",
      error: "Os dados mudaram. Atualize e tente novamente.",
      requestId,
    });
  console.error(
    "[crm/campaigns]",
    requestId,
    error instanceof Error ? error.name : "unknown",
  );
  return res.status(503).json({
    code: "UNAVAILABLE",
    message:
      "Não foi possível concluir. Os dados anteriores foram preservados.",
    error: "Não foi possível concluir. Os dados anteriores foram preservados.",
    requestId,
  });
}

function read(work: (req: Request, storeId: string) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const requestId = randomUUID();
    res.setHeader("Cache-Control", "private, no-store");
    try {
      if (!can(req.user!, "CRM", "VIEW"))
        throw new CrmError(
          "FORBIDDEN",
          "Sem permissão para acessar o CRM.",
          403,
        );
      res.json(await work(req, await scope(req)));
    } catch (error) {
      fail(res, error, requestId);
    }
  };
}

function write<S extends z.ZodTypeAny>(
  schema: S,
  work: (
    tx: Prisma.TransactionClient,
    req: Request,
    storeId: string,
    data: z.output<S>,
  ) => Promise<unknown>,
  managersOnly = false,
  status = 200,
) {
  return async (req: Request, res: Response) => {
    const requestId = randomUUID();
    res.setHeader("Cache-Control", "private, no-store");
    try {
      if (
        !can(req.user!, "CRM", "EDIT") ||
        (managersOnly && !["SUPER_ADMIN", "MANAGER"].includes(req.user!.role))
      )
        throw new CrmError(
          "FORBIDDEN",
          "Esta ação exige permissão de gestão do CRM.",
          403,
        );
      const storeId = await scope(req);
      const data = schema.parse(req.body);
      const key = z
        .string()
        .min(8)
        .max(160)
        .parse(req.header("Idempotency-Key"));
      const payload = { method: req.method, path: req.path, data };
      res
        .status(status)
        .json(
          await mutation(storeId, req.user!.userId, key, payload, (tx) =>
            work(tx, req, storeId, data),
          ),
        );
    } catch (error) {
      fail(res, error, requestId);
    }
  };
}

router.get(
  "/audiences",
  read(async (_req, storeId) => ({
    ...(await audienceOverview(storeId)),
    jobsEnabled: true,
    simulationEnabled: process.env.CRM_LOCAL_DELIVERY_ENABLED === "true",
  })),
);
router.post(
  "/audiences/refresh",
  write(
    z.object({}).strict(),
    async (tx, req, storeId) => {
      const pending = await tx.crmSegmentJob.findFirst({
        where: { storeId, status: { in: ["ACCEPTED", "RUNNING"] } },
        select: { id: true, status: true },
      });
      if (pending) return pending;
      const job = await tx.crmSegmentJob.create({
        data: { storeId, actorId: req.user!.userId },
      });
      await audit(
        tx,
        storeId,
        req.user!.userId,
        "CrmSegmentJob",
        job.id,
        "CREATE",
      );
      return { id: job.id, status: job.status };
    },
    false,
    202,
  ),
);

router.post(
  "/contacts/:id/consents",
  write(
    z
      .object({
        status: z.enum(["OPT_IN", "OPT_OUT"]),
        source: z.string().trim().min(2).max(80),
        proofRef: z.string().trim().min(2).max(200).optional(),
      })
      .strict(),
    (tx, req, storeId, data) =>
      recordConsent(
        tx,
        storeId,
        id.parse(req.params.id),
        req.user!.userId,
        data.status,
        data.source,
        data.proofRef,
      ),
  ),
);
router.get(
  "/contacts/:id/campaign-profile",
  read(async (req, storeId) => {
    const contactId = id.parse(req.params.id);
    const contact = await prisma.crmContact.findFirst({
      where: { id: contactId, storeId, active: true },
      select: {
        id: true,
        identities: { select: { id: true, type: true, verifiedAt: true } },
        consents: {
          orderBy: { effectiveAt: "desc" },
          take: 10,
          select: {
            status: true,
            channel: true,
            source: true,
            effectiveAt: true,
          },
        },
      },
    });
    if (!contact)
      throw new CrmError(
        "NOT_FOUND",
        "Contato não encontrado nesta loja.",
        404,
      );
    return contact;
  }),
);
router.post(
  "/contacts/:id/identities",
  write(
    z
      .object({
        type: z.literal("LOCAL_JSON"),
        value: z.string().trim().min(1).max(150),
        confirmedVerified: z.literal(true),
      })
      .strict(),
    (tx, req, storeId, data) =>
      registerIdentity(
        tx,
        storeId,
        id.parse(req.params.id),
        req.user!.userId,
        data.type,
        data.value,
      ),
    true,
  ),
);
router.post(
  "/contacts/:id/merge",
  write(
    z
      .object({
        targetId: id,
        confirmed: z.literal(true),
        reason: z.string().trim().min(10).max(300),
      })
      .strict(),
    (tx, req, storeId, data) =>
      mergeContacts(
        tx,
        storeId,
        id.parse(req.params.id),
        data.targetId,
        req.user!.userId,
        data.reason,
      ),
    true,
  ),
);

router.post(
  "/imports",
  write(
    z.object({ rows: z.array(z.unknown()).min(1).max(500) }).strict(),
    async (tx, req, storeId, data) => {
      const parsed = data.rows.map((row) => visit.safeParse(row));
      const errors = parsed.flatMap((result, index) =>
        result.success
          ? []
          : [
              {
                line: index + 1,
                code: "INVALID_ROW",
                fields: result.error.issues.map((issue) =>
                  issue.path.join("."),
                ),
              },
            ],
      );
      if (errors.length) {
        const batch = await tx.crmImport.create({
          data: {
            storeId,
            actorId: req.user!.userId,
            status: "FAILED",
            rows: [],
            errors,
          },
        });
        await audit(
          tx,
          storeId,
          req.user!.userId,
          "CrmImport",
          batch.id,
          "REJECT",
          { lines: data.rows.length, rejected: errors.length },
        );
        return { importId: batch.id, status: batch.status, errors };
      }
      return acceptImport(
        tx,
        storeId,
        req.user!.userId,
        parsed.flatMap((result) => (result.success ? [result.data] : [])),
      );
    },
    true,
    202,
  ),
);
router.get(
  "/imports/:id",
  read(async (req, storeId) => {
    const batch = await prisma.crmImport.findFirst({
      where: { id: id.parse(req.params.id), storeId },
      select: {
        id: true,
        status: true,
        errors: true,
        applied: true,
        durationMs: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!batch)
      throw new CrmError("NOT_FOUND", "Importação não encontrada.", 404);
    return batch;
  }),
);
router.get(
  "/experiments",
  read(async (_req, storeId) => ({
    items: (
      await prisma.crmExperiment.findMany({
        where: { storeId },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    ).map(publicCampaign),
  })),
);
router.post(
  "/experiments",
  write(
    campaign,
    (tx, req, storeId, data) =>
      createCampaign(tx, storeId, req.user!.userId, data),
    false,
    201,
  ),
);
router.get(
  "/experiments/:id",
  read((req, storeId) => campaignDetail(storeId, id.parse(req.params.id))),
);
router.put(
  "/experiments/:id",
  write(campaign.extend({ version }).strict(), (tx, req, storeId, data) => {
    const { version: expected, ...fields } = data;
    return updateCampaign(
      tx,
      storeId,
      id.parse(req.params.id),
      req.user!.userId,
      expected,
      fields,
    );
  }),
);
router.post(
  "/experiments/:id/preview",
  write(z.object({ version }).strict(), (tx, req, storeId, data) =>
    previewCampaign(
      tx,
      storeId,
      id.parse(req.params.id),
      req.user!.userId,
      data.version,
    ),
  ),
);
router.post(
  "/experiments/:id/approve",
  write(
    z
      .object({ version, previewHash: z.string().regex(/^[a-f\d]{64}$/) })
      .strict(),
    (tx, req, storeId, data) =>
      approveCampaign(
        tx,
        storeId,
        id.parse(req.params.id),
        req.user!.userId,
        data.version,
        data.previewHash,
      ),
    true,
  ),
);
router.post(
  "/experiments/:id/simulate",
  write(
    z.object({ version, confirmed: z.literal(true) }).strict(),
    async (tx, req, storeId, data) => {
      if (process.env.CRM_LOCAL_DELIVERY_ENABLED !== "true")
        throw new CrmError(
          "SIMULATION_DISABLED",
          "Habilite a simulação local no servidor antes de iniciar.",
          503,
        );
      const experimentId = id.parse(req.params.id),
        experiment = await requireExperiment(tx, storeId, experimentId);
      if (
        experiment.status !== "APPROVED" ||
        experiment.version !== data.version
      )
        throw new CrmError(
          "VERSION_CONFLICT",
          "A campanha precisa estar aprovada nesta versão.",
        );
      if (experiment.endAt <= new Date())
        throw new CrmError(
          "WINDOW_ENDED",
          "A janela desta campanha já terminou.",
        );
      await tx.crmExperiment.update({
        where: { id: experimentId },
        data: { status: "RUNNING" },
      });
      await audit(
        tx,
        storeId,
        req.user!.userId,
        "CrmExperiment",
        experimentId,
        "START_LOCAL_SIMULATION",
        { version: data.version },
      );
      return { status: "RUNNING", mode: "LOCAL_SIMULATION" };
    },
    true,
  ),
);
router.get(
  "/experiments/:id/result",
  read((req, storeId) => campaignResult(storeId, id.parse(req.params.id))),
);
router.get(
  "/experiments/:id/export",
  read(async (req, storeId) => {
    const experimentId = id.parse(req.params.id);
    await requireExperiment(prisma, storeId, experimentId);
    return {
      timezone: "America/Sao_Paulo",
      items: await prisma.crmAssignment.findMany({
        where: { storeId, experimentId },
        select: {
          contactId: true,
          arm: true,
          eligibleAt: true,
          segmentAtEntry: true,
          outcome: {
            select: {
              returned: true,
              visits: true,
              netRevenueCents: true,
              contaminated: true,
              calculatedAt: true,
            },
          },
        },
        orderBy: { contactId: "asc" },
      }),
    };
  }),
);

export default router;
