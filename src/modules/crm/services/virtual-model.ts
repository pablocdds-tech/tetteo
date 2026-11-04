import { z } from "zod";
import { db } from "@/server/db";
import {
  encryptVirtualCredential,
  decryptVirtualCredential,
} from "@/server/ia/credencial-atendimento";
import {
  extractVirtualModelIntent,
  listVirtualGeminiModels,
} from "@/server/ia/atendimento";
import {
  MODEL_TEST_VALID_MS,
  scopedEnvironmentModelConfiguration,
} from "@/server/ia/modelo-atendimento-config";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import type { VirtualModelStatus } from "../virtual-types";
import { CrmError } from "./campaign-domain";
import {
  authorizeVirtual,
  lockVirtualConversation,
  virtualAudit,
  type VirtualTx,
} from "./virtual-runtime";
import { virtualIntentSchema } from "./virtual-agent-plan";

type Scope = { organizationId: string; storeId: string };
async function lockModel(tx: VirtualTx, scope: Scope) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`av:model:${scope.organizationId}:${scope.storeId}`},0))`;
}
async function invalidateModelTurns(tx: VirtualTx, scope: Scope) {
  const conversations = await tx.avConversation.findMany({
    where: { ...scope, leaseOwner: { not: null } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const conversation of conversations) {
    await lockVirtualConversation(tx, conversation.id);
    await tx.avConversation.update({
      where: { id: conversation.id },
      data: { version: { increment: 1 }, leaseOwner: null, leaseUntil: null },
    });
    await tx.avAgentRun.updateMany({
      where: { conversationId: conversation.id, status: "RUNNING" },
      data: {
        status: "DISCARDED",
        error: "MODEL_CONFIGURATION_CHANGED",
        completedAt: new Date(),
      },
    });
  }
}
export async function safeVirtualModelStatus(
  scope: Scope,
): Promise<VirtualModelStatus> {
  const row = await db.avModelConfiguration.findUnique({
    where: { organizationId_storeId: scope },
  });
  if (!row) {
    const env = scopedEnvironmentModelConfiguration(scope);
    return {
      provider: "GEMINI",
      source: env.source ?? "NONE",
      credentialPresent: !!env.apiKey,
      model: env.model || null,
      revision: 0,
      enabled: env.enabled && env.configured,
      rates: {
        inputMicrosPerMillion: Number.isFinite(env.inputRate)
          ? env.inputRate
          : 0,
        outputMicrosPerMillion: Number.isFinite(env.outputRate)
          ? env.outputRate
          : 0,
        confirmed: env.configured,
      },
      test: {
        state: "NONE",
        revision: null,
        testedAt: null,
        errorCode: null,
        tokens: 0,
        costMicros: 0,
      },
      blockers: env.configured
        ? env.enabled
          ? []
          : ["O modelo está desativado no ambiente."]
        : [
            "Cadastre a chave do Gemini em Assistente e faça o teste com mensagem fictícia.",
          ],
    };
  }
  let credentialPresent = false;
  try {
    credentialPresent = !!decryptVirtualCredential(scope, row.encryptedKey);
  } catch {}
  const tested =
    row.testState === "PASSED" &&
    row.testedRevision === row.revision &&
    !!row.testedAt &&
    row.testedAt.getTime() > Date.now() - MODEL_TEST_VALID_MS;
  const blockers: string[] = [];
  if (!credentialPresent)
    blockers.push(
      "A chave privada está ausente ou não pôde ser lida. Cadastre a chave novamente.",
    );
  if (!row.model)
    blockers.push("Selecione um modelo disponível na sua conta Gemini.");
  if (!row.ratesConfirmed)
    blockers.push("Confira e confirme as tarifas do modelo.");
  if (!tested)
    blockers.push(
      "Execute um teste bem-sucedido da revisão atual antes de ativar.",
    );
  else if (!row.enabled)
    blockers.push(
      "O teste passou. Ative esta revisão para usar o Gemini nas conversas.",
    );
  return {
    provider: "GEMINI",
    source: "DATABASE",
    credentialPresent,
    model: row.model || null,
    revision: row.revision,
    enabled: row.enabled && credentialPresent && tested && row.ratesConfirmed,
    rates: {
      inputMicrosPerMillion: row.inputMicrosPerMillion,
      outputMicrosPerMillion: row.outputMicrosPerMillion,
      confirmed: row.ratesConfirmed,
    },
    test: {
      state: row.testState as VirtualModelStatus["test"]["state"],
      revision: row.testedRevision,
      testedAt: row.testedAt?.toISOString() ?? null,
      errorCode: row.testError,
      tokens: row.testTokens,
      costMicros: row.testCostMicros,
    },
    blockers,
  };
}
export async function getVirtualModelStatus(
  ctx: ContextoSessao,
  storeId: string,
) {
  const scope = await authorizeVirtual(ctx, storeId);
  return safeVirtualModelStatus({
    organizationId: scope.organizationId,
    storeId,
  });
}
const save = z
  .object({
    storeId: z.string().min(1).max(128),
    action: z.literal("save"),
    apiKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{8,512}$/)
      .optional(),
    model: z
      .string()
      .trim()
      .max(128)
      .regex(/^(?:gemini-[a-zA-Z0-9.-]+)?$/),
    ratesConfirmed: z.boolean(),
    inputMicrosPerMillion: z.number().int().min(0).max(1_000_000_000),
    outputMicrosPerMillion: z.number().int().min(0).max(1_000_000_000),
  })
  .strict();
const probe = z
  .object({
    storeId: z.string().min(1).max(128),
    action: z.literal("test"),
    revision: z.number().int().positive(),
    requestId: z.string().uuid(),
  })
  .strict();
const activate = z
  .object({
    storeId: z.string().min(1).max(128),
    action: z.literal("activate"),
    revision: z.number().int().positive(),
    enabled: z.boolean(),
  })
  .strict();
const models = z
  .object({ storeId: z.string().min(1).max(128), action: z.literal("models") })
  .strict();
const requestSchema = z.discriminatedUnion("action", [
  save,
  probe,
  activate,
  models,
]);
export async function changeVirtualModel(ctx: ContextoSessao, raw: unknown) {
  const data = requestSchema.parse(raw);
  const authorized = await authorizeVirtual(ctx, data.storeId, true, true);
  const scope = {
    organizationId: authorized.organizationId,
    storeId: data.storeId,
  };
  if (data.action === "save") {
    await db.$transaction(async (tx) => {
      await lockModel(tx, scope);
      const prior = await tx.avModelConfiguration.findUnique({
        where: { organizationId_storeId: scope },
      });
      const rawKey = data.apiKey;
      if (!prior && !rawKey)
        throw new CrmError(
          "MODEL_KEY_MISSING",
          "Informe a chave no campo privado do painel.",
          400,
        );
      const encryptedKey = rawKey
        ? encryptVirtualCredential(scope, rawKey)
        : prior!.encryptedKey;
      const values = {
        model: data.model,
        encryptedKey,
        inputMicrosPerMillion: data.inputMicrosPerMillion,
        outputMicrosPerMillion: data.outputMicrosPerMillion,
        ratesConfirmed: data.ratesConfirmed,
        enabled: false,
        testState: "PENDING",
        testedRevision: null,
        testedAt: null,
        testError: null,
        testTokens: 0,
        testCostMicros: 0,
        updatedById: ctx.usuario.id,
      };
      const row = await tx.avModelConfiguration.upsert({
        where: { organizationId_storeId: scope },
        create: { ...scope, ...values },
        update: { ...values, revision: { increment: 1 } },
      });
      await invalidateModelTurns(tx, scope);
      await virtualAudit(tx, scope, ctx.usuario.id, "MODEL_CONFIG_SAVED", {
        revision: row.revision,
        model: row.model,
        credentialChanged: !!rawKey,
      });
    });
  } else if (data.action === "models") {
    const row = await db.avModelConfiguration.findUnique({
      where: { organizationId_storeId: scope },
    });
    if (!row)
      throw new CrmError(
        "MODEL_KEY_MISSING",
        "Salve a chave privada antes de consultar os modelos.",
        409,
      );
    try {
      return {
        models: await listVirtualGeminiModels(
          decryptVirtualCredential(scope, row.encryptedKey),
        ),
      };
    } catch {
      throw new CrmError(
        "MODEL_CATALOG_FAILED",
        "Não foi possível consultar os modelos. Confira a chave, as permissões e a disponibilidade do Gemini.",
        503,
      );
    }
  } else if (data.action === "activate") {
    await db.$transaction(async (tx) => {
      await lockModel(tx, scope);
      const row = await tx.avModelConfiguration.findUnique({
        where: { organizationId_storeId: scope },
      });
      if (!row || row.revision !== data.revision)
        throw new CrmError(
          "MODEL_REVISION_CHANGED",
          "A configuração mudou. Atualize a página.",
          409,
        );
      if (
        data.enabled &&
        (!row.ratesConfirmed ||
          !row.model ||
          row.testState !== "PASSED" ||
          row.testedRevision !== row.revision ||
          !row.testedAt ||
          row.testedAt.getTime() <= Date.now() - MODEL_TEST_VALID_MS)
      )
        throw new CrmError(
          "MODEL_TEST_REQUIRED",
          "Teste esta revisão com sucesso antes de ativar.",
          409,
        );
      if (data.enabled) decryptVirtualCredential(scope, row.encryptedKey);
      await tx.avModelConfiguration.update({
        where: { id: row.id },
        data: { enabled: data.enabled, updatedById: ctx.usuario.id },
      });
      await invalidateModelTurns(tx, scope);
      await virtualAudit(
        tx,
        scope,
        ctx.usuario.id,
        "MODEL_ACTIVATION_CHANGED",
        { revision: row.revision, enabled: data.enabled },
      );
    });
  } else {
    const prepared = await db.$transaction(async (tx) => {
      await lockModel(tx, scope);
      const prior = await tx.avModelProbe.findUnique({
        where: {
          organizationId_storeId_requestId: {
            ...scope,
            requestId: data.requestId,
          },
        },
      });
      if (prior) {
        if (prior.actorId !== ctx.usuario.id)
          throw new CrmError(
            "MODEL_TEST_CONFLICT",
            "Essa tentativa já pertence a outro operador.",
            409,
          );
        if (
          prior.state === "RUNNING" &&
          prior.createdAt.getTime() < Date.now() - 60_000
        ) {
          await tx.avModelProbe.updateMany({
            where: { id: prior.id, state: "RUNNING" },
            data: {
              state: "FAILED",
              errorCode: "MODEL_TEST_TIMEOUT",
              completedAt: new Date(),
            },
          });
          await tx.avModelConfiguration.updateMany({
            where: {
              id: prior.configurationId,
              revision: prior.revision,
              testState: "TESTING",
              testedRevision: prior.revision,
            },
            data: {
              testState: "FAILED",
              testError: "MODEL_TEST_TIMEOUT",
              testedAt: new Date(),
              enabled: false,
            },
          });
          await virtualAudit(
            tx,
            scope,
            ctx.usuario.id,
            "MODEL_TEST_RECONCILED",
            { probeId: prior.id, errorCode: "MODEL_TEST_TIMEOUT" },
          );
        }
        return null;
      }
      const row = await tx.avModelConfiguration.findUnique({
        where: { organizationId_storeId: scope },
      });
      if (!row || row.revision !== data.revision)
        throw new CrmError(
          "MODEL_REVISION_CHANGED",
          "Atualize a configuração antes de testar.",
          409,
        );
      if (!row.model || !row.ratesConfirmed)
        throw new CrmError(
          "MODEL_CONFIG_INCOMPLETE",
          "Selecione o modelo e confirme as tarifas antes de testar.",
          400,
        );
      const since = new Date(Date.now() - 86_400_000);
      const recent = await tx.avModelProbe.count({
        where: {
          ...scope,
          createdAt: { gte: new Date(Date.now() - 3_600_000) },
        },
      });
      if (recent >= 3)
        throw new CrmError(
          "MODEL_TEST_RATE_LIMIT",
          "Limite de três testes por hora nesta unidade. Aguarde antes de testar novamente.",
          429,
        );
      if (
        await tx.avModelProbe.count({
          where: {
            ...scope,
            state: "RUNNING",
            createdAt: { gte: new Date(Date.now() - 60_000) },
          },
        })
      )
        throw new CrmError(
          "MODEL_TEST_RUNNING",
          "Já existe um teste em andamento.",
          409,
        );
      await tx.avModelProbe.updateMany({
        where: {
          ...scope,
          state: "RUNNING",
          createdAt: { lt: new Date(Date.now() - 60_000) },
        },
        data: {
          state: "FAILED",
          errorCode: "MODEL_TEST_TIMEOUT",
          completedAt: new Date(),
        },
      });
      await invalidateModelTurns(tx, scope);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`virtual-budget:${scope.organizationId}:${scope.storeId}`},0))`;
      const account = await tx.avChannelAccount.findFirst({
        where: scope,
        select: { dailyBudgetMicros: true, maxTurnCostMicros: true },
      });
      const [runs, probes] = await Promise.all([
        tx.avAgentRun.aggregate({
          where: { ...scope, createdAt: { gte: since } },
          _sum: { costMicros: true },
        }),
        tx.avModelProbe.aggregate({
          where: { ...scope, createdAt: { gte: since } },
          _sum: { costMicros: true },
        }),
      ]);
      const bound = Math.ceil(
        (2048 *
          Math.max(row.inputMicrosPerMillion, row.outputMicrosPerMillion)) /
          1_000_000,
      );
      if (
        bound > (account?.maxTurnCostMicros ?? 100000) ||
        (runs._sum.costMicros ?? 0) + (probes._sum.costMicros ?? 0) + bound >
          (account?.dailyBudgetMicros ?? 5_000_000)
      )
        throw new CrmError(
          "MODEL_TEST_BUDGET",
          "O teste excede os limites de custo da unidade. Confira as tarifas e os tetos.",
          409,
        );
      const apiKey = decryptVirtualCredential(scope, row.encryptedKey);
      const execution = await tx.avModelProbe.create({
        data: {
          ...scope,
          configurationId: row.id,
          revision: row.revision,
          actorId: ctx.usuario.id,
          requestId: data.requestId,
          costMicros: bound,
        },
      });
      await tx.avModelConfiguration.update({
        where: { id: row.id },
        data: {
          testState: "TESTING",
          testedRevision: row.revision,
          testedAt: null,
          testError: null,
          testCostMicros: bound,
          testTokens: 0,
          enabled: false,
        },
      });
      await virtualAudit(tx, scope, ctx.usuario.id, "MODEL_TEST_STARTED", {
        revision: row.revision,
        probeId: execution.id,
      });
      return { row, apiKey, probeId: execution.id, bound };
    });
    if (prepared) {
      let success = false,
        errorCode: string | null = null,
        tokens = 0,
        costMicros = prepared.bound;
      try {
        const result = await extractVirtualModelIntent(
          {
            messages: [
              "Mensagem fictícia de teste: qual o horário de funcionamento?",
            ],
            now: new Date().toISOString(),
            timezone: authorized.unit.fusoHorario,
            maxTokens: 2048,
            timeoutMs: 15000,
          },
          {
            enabled: true,
            configured: true,
            model: prepared.row.model,
            apiKey: prepared.apiKey,
            inputRate: prepared.row.inputMicrosPerMillion,
            outputRate: prepared.row.outputMicrosPerMillion,
          },
        );
        const plan = virtualIntentSchema.parse(result.plan);
        if (plan.intent !== "hours")
          throw new Error("MODEL_TEST_UNEXPECTED_INTENT");
        success = true;
        tokens = result.tokens;
        costMicros = result.costMicros;
      } catch (error) {
        errorCode =
          error instanceof Error && /^MODEL_[A-Z_]+$/.test(error.message)
            ? error.message
            : "MODEL_TEST_FAILED";
      }
      await db.$transaction(async (tx) => {
        await lockModel(tx, scope);
        const changed = await tx.avModelProbe.updateMany({
          where: { id: prepared.probeId, state: "RUNNING" },
          data: {
            state: success ? "PASSED" : "FAILED",
            errorCode,
            tokens,
            costMicros,
            completedAt: new Date(),
          },
        });
        if (changed.count)
          await tx.avModelConfiguration.updateMany({
            where: { id: prepared.row.id, revision: prepared.row.revision },
            data: {
              testState: success ? "PASSED" : "FAILED",
              testedRevision: prepared.row.revision,
              testedAt: new Date(),
              testError: errorCode,
              testTokens: tokens,
              testCostMicros: costMicros,
            },
          });
        await virtualAudit(tx, scope, ctx.usuario.id, "MODEL_TEST_COMPLETED", {
          probeId: prepared.probeId,
          success,
          errorCode,
        });
      });
    }
  }
  return safeVirtualModelStatus(scope);
}
