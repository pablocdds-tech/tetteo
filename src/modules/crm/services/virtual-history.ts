import { randomUUID } from "node:crypto";
import { Prisma, type AvChannelHistorySync } from "@prisma/client";
import { z } from "zod";
import { contextoDeFundo, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { maskVirtualSecrets } from "@/server/atendimento-canal";
import type { ChannelManagementFactory } from "@/server/atendimento-provedor";
import { canonicalHash, CrmError } from "./campaign-domain";
import { applyVirtualCustomerName } from "./virtual-name-state";
import {
  authorizeVirtual,
  lockVirtualConversation,
  virtualAudit,
} from "./virtual-runtime";

const requestSchema = z
  .object({
    action: z.literal("sync"),
    storeId: z.string().min(1).max(128),
    accountId: z.string().uuid(),
    requestId: z.string().uuid(),
  })
  .strict();
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const messageSchema = z
  .object({
    externalId: z
      .string()
      .min(9)
      .max(208)
      .regex(/^message:[^\r\n\0]+$/),
    senderKey: phone,
    trustedPhone: phone,
    fromSelf: z.boolean(),
    kind: z.enum(["TEXT", "AUDIO", "IMAGE"]),
    text: z.string().max(16384),
    occurredAt: z.iso.datetime(),
    transcriptionCertain: z.boolean(),
    displayName: z.string().max(160).optional(),
  })
  .strict();
const pageSchema = z
  .object({
    messages: z.array(z.unknown()).max(100),
    page: z.number().int().min(1),
    pageSize: z.literal(100),
    total: z.number().int().min(0).max(2_000_000_000),
    pages: z.number().int().min(0).max(2_000_000_000),
    nextPage: z.number().int().min(1).nullable(),
    skipped: z.number().int().min(0).max(100),
  })
  .strict();
const state = (row: AvChannelHistorySync | null, supported: boolean) => ({
  supported,
  state: row?.state ?? "IDLE",
  startedAt: row?.startedAt.toISOString() ?? null,
  finishedAt: row?.finishedAt?.toISOString() ?? null,
  importedConversations: row?.importedConversations ?? 0,
  importedMessages: row?.importedMessages ?? 0,
  skippedMessages: row?.skippedMessages ?? 0,
  coverageFrom: row?.coverageFrom?.toISOString() ?? null,
  coverageUntil: row?.coverageUntil?.toISOString() ?? null,
  complete: row?.complete ?? false,
  limitReason: row?.limitReason ?? null,
  error: row?.error ?? null,
});
function fail(code: string, message: string, status = 409): never {
  throw new CrmError(code, message, status);
}
const scopeOf = (
  row: Pick<AvChannelHistorySync, "organizationId" | "storeId" | "accountId">,
) => ({
  organizationId: row.organizationId,
  storeId: row.storeId,
  accountId: row.accountId,
});

async function automaticHistoryPrincipal(
  scope: {
    organizationId: string;
    storeId: string;
    accountId: string;
  },
  preferredId?: string | null,
) {
  const audit = preferredId
    ? null
    : await db.avAuditEvent.findFirst({
        where: {
          organizationId: scope.organizationId,
          storeId: scope.storeId,
          action: {
            in: [
              "CHANNEL_SAVED",
              "CHANNEL_CONNECTION_STATUS",
              "CHANNEL_CONNECT_REQUESTED",
            ],
          },
          data: { path: ["accountId"], equals: scope.accountId },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { actorId: true },
      });
  const actorId = preferredId ?? audit?.actorId;
  if (!actorId) return false;
  const user = await db.usuario.findUnique({
    where: { id: actorId },
    select: { status: true, excluidoEm: true },
  });
  if (!user || user.status !== "ATIVO" || user.excluidoEm) return false;
  const principal = await contextoDeFundo(actorId, scope.storeId);
  if (!principal || principal.organizacao.id !== scope.organizationId)
    return false;
  try {
    await authorizeVirtual(principal, scope.storeId, true, true);
    return true;
  } catch {
    return false;
  }
}

export async function getVirtualHistory(
  context: ContextoSessao,
  storeId: string,
  accountId: string,
) {
  const scope = await authorizeVirtual(context, storeId);
  const account = await db.avChannelAccount.findFirst({
    where: { organizationId: scope.organizationId, storeId, id: accountId },
    select: {
      mode: true,
      historySync: true,
      historyRecentSync: true,
      connection: {
        select: {
          connectionState: true,
          revision: true,
          verifiedRevision: true,
          verifiedAt: true,
        },
      },
    },
  });
  if (!account) fail("NOT_FOUND", "Conta não encontrada nesta unidade.", 404);
  const recent = account.historyRecentSync;
  const available =
    account.mode === "EVOLUTION" &&
    process.env.AV_HISTORY_WORKER_ENABLED !== "false" &&
    account.connection?.connectionState === "VERIFIED" &&
    account.connection.verifiedRevision === account.connection.revision &&
    Boolean(account.connection.verifiedAt);
  const principalAllowed =
    !available ||
    (await automaticHistoryPrincipal(
      { organizationId: scope.organizationId, storeId, accountId },
      recent?.requestedById ?? account.historySync?.requestedById,
    ));
  const enabled = available && principalAllowed;
  return {
    ...state(account.historySync, account.mode === "EVOLUTION"),
    automatic: {
      enabled,
      state:
        available && !principalAllowed ? "FAILED" : (recent?.state ?? "IDLE"),
      lastSyncedAt: recent?.lastSyncedAt?.toISOString() ?? null,
      nextSyncAt:
        enabled &&
        recent?.state !== "RUNNING" &&
        !(recent?.state === "FAILED" && recent.error !== PROVIDER_HISTORY_ERROR)
          ? new Date(
              (recent?.finishedAt?.getTime() ?? Date.now() - 60_000) +
                (recent?.state === "FAILED" ? 5 * 60_000 : 60_000),
            ).toISOString()
          : null,
      error:
        available && !principalAllowed
          ? "A atualização automática exige que o responsável pela conexão mantenha acesso de gestão nesta unidade. Confira a conexão com um gestor autorizado."
          : (recent?.error ?? null),
    },
  };
}

export async function startVirtualHistory(
  context: ContextoSessao,
  raw: unknown,
) {
  const data = requestSchema.parse(raw),
    authorized = await authorizeVirtual(context, data.storeId, true, true);
  const scope = {
    organizationId: authorized.organizationId,
    storeId: data.storeId,
    accountId: data.accountId,
  };
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${data.accountId}`}))`;
    const account = await tx.avChannelAccount.findFirst({
      where: {
        id: data.accountId,
        organizationId: scope.organizationId,
        storeId: data.storeId,
      },
      select: {
        mode: true,
        connection: {
          select: {
            revision: true,
            verifiedRevision: true,
            verifiedAt: true,
            connectionState: true,
          },
        },
      },
    });
    if (!account) fail("NOT_FOUND", "Conta não encontrada nesta unidade.", 404);
    if (account.mode !== "EVOLUTION")
      fail(
        "HISTORY_UNSUPPORTED",
        "Esta opção de canal não oferece importação de histórico.",
      );
    const connection = account.connection;
    if (
      !connection ||
      connection.connectionState !== "VERIFIED" ||
      connection.verifiedRevision !== connection.revision ||
      !connection.verifiedAt
    )
      fail(
        "HISTORY_CONNECTION_REQUIRED",
        "Conecte e confira o número antes de importar o histórico.",
      );
    const prior = await tx.avChannelHistorySync.findUnique({
      where: { accountId: data.accountId },
    });
    const requested = await tx.avAuditEvent.findFirst({
      where: {
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        action: "HISTORY_SYNC_REQUESTED",
        AND: [
          { data: { path: ["accountId"], equals: data.accountId } },
          { data: { path: ["requestId"], equals: data.requestId } },
        ],
      },
      select: { actorId: true },
    });
    if (prior?.requestId === data.requestId || requested) {
      if ((requested?.actorId ?? prior?.requestedById) !== context.usuario.id)
        fail(
          "IDEMPOTENCY_CONFLICT",
          "Esta tentativa pertence a outro operador.",
        );
      return;
    }
    if (prior?.state === "RUNNING")
      fail("HISTORY_BUSY", "O histórico desta conta já está sendo importado.");
    const resumed =
      prior?.state === "PARTIAL" && prior.revision === connection.revision;
    const now = new Date();
    const values = {
      revision: connection.revision,
      requestedById: context.usuario.id,
      requestId: data.requestId,
      state: "RUNNING",
      pagesProcessed: 0,
      startedAt: now,
      finishedAt: null,
      complete: false,
      error: null,
      limitReason: null,
      leaseOwner: null,
      leaseUntil: null,
      attempts: 0,
    };
    const fresh = {
      nextPage: 1,
      pageSize: 100,
      since: new Date("2000-01-01T00:00:00.000Z"),
      until: now,
      importedConversations: 0,
      importedMessages: 0,
      skippedMessages: 0,
      coverageFrom: null,
      coverageUntil: null,
      lastPageHash: null,
    };
    await tx.avChannelHistorySync.upsert({
      where: { accountId: data.accountId },
      create: { ...scope, ...fresh, ...values },
      update: { ...values, ...(resumed ? {} : fresh) },
    });
    await virtualAudit(
      tx,
      scope,
      context.usuario.id,
      "HISTORY_SYNC_REQUESTED",
      {
        accountId: data.accountId,
        revision: connection.revision,
        requestId: data.requestId,
        resumed,
      },
    );
  });
  const recent = await db.avChannelHistoryRecentSync.findUnique({
    where: { accountId: data.accountId },
    select: { state: true },
  });
  if (recent?.state === "FAILED")
    await scheduleAutomaticVirtualHistory({
      accountId: data.accountId,
      actorId: context.usuario.id,
      retryFailed: true,
    });
  return getVirtualHistory(context, data.storeId, data.accountId);
}

