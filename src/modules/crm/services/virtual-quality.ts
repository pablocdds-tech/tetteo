import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { CrmError } from "./campaign-domain";
import { authorizeVirtual } from "./virtual-runtime";

const periodSchema = z.coerce
  .number()
  .int()
  .refine((days) => [7, 30, 90].includes(days));
// Arbitrary exception messages can contain provider bodies or customer text.
// Report only known operational codes to this read-only metrics endpoint.
const ERROR_CODES = new Set([
  "EMPTY_RESPONSE",
  "EMPTY_REPLY",
  "TURN_LIMIT",
  "CLAIM_BLOCKED",
  "TOOL_LOOP",
  "CONVERSATION_LOOP",
  "STALE_TURN",
  "LEASE_EXPIRED",
  "ACCOUNT_SETTINGS_CHANGED",
  "MODEL_CONFIGURATION_CHANGED",
  "MODEL_TIMEOUT",
  "MODEL_PROVIDER_FAILED",
  "MODEL_OUTPUT_INVALID",
  "DAILY_BUDGET",
  "TURN_BUDGET",
  "CHANNEL_UNAVAILABLE",
]);
export async function virtualQuality(
  context: ContextoSessao,
  storeId: string,
  accountId?: string,
  periodDays: unknown = 30,
) {
  const scope = await authorizeVirtual(context, storeId);
  const days = periodSchema.parse(periodDays);
  return db.$transaction(
    async (tx) => {
      const account = await tx.avChannelAccount.findFirst({
        where: {
          organizationId: scope.organizationId,
          storeId,
          ...(accountId ? { id: accountId } : { mode: "DEMO" }),
        },
        select: { id: true },
      });
      if (!account)
        throw new CrmError(
          "ACCOUNT_NOT_FOUND",
          "Canal indisponível nesta unidade.",
          404,
        );
      const filter = {
        organizationId: scope.organizationId,
        storeId,
        accountId: account.id,
      };
      const where = {
        ...filter,
        createdAt: { gte: new Date(Date.now() - days * 86_400_000) },
      };
      const [
        groups,
        totals,
        runs,
        emptyResponses,
        loopsBlocked,
        pendingEscalations,
        toolFailures,
        percentiles,
      ] = await Promise.all([
        tx.avAgentRun.groupBy({ by: ["status"], where, _count: true }),
        tx.avAgentRun.aggregate({
          where,
          _sum: { tokens: true, costMicros: true },
          _count: true,
        }),
        tx.avAgentRun.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
          select: {
            id: true,
            status: true,
            model: true,
            tokens: true,
            costMicros: true,
            latencyMs: true,
            error: true,
            createdAt: true,
            conversationId: true,
          },
        }),
        tx.avAgentRun.count({
          where: { ...where, error: { in: ["EMPTY_RESPONSE", "EMPTY_REPLY"] } },
        }),
        tx.avAgentRun.count({
          where: {
            ...where,
            error: { in: ["CONVERSATION_LOOP", "TOOL_LOOP"] },
          },
        }),
        tx.avEscalation.count({
          where: { ...filter, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        }),
        tx.avToolExecution.count({ where: { ...where, success: false } }),
        tx.$queryRaw<
          { p50: number | null; p95: number | null }[]
        >`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95 FROM "AvAgentRun" WHERE "organizationId"=${filter.organizationId} AND "storeId"=${storeId} AND "accountId"=${account.id} AND "createdAt">=${where.createdAt.gte} AND "status"<>'RUNNING'`,
      ]);
      const count = (status: string) =>
        groups.find((g) => g.status === status)?._count ?? 0;
      return {
        periodDays: days,
        total: totals._count,
        completed: count("COMPLETED"),
        failed: count("FAILED"),
        discarded: count("DISCARDED"),
        emptyResponses,
        loopsBlocked,
        pendingEscalations,
        costMicros: totals._sum.costMicros ?? 0,
        tokens: totals._sum.tokens ?? 0,
        latencyP50: percentiles[0]?.p50 ?? null,
        latencyP95: percentiles[0]?.p95 ?? null,
        toolFailures,
        runs: runs.map((run) => ({
          ...run,
          model: /^[\w./:-]{1,160}$/.test(run.model)
            ? run.model
            : "UNAVAILABLE",
          error: run.error
            ? ERROR_CODES.has(run.error)
              ? run.error
              : "EXECUTION_FAILED"
            : null,
          createdAt: run.createdAt.toISOString(),
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
