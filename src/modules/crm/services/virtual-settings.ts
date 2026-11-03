import { z } from "zod";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { CrmError } from "./campaign-domain";
import {
  authorizeVirtual,
  lockVirtualConversation,
  virtualAudit,
  type VirtualTx,
} from "./virtual-runtime";

async function authorizedDestinations(
  tx: VirtualTx,
  organizationId: string,
  storeId: string,
) {
  const accesses = await tx.acesso.findMany({
    where: {
      organizacaoId: organizationId,
      status: "ATIVO",
      excluidoEm: null,
      OR: [{ unidadeId: storeId }, { unidadeId: null }],
      usuario: { status: "ATIVO", excluidoEm: null },
    },
    select: {
      usuario: { select: { id: true, nome: true } },
      papel: { select: { permissoes: { select: { chave: true } } } },
    },
  });
  const operators = new Map<
    string,
    { id: string; name: string; permissions: Set<string> }
  >();
  for (const access of accesses) {
    const operator = operators.get(access.usuario.id) ?? {
      id: access.usuario.id,
      name: access.usuario.nome,
      permissions: new Set<string>(),
    };
    access.papel.permissoes.forEach((p) => operator.permissions.add(p.chave));
    operators.set(operator.id, operator);
  }
  return [...operators.values()]
    .filter((operator) => {
      const scope = { permissoes: operator.permissions };
      return pode(scope, "crm.ver") && pode(scope, "crm.editar");
    })
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
export async function virtualSettings(
  context: ContextoSessao,
  storeId: string,
) {
  const scope = await authorizeVirtual(context, storeId);
  return db.$transaction(
    async (tx) => {
      const account = await tx.avChannelAccount.findFirst({
        where: { organizationId: scope.organizationId, storeId, mode: "DEMO" },
        select: {
          id: true,
          active: true,
          debounceMs: true,
          maxWaitMs: true,
          maxTurnTokens: true,
          maxTurnCostMicros: true,
          dailyBudgetMicros: true,
          circuitUntil: true,
          notificationUserId: true,
        },
      });
      return {
        account: account
          ? {
              ...account,
              circuitUntil: account.circuitUntil?.toISOString() ?? null,
            }
          : null,
        destinations: await authorizedDestinations(
          tx,
          scope.organizationId,
          storeId,
        ),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
const settingsSchema = z
  .object({
    storeId: z.string().min(1).max(128),
    active: z.boolean(),
    debounceMs: z.number().int().min(0).max(10000),
    maxWaitMs: z.number().int().min(250).max(60000),
    maxTurnTokens: z.number().int().min(128).max(16000),
    maxTurnCostMicros: z.number().int().min(1).max(100_000_000),
    dailyBudgetMicros: z.number().int().min(1).max(1_000_000_000),
    notificationUserId: z.string().min(1).max(128).nullable(),
    circuitMinutes: z.number().int().min(0).max(10080),
  })
  .strict()
  .refine((data) => data.maxWaitMs >= data.debounceMs, {
    path: ["maxWaitMs"],
    message:
      "O limite de agrupamento deve ser igual ou maior que o intervalo entre mensagens.",
  })
  .refine((data) => data.dailyBudgetMicros >= data.maxTurnCostMicros, {
    path: ["dailyBudgetMicros"],
    message: "O teto diário deve cobrir pelo menos um turno.",
  });
export async function changeVirtualSettings(
  context: ContextoSessao,
  raw: unknown,
) {
  const data = settingsSchema.parse(raw);
  const scope = await authorizeVirtual(context, data.storeId, true, true);
  await db.$transaction(
    async (tx) => {
      const account = await tx.avChannelAccount.findFirst({
        where: {
          organizationId: scope.organizationId,
          storeId: data.storeId,
          mode: "DEMO",
        },
      });
      if (!account)
        throw new CrmError(
          "ACCOUNT_MISSING",
          "Inicie a demonstração antes de configurar o atendimento.",
          409,
        );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${account.id}`}))`;
      const destinations = await authorizedDestinations(
        tx,
        scope.organizationId,
        data.storeId,
      );
      if (
        data.notificationUserId &&
        !destinations.some((d) => d.id === data.notificationUserId)
      )
        throw new CrmError(
          "INVALID_DESTINATION",
          "Escolha uma pessoa ativa e autorizada a atender nesta unidade.",
          403,
        );
      const leased = await tx.avConversation.findMany({
        where: { accountId: account.id, leaseOwner: { not: null } },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      for (const conversation of leased) {
        await lockVirtualConversation(tx, conversation.id);
        await tx.avConversation.update({
          where: { id: conversation.id },
          data: {
            version: { increment: 1 },
            leaseOwner: null,
            leaseUntil: null,
          },
        });
        await tx.avAgentRun.updateMany({
          where: { conversationId: conversation.id, status: "RUNNING" },
          data: {
            status: "DISCARDED",
            error: "ACCOUNT_SETTINGS_CHANGED",
            completedAt: new Date(),
          },
        });
      }
      const { circuitMinutes } = data;
      await tx.avChannelAccount.update({
        where: { id: account.id },
        data: {
          active: data.active,
          debounceMs: data.debounceMs,
          maxWaitMs: data.maxWaitMs,
          maxTurnTokens: data.maxTurnTokens,
          maxTurnCostMicros: data.maxTurnCostMicros,
          dailyBudgetMicros: data.dailyBudgetMicros,
          notificationUserId: data.notificationUserId,
          circuitUntil: circuitMinutes
            ? new Date(Date.now() + circuitMinutes * 60_000)
            : null,
        },
      });
      await virtualAudit(
        tx,
        { organizationId: scope.organizationId, storeId: data.storeId },
        context.usuario.id,
        "ACCOUNT_SETTINGS_CHANGED",
        {
          accountId: account.id,
          active: data.active,
          debounceMs: data.debounceMs,
          maxWaitMs: data.maxWaitMs,
          maxTurnTokens: data.maxTurnTokens,
          maxTurnCostMicros: data.maxTurnCostMicros,
          dailyBudgetMicros: data.dailyBudgetMicros,
          notificationUserId: data.notificationUserId,
          circuitMinutes,
        },
      );
    },
    { timeout: 20000 },
  );
  return virtualSettings(context, data.storeId);
}