const PROVIDER_HISTORY_ERROR =
  "Não foi possível consultar o histórico do provedor. Confira a conexão e tente novamente.";
const HISTORY_START = new Date("2000-01-01T00:00:00.000Z");
const RECENT_INTERVAL_MS = 60_000;
const FULL_INTERVAL_MS = 24 * 60 * 60_000;

/** Detect a completed QR pairing even if the browser was closed. This only
 * reads provider status: no QR, connect, logout, restart or activation. */
export async function refreshVirtualHistoryConnections(
  management: ChannelManagementFactory,
  accountId?: string,
) {
  if (process.env.AV_HISTORY_WORKER_ENABLED === "false") return 0;
  const candidates = await db.avChannelConnection.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      connectionState: { in: ["PENDING", "FAILED"] },
      updatedAt: { lte: new Date(Date.now() - 30_000) },
      account: {
        mode: "EVOLUTION",
        store: {
          ativa: true,
          excluidoEm: null,
          organizacao: { ativa: true, excluidoEm: null },
        },
      },
      OR: [
        { connectLeaseUntil: null },
        { connectLeaseUntil: { lte: new Date() } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 20,
    include: {
      account: {
        select: { historyRecentSync: { select: { requestedById: true } } },
      },
    },
  });
  let checked = 0,
    verified = 0;
  for (const connection of candidates) {
    if (checked >= 3) break;
    const scope = scopeOf(connection);
    const audit = await db.avAuditEvent.findFirst({
      where: {
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        action: {
          in: [
            "CHANNEL_SAVED",
            "CHANNEL_CONNECTION_STATUS",
            "CHANNEL_CONNECT_REQUESTED",
          ],
        },
        data: { path: ["accountId"], equals: scope.accountId },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { actorId: true },
    });
    const actorId =
      audit?.actorId ?? connection.account.historyRecentSync?.requestedById;
    if (!actorId || !(await automaticHistoryPrincipal(scope, actorId)))
      continue;
    const owner = randomUUID();
    const claimed = await db.$queryRaw<{ id: string }[]>`
      UPDATE "av_channel_connection" SET "connectLeaseOwner"=${owner},
        "connectLeaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '60 seconds',
        "updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
      WHERE "id"=${connection.id} AND "organizationId"=${scope.organizationId}
        AND "storeId"=${scope.storeId} AND "accountId"=${scope.accountId}
        AND "revision"=${connection.revision} AND "connectionState" IN ('PENDING','FAILED')
        AND ("connectLeaseUntil" IS NULL OR "connectLeaseUntil"<=(clock_timestamp() AT TIME ZONE 'UTC'))
      RETURNING "id"`;
    if (!claimed.length) continue;
    checked++;
    try {
      const adapter = await management(scope.accountId),
        identity = adapter.identify();
      if (
        identity.mode !== "EVOLUTION" ||
        identity.accountKey !== scope.accountId ||
        identity.revision !== connection.revision
      )
        throw new Error("HISTORY_CONNECTION_BINDING_CHANGED");
      const result = await adapter.verify();
      if (
        !result.connected ||
        !(await automaticHistoryPrincipal(scope, actorId))
      )
        continue;
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${scope.accountId}`}))`;
        const updated = await tx.avChannelConnection.updateMany({
          where: {
            ...scope,
            revision: connection.revision,
            connectLeaseOwner: owner,
            connectLeaseUntil: { gt: new Date() },
            connectionState: { in: ["PENDING", "FAILED"] },
          },
          data: {
            connectionState: "VERIFIED",
            verifiedRevision: connection.revision,
            verifiedAt: new Date(),
            lastError: null,
          },
        });
        if (updated.count) {
          verified++;
          await virtualAudit(tx, scope, actorId, "CHANNEL_CONNECTION_STATUS", {
            accountId: scope.accountId,
            revision: connection.revision,
            previousState: connection.connectionState,
            state: "VERIFIED",
            source: "HISTORY_STATUS_RECONCILIATION",
          });
        }
      });
    } catch {
      // Pending pairing is normal. The durable updatedAt timestamp provides
      // the retry cooldown without converting an unread QR into an error.
    } finally {
      await db.avChannelConnection.updateMany({
        where: {
          ...scope,
          revision: connection.revision,
          connectLeaseOwner: owner,
        },
        data: { connectLeaseOwner: null, connectLeaseUntil: null },
      });
    }
  }
  return verified;
}

/** Read-only automatic import; the manager who configured the channel remains
 * the principal. Pausing the agent never pauses receipt/history. */
export async function scheduleAutomaticVirtualHistory(input?: {
  accountId: string;
  actorId?: string;
  retryFailed?: boolean;
}) {
  if (process.env.AV_HISTORY_WORKER_ENABLED === "false") return 0;
  const accounts = await db.avChannelAccount.findMany({
    where: {
      ...(input ? { id: input.accountId } : {}),
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
    include: { connection: true, historySync: true, historyRecentSync: true },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });
  let scheduled = 0;
  for (const account of accounts) {
    const connection = account.connection;
    if (!connection || connection.revision !== connection.verifiedRevision)
      continue;
    const recent = account.historyRecentSync;
    const full = account.historySync;
    const audit =
      !input?.actorId && (!recent || recent.revision !== connection.revision)
        ? await db.avAuditEvent.findFirst({
            where: {
              organizationId: account.organizationId,
              storeId: account.storeId,
              action: {
                in: [
                  "CHANNEL_SAVED",
                  "CHANNEL_CONNECTION_STATUS",
                  "CHANNEL_CONNECT_REQUESTED",
                ],
              },
              data: { path: ["accountId"], equals: account.id },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { actorId: true },
          })
        : null;
    const actorId =
      input?.actorId ??
      audit?.actorId ??
      recent?.requestedById ??
      full?.requestedById;
    if (!actorId) continue;
    try {
      const user = await db.usuario.findUnique({
        where: { id: actorId },
        select: { status: true, excluidoEm: true },
      });
      const context =
        user?.status === "ATIVO" && !user.excluidoEm
          ? await contextoDeFundo(actorId, account.storeId)
          : null;
      if (!context || context.organizacao.id !== account.organizationId)
        continue;
      await authorizeVirtual(context, account.storeId, true, true);
    } catch {
      continue;
    }
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${account.id}`}))`;
      const current = await tx.avChannelConnection.findFirst({
        where: {
          accountId: account.id,
          organizationId: account.organizationId,
          storeId: account.storeId,
          revision: connection.revision,
          verifiedRevision: connection.revision,
          connectionState: "VERIFIED",
          verifiedAt: { not: null },
        },
        select: { id: true },
      });
      if (!current) return;
      const now = new Date();
      for (const stream of ["RECENT", "FULL"] as const) {
        const prior =
          stream === "RECENT"
            ? await tx.avChannelHistoryRecentSync.findUnique({
                where: { accountId: account.id },
              })
            : await tx.avChannelHistorySync.findUnique({
                where: { accountId: account.id },
              });
        const sameRevision =
          prior?.revision === connection.revision &&
          (!input?.actorId || prior.requestedById === input.actorId);
        if (sameRevision && prior?.state === "RUNNING") continue;
        const resumed = sameRevision && prior?.state === "PARTIAL";
        const interval =
          prior?.state === "FAILED"
            ? 5 * RECENT_INTERVAL_MS
            : stream === "RECENT"
              ? RECENT_INTERVAL_MS
              : FULL_INTERVAL_MS;
        // Provider/network errors retry with a cooldown; loops, lost access and
        // malformed pagination remain stopped until a manual retry or revision.
        if (
          sameRevision &&
          prior?.state === "FAILED" &&
          prior.error !== PROVIDER_HISTORY_ERROR &&
          !input?.retryFailed
        )
          continue;
        if (
          sameRevision &&
          !resumed &&
          !(input?.retryFailed && prior?.state === "FAILED") &&
          prior?.finishedAt &&
          now.getTime() - prior.finishedAt.getTime() < interval
        )
          continue;
        const scope = {
          organizationId: account.organizationId,
          storeId: account.storeId,
          accountId: account.id,
        };
        const fresh = {
          nextPage: 1,
          pageSize: 100,
          since:
            stream === "RECENT"
              ? new Date(
                  Math.max(
                    HISTORY_START.getTime(),
                    sameRevision && prior
                      ? prior.until.getTime() - 5 * 60_000
                      : now.getTime() - 24 * 60 * 60_000,
                  ),
                )
              : HISTORY_START,
          until: now,
          importedConversations: 0,
          importedMessages: 0,
          skippedMessages: 0,
          coverageFrom: null,
          coverageUntil: null,
          lastPageHash: null,
        };
        const values = {
          revision: connection.revision,
          requestedById: actorId,
          requestId: randomUUID(),
          state: "RUNNING",
          pagesProcessed: 0,
          startedAt: now,
          finishedAt: null,
          complete: false,
          error: null,
          limitReason: null,
          leaseOwner: null,
          leaseUntil: null,
          attempts: 0,
        };
        const args = {
          where: { accountId: account.id },
          create: { ...scope, ...fresh, ...values },
          update: { ...values, ...(resumed ? {} : fresh) },
        };
        if (stream === "RECENT")
          await tx.avChannelHistoryRecentSync.upsert({
            ...args,
            update: {
              ...args.update,
              ...(!sameRevision ? { lastSyncedAt: null } : {}),
            },
          });
        else await tx.avChannelHistorySync.upsert(args);
        await virtualAudit(tx, scope, actorId, "HISTORY_SYNC_AUTOMATIC", {
          accountId: account.id,
          revision: connection.revision,
          stream,
          requestId: values.requestId,
          resumed,
          principalSource: input?.actorId
            ? "CURRENT_MANAGER"
            : audit
              ? "CHANNEL_CONFIGURATION_AUDIT"
              : recent
                ? "PREVIOUS_MANAGER"
                : "PREVIOUS_HISTORY_MANAGER",
        });
        scheduled++;
      }
    });
  }
  return scheduled;
}

async function authorizedJob(job: AvChannelHistorySync) {
  const user = await db.usuario.findUnique({
    where: { id: job.requestedById },
    select: { status: true, excluidoEm: true },
  });
  if (!user || user.status !== "ATIVO" || user.excluidoEm)
    fail(
      "HISTORY_ACCESS_REVOKED",
      "A importação foi interrompida porque o acesso do responsável mudou.",
      403,
    );
  const context = await contextoDeFundo(job.requestedById, job.storeId);
  if (!context || context.organizacao.id !== job.organizationId)
    fail(
      "HISTORY_ACCESS_REVOKED",
      "A importação foi interrompida porque o acesso do responsável mudou.",
      403,
    );
  await authorizeVirtual(context, job.storeId, true, true);
  const account = await db.avChannelAccount.findFirst({
    where: {
      id: job.accountId,
      organizationId: job.organizationId,
      storeId: job.storeId,
      mode: "EVOLUTION",
    },
    select: {
      connection: {
        select: {
          revision: true,
          verifiedRevision: true,
          connectionState: true,
          verifiedAt: true,
        },
      },
    },
  });
  if (
    !account?.connection ||
    account.connection.revision !== job.revision ||
    account.connection.verifiedRevision !== job.revision ||
    account.connection.connectionState !== "VERIFIED" ||
    !account.connection.verifiedAt
  )
    fail(
      "HISTORY_REVISION_CHANGED",
      "A configuração da conexão mudou. Confira o número antes de importar novamente.",
    );
}
const terminalError = (error: unknown) =>
  error instanceof CrmError &&
  [
    "FORBIDDEN",
    "NOT_FOUND",
    "HISTORY_ACCESS_REVOKED",
    "HISTORY_REVISION_CHANGED",
    "HISTORY_UNSUPPORTED",
    "HISTORY_LOOP",
    "HISTORY_NO_PROGRESS",
  ].includes(error.code);
async function failJob(
  job: AvChannelHistorySync,
  owner: string,
  error: unknown,
  stream: "FULL" | "RECENT",
) {
  const table = historyTable(stream);
  const immediate = terminalError(error),
    attempts = job.attempts + 1,
    finished = immediate || attempts >= 3;
  const safe =
    error instanceof CrmError && terminalError(error)
      ? error.message
      : PROVIDER_HISTORY_ERROR;
  await db.$executeRaw`UPDATE ${table} SET "attempts"=${attempts}, "error"=${safe}, "state"=${finished ? "FAILED" : "RUNNING"}, "finishedAt"=${finished ? new Date() : null}, "complete"=false, "leaseOwner"=NULL, "leaseUntil"=NULL, "updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE "id"=${job.id} AND "organizationId"=${job.organizationId} AND "storeId"=${job.storeId} AND "accountId"=${job.accountId} AND "requestId"=${job.requestId} AND "revision"=${job.revision} AND "state"='RUNNING' AND "leaseOwner"=${owner} AND "leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC')`;
}

const historyTable = (stream: "FULL" | "RECENT") =>
  Prisma.raw(
    stream === "RECENT"
      ? '"av_channel_history_recent_sync"'
      : '"av_channel_history_sync"',
  );

export async function processVirtualHistoryQueue(
  management: ChannelManagementFactory,
) {
  // Recency has an independent lease/cursor, so a large backfill cannot starve it.
  return (
    (await processHistoryStream(management, "RECENT")) +
    (await processHistoryStream(management, "FULL"))
  );
}
async function processHistoryStream(
  management: ChannelManagementFactory,
  stream: "FULL" | "RECENT",
) {
  const table = historyTable(stream);
  const query = {
    where: {
      state: "RUNNING",
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
    },
    orderBy: { updatedAt: "asc" },
    take: 3,
  } as const;
  const candidates: AvChannelHistorySync[] =
    stream === "RECENT"
      ? await db.avChannelHistoryRecentSync.findMany(query)
      : await db.avChannelHistorySync.findMany(query);
  let processed = 0;
  for (const candidate of candidates) {
    const owner = randomUUID();
    const claimed = await db.$queryRaw<
      { id: string }[]
    >`UPDATE ${table} SET "attempts"=CASE WHEN "leaseUntil" IS NOT NULL THEN "attempts"+1 ELSE "attempts" END, "state"=CASE WHEN "leaseUntil" IS NOT NULL AND "attempts">=2 THEN 'FAILED' ELSE 'RUNNING' END, "error"=CASE WHEN "leaseUntil" IS NOT NULL AND "attempts">=2 THEN 'A importação foi interrompida após três tentativas sem conclusão. Confira a conexão e tente novamente.' ELSE "error" END, "finishedAt"=CASE WHEN "leaseUntil" IS NOT NULL AND "attempts">=2 THEN (clock_timestamp() AT TIME ZONE 'UTC') ELSE "finishedAt" END, "leaseOwner"=CASE WHEN "leaseUntil" IS NOT NULL AND "attempts">=2 THEN NULL ELSE ${owner} END, "leaseUntil"=CASE WHEN "leaseUntil" IS NOT NULL AND "attempts">=2 THEN NULL ELSE (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '60 seconds' END, "updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE "id"=${candidate.id} AND "organizationId"=${candidate.organizationId} AND "storeId"=${candidate.storeId} AND "accountId"=${candidate.accountId} AND "state"='RUNNING' AND ("leaseUntil" IS NULL OR "leaseUntil" <= (clock_timestamp() AT TIME ZONE 'UTC')) RETURNING "id"`;
    if (!claimed.length) continue;
    const lookup = { where: { id: candidate.id, leaseOwner: owner } };
    const job =
      stream === "RECENT"
        ? await db.avChannelHistoryRecentSync.findFirst(lookup)
        : await db.avChannelHistorySync.findFirst(lookup);
    if (!job) continue;
    try {
      await authorizedJob(job);
      const adapter = await management(job.accountId),
        identity = adapter.identify();
      if (
        identity.mode !== "EVOLUTION" ||
        identity.accountKey !== job.accountId ||
        identity.revision !== job.revision ||
        !adapter.readHistoryPage
      )
        fail(
          "HISTORY_UNSUPPORTED",
          "O provedor não oferece histórico para esta configuração.",
        );
      const page = pageSchema.parse(
        await adapter.readHistoryPage({
          page: job.nextPage,
          pageSize: job.pageSize,
          since: job.since.toISOString(),
          until: job.until.toISOString(),
        }),
      );
      if (
        page.page !== job.nextPage ||
        page.messages.length + page.skipped > page.pageSize ||
        (page.nextPage !== null &&
          (page.nextPage !== page.page + 1 || page.pages <= page.page)) ||
        (page.nextPage === null && page.pages > page.page)
      )
        fail(
          "HISTORY_NO_PROGRESS",
          "O provedor não confirmou o avanço do histórico. A importação foi interrompida.",
        );
      const fingerprint = canonicalHash(
        page.messages.map((raw) => {
          const parsed = messageSchema.safeParse(raw);
          return parsed.success
            ? [
                parsed.data.externalId,
                parsed.data.senderKey,
                parsed.data.fromSelf,
                parsed.data.occurredAt,
              ]
            : null;
        }),
      );
      if (
        page.nextPage !== null &&
        page.messages.length === 0 &&
        page.skipped === 0
      )
        fail(
          "HISTORY_NO_PROGRESS",
          "O provedor devolveu uma página sem progresso. A importação foi interrompida.",
        );
      if (page.messages.length && job.lastPageHash === fingerprint)
        fail(
          "HISTORY_LOOP",
          "O provedor repetiu a mesma página. A importação foi interrompida.",
        );
      let skipped = page.skipped;
      const messages: z.infer<typeof messageSchema>[] = [];
      for (const raw of page.messages) {
        const parsed = messageSchema.safeParse(raw);
        if (
          !parsed.success ||
          parsed.data.trustedPhone !== parsed.data.senderKey
        ) {
          skipped++;
          continue;
        }
        const occurredAt = new Date(parsed.data.occurredAt);
        if (occurredAt < job.since || occurredAt > job.until) {
          skipped++;
          continue;
        }
        messages.push(parsed.data);
      }
      await authorizedJob(job);
      await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${job.accountId}`}))`;
          const owned = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM ${table} WHERE "id"=${job.id} AND "organizationId"=${job.organizationId} AND "storeId"=${job.storeId} AND "accountId"=${job.accountId} AND "revision"=${job.revision} AND "requestId"=${job.requestId} AND "state"='RUNNING' AND "leaseOwner"=${owner} AND "leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
          if (!owned.length) return;
          const connection = await tx.avChannelConnection.findFirst({
            where: {
              ...scopeOf(job),
              revision: job.revision,
              verifiedRevision: job.revision,
              connectionState: "VERIFIED",
              verifiedAt: { not: null },
            },
            select: { id: true },
          });
          if (!connection)
            fail(
              "HISTORY_REVISION_CHANGED",
              "A configuração da conexão mudou. Confira o número antes de importar novamente.",
            );
          let importedConversations = 0,
            importedMessages = 0;
          const groups = new Map<string, typeof messages>();
          for (const message of messages)
            groups.set(message.senderKey, [
              ...(groups.get(message.senderKey) ?? []),
              message,
            ]);
          for (const sender of [...groups.keys()].sort()) {
            const group: typeof messages = [];
            for (const message of groups.get(sender)!) {
              const providerId = message.externalId.slice(8);
              const existing = await tx.avMessage.findFirst({
                where: {
                  ...scopeOf(job),
                  externalId: { in: [message.externalId, providerId] },
                },
                select: { id: true },
              });
              if (existing) skipped++;
              else group.push(message);
            }
            if (!group.length) continue;
            let conversation = await tx.avConversation.findUnique({
              where: {
                accountId_externalCustomerId: {
                  accountId: job.accountId,
                  externalCustomerId: sender,
                },
              },
            });
            if (!conversation) {
              const hint = group.find(
                (message) => !message.fromSelf && message.displayName?.trim(),
              )?.displayName;
              const displayName = hint
                ? maskVirtualSecrets(hint)
                    .replace(/[\u0000-\u001f\u007f]/g, " ")
                    .trim()
                    .slice(0, 160)
                : "Cliente do WhatsApp";
              const latest = new Date(
                Math.max(
                  ...group.map((message) =>
                    new Date(message.occurredAt).getTime(),
                  ),
                ),
              );
              conversation = await tx.avConversation.create({
                data: {
                  ...scopeOf(job),
                  externalCustomerId: sender,
                  displayName: displayName || "Cliente do WhatsApp",
                  status: "OPEN",
                  agentEnabled: false,
                  lastMessageAt: latest,
                },
              });
              importedConversations++;
            }
            await lockVirtualConversation(tx, conversation.id);
            let latest = conversation.lastMessageAt;
            for (const message of group.sort(
              (a, b) =>
                a.occurredAt.localeCompare(b.occurredAt) ||
                a.externalId.localeCompare(b.externalId),
            )) {
              const providerId = message.externalId.slice(8),
                externalId = message.fromSelf ? providerId : message.externalId;
              const existing = await tx.avMessage.findFirst({
                where: {
                  accountId: job.accountId,
                  externalId: { in: [message.externalId, providerId] },
                },
                select: { id: true },
              });
              if (existing) {
                skipped++;
                continue;
              }
              const occurredAt = new Date(message.occurredAt);
              await tx.avMessage.create({
                data: {
                  ...scopeOf(job),
                  conversationId: conversation.id,
                  externalId,
                  source: "HISTORY",
                  direction: message.fromSelf ? "OUTBOUND" : "INBOUND",
                  author: message.fromSelf ? "HUMAN" : "CUSTOMER",
                  text:
                    maskVirtualSecrets(message.text) ||
                    (message.kind === "AUDIO"
                      ? "[Áudio histórico sem transcrição confiável]"
                      : "[Mensagem histórica sem texto]"),
                  kind: message.kind,
                  transcriptionCertain:
                    message.kind === "TEXT" && message.transcriptionCertain,
                  createdAt: occurredAt,
                  processedAt: new Date(),
                },
              });
              importedMessages++;
              if (occurredAt > latest) latest = occurredAt;
            }
            const nameCurrent = await tx.avConversation.findUniqueOrThrow({
              where: { id: conversation.id },
            });
            await applyVirtualCustomerName(tx, nameCurrent);
            if (latest > conversation.lastMessageAt)
              await tx.avConversation.updateMany({
                where: {
                  ...scopeOf(job),
                  id: conversation.id,
                  lastMessageAt: { lt: latest },
                },
                data: { lastMessageAt: latest },
              });
          }
          const coverage = messages.map((message) =>
            new Date(message.occurredAt).getTime(),
          );
          const from = coverage.length
            ? new Date(
                Math.min(
                  ...coverage,
                  ...(job.coverageFrom ? [job.coverageFrom.getTime()] : []),
                ),
              )
            : job.coverageFrom;
          const until = coverage.length
            ? new Date(
                Math.max(
                  ...coverage,
                  ...(job.coverageUntil ? [job.coverageUntil.getTime()] : []),
                ),
              )
            : job.coverageUntil;
          const complete = page.nextPage === null,
            partial = !complete && job.pagesProcessed + 1 >= 1000;
          const progress = {
            importedConversations: { increment: importedConversations },
            importedMessages: { increment: importedMessages },
            skippedMessages: { increment: skipped },
            pagesProcessed: { increment: 1 },
            nextPage: page.nextPage ?? job.nextPage,
            state: complete ? "COMPLETE" : partial ? "PARTIAL" : "RUNNING",
            complete,
            finishedAt: complete || partial ? new Date() : null,
            limitReason: partial
              ? "Limite de 1000 páginas nesta etapa. Continue a importação para buscar o restante."
              : null,
            coverageFrom: from,
            coverageUntil: until,
            lastPageHash: fingerprint,
            attempts: 0,
            error: null,
            leaseOwner: null,
            leaseUntil: null,
          };
          if (stream === "RECENT")
            await tx.avChannelHistoryRecentSync.update({
              where: { id: job.id },
              data: {
                ...progress,
                ...(complete ? { lastSyncedAt: new Date() } : {}),
              },
            });
          else
            await tx.avChannelHistorySync.update({
              where: { id: job.id },
              data: progress,
            });
          if (complete || partial)
            await virtualAudit(
              tx,
              scopeOf(job),
              job.requestedById,
              "HISTORY_SYNC_FINISHED",
              { accountId: job.accountId, complete, partial, stream },
            );
        },
        { timeout: 20000 },
      );
      processed++;
    } catch (error) {
      await failJob(job, owner, error, stream);
    }
  }
  return processed;
}
