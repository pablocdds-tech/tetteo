import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import {
  allowedEvolutionOrigins,
  acceptedEvolutionUrl,
  reservedEvolutionInstance,
  encryptChannelValue,
  decryptChannelValue,
  channelRecipientHash,
  type ChannelSecrets,
} from "@/server/atendimento-credenciais";
import {
  channelServiceWindow,
  recordedChannelReceipt,
  reconcileStoredChannelDeliveries,
} from "@/server/atendimento-contas";
import type { ChannelManagementFactory } from "@/server/atendimento-provedor";
import {
  authorizeVirtual,
  lockVirtualConversation,
  virtualAudit,
  type VirtualTx,
} from "./virtual-runtime";
import { safeVirtualModelStatus } from "./virtual-model";
import { approvedVirtualKnowledge } from "./virtual-knowledge";
import { CrmError } from "./campaign-domain";
function fail(code: string, message: string, status = 409): never {
  throw new CrmError(code, message, status);
}
const scopeFields = { storeId: z.string().min(1).max(128) };
const privateText = z
  .string()
  .trim()
  .min(8)
  .max(4096)
  .refine((v) => !/[\r\n\0]/.test(v));
const save = z.discriminatedUnion("provider", [
  z
    .object({
      ...scopeFields,
      action: z.literal("save"),
      accountId: z.string().uuid().optional(),
      name: z.string().trim().min(2).max(100),
      provider: z.literal("EVOLUTION"),
      url: z.string().max(300),
      instance: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
      apiKey: privateText.optional(),
      webhookSecret: privateText.refine((v) => v.length >= 32).optional(),
    })
    .strict(),
  z
    .object({
      ...scopeFields,
      action: z.literal("save"),
      accountId: z.string().uuid().optional(),
      name: z.string().trim().min(2).max(100),
      provider: z.literal("META"),
      phoneNumberId: z.string().regex(/^\d{5,30}$/),
      businessAccountId: z.string().regex(/^\d{5,30}$/),
      apiVersion: z
        .string()
        .regex(/^v\d{2}\.0$/)
        .default("v26.0"),
      accessToken: privateText.optional(),
      appSecret: privateText.optional(),
      verifyToken: privateText.refine((v) => v.length >= 16).optional(),
    })
    .strict(),
]);
const common = {
  ...scopeFields,
  accountId: z.string().uuid(),
  revision: z.number().int().positive(),
};
const operations = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("createInstance") }).strict(),
  z.object({ ...common, action: z.literal("verify") }).strict(),
  z.object({ ...common, action: z.literal("qr") }).strict(),
  z
    .object({
      ...common,
      action: z.literal("webhook"),
      replaceExistingWebhook: z.boolean().default(false),
    })
    .strict(),
  z
    .object({ ...common, action: z.literal("activate"), enabled: z.boolean() })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("sendTest"),
      recipient: z.string().regex(/^\+[1-9]\d{7,14}$/),
      confirmedTestNumber: z.literal(true),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("ackTest"),
      testId: z.string().uuid(),
      confirmedObserved: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("reconcileTest"),
      testId: z.string().uuid().optional(),
    })
    .strict(),
]);
export function channelWebhookUrl(provider: string, id: string) {
  try {
    const base = new URL(process.env.APP_URL ?? "");
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      return "";
    return `${base.origin}/api/atendimento/${provider.toLowerCase()}/${id}`;
  } catch {
    return "";
  }
}
const maskPhone = (phone: string) =>
  `${phone.slice(0, 3)}••••${phone.slice(-4)}`;
export async function virtualChannels(ctx: ContextoSessao, storeId: string) {
  const scope = await authorizeVirtual(ctx, storeId);
  const rows = await db.avChannelAccount.findMany({
    where: { organizationId: scope.organizationId, storeId },
    include: {
      connection: true,
      channelTests: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });
  const model = await safeVirtualModelStatus({
    organizationId: scope.organizationId,
    storeId,
  });
  const accounts = await Promise.all(
    rows.map(async (row) => {
      const connection = row.connection,
        fullScope = {
          organizationId: scope.organizationId,
          storeId,
          accountId: row.id,
        },
        test = row.channelTests[0],
        blockers: string[] = [];
      let credentialPresent = false,
        recipientMasked = "••••";
      if (connection)
        try {
          credentialPresent = !!JSON.parse(
            decryptChannelValue(fullScope, connection.encryptedCredentials),
          );
        } catch {}
      if (test)
        try {
          recipientMasked = maskPhone(
            decryptChannelValue(fullScope, test.encryptedRecipient),
          );
        } catch {}
      if (row.mode !== "DEMO") {
        if (!credentialPresent)
          blockers.push("Cadastre as credenciais privadas desta conta.");
        if (
          !connection ||
          connection.connectionState !== "VERIFIED" ||
          connection.verifiedRevision !== connection.revision
        )
          blockers.push("Verifique a conexão da revisão atual.");
        if (!connection?.webhookSeenAt)
          blockers.push("Aguardando webhook autenticado desta conta.");
        if (
          !test?.deliveredAt ||
          !test.observedAt ||
          test.revision !== connection?.revision
        )
          blockers.push(
            "Envie um teste ao seu número, aguarde entrega e confirme a observação.",
          );
        if (!model.enabled)
          blockers.push("Configure, teste e ative o Gemini em Configuração.");
        const facts = await db.$transaction((tx) =>
          approvedVirtualKnowledge(tx, fullScope, new Date()),
        );
        if (!facts)
          blockers.push(
            "Publique os dados reais e válidos desta conta em Configuração.",
          );
        if (!channelWebhookUrl(row.mode, row.id))
          blockers.push(
            "Configure APP_URL com o domínio HTTPS público do sistema.",
          );
      }
      return {
        id: row.id,
        name: row.name,
        provider: row.mode,
        mode: row.mode,
        active: row.active,
        revision: connection?.revision ?? 0,
        credentialPresent,
        settings: connection?.settings ?? {},
        connectionState: connection?.connectionState ?? "PENDING",
        verifiedAt: connection?.verifiedAt?.toISOString() ?? null,
        webhookSeenAt: connection?.webhookSeenAt?.toISOString() ?? null,
        webhookUrl: channelWebhookUrl(row.mode, row.id),
        lastError: connection?.lastError ?? null,
        latestTest: test
          ? {
              id: test.id,
              state: test.state,
              recipientMasked,
              observedAt: test.observedAt?.toISOString() ?? null,
              error: test.error,
              createdAt: test.createdAt.toISOString(),
            }
          : null,
        blockers,
      };
    }),
  );
  return {
    accounts,
    allowedEvolutionOrigins: allowedEvolutionOrigins(),
    legacyReservedInstance: process.env.EVOLUTION_INSTANCIA ?? null,
  };
}
async function invalidateAccount(tx: VirtualTx, accountId: string) {
  const conversations = await tx.avConversation.findMany({
    where: { accountId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const c of conversations) {
    await lockVirtualConversation(tx, c.id);
    await tx.avConversation.update({
      where: { id: c.id },
      data: { version: { increment: 1 }, leaseOwner: null, leaseUntil: null },
    });
  }
  await tx.avAgentRun.updateMany({
    where: { accountId, status: "RUNNING" },
    data: {
      status: "DISCARDED",
      error: "CHANNEL_CONFIGURATION_CHANGED",
      completedAt: new Date(),
    },
  });
  await tx.avMessageOutbox.updateMany({
    where: { accountId, state: "PENDING" },
    data: { state: "DISCARDED", error: "CHANNEL_CONFIGURATION_CHANGED" },
  });
}
async function saveChannel(ctx: ContextoSessao, raw: unknown) {
  const data = save.parse(raw),
    scope = await authorizeVirtual(ctx, data.storeId, true, true);
  if (data.provider === "EVOLUTION" && acceptedEvolutionUrl(data.url))
    data.url = new URL(data.url).toString().replace(/\/+$/, "");
  if (data.provider === "EVOLUTION") {
    if (!acceptedEvolutionUrl(data.url))
      fail(
        "EVOLUTION_ORIGIN_FORBIDDEN",
        "Escolha um servidor Evolution autorizado pelo administrador.",
        400,
      );
    if (reservedEvolutionInstance(data.url, data.instance))
      fail(
        "STAFF_INSTANCE_RESERVED",
        "Esta instância atende os avisos internos. Crie uma instância exclusiva para clientes.",
        409,
      );
  }
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:channels:${scope.organizationId}:${data.storeId}`}))`;
      if (data.accountId)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${data.accountId}`}))`;
      const existing = data.accountId
        ? await tx.avChannelAccount.findFirst({
            where: {
              id: data.accountId,
              organizationId: scope.organizationId,
              storeId: data.storeId,
            },
            include: { connection: true },
          })
        : null;
      if (data.accountId && !existing)
        fail("NOT_FOUND", "Conta não encontrada nesta unidade.", 404);
      if (existing && existing.mode !== data.provider)
        fail("PROVIDER_IMMUTABLE", "Crie outra conta para trocar de provedor.");
      const settings =
        data.provider === "META"
          ? {
              phoneNumberId: data.phoneNumberId,
              businessAccountId: data.businessAccountId,
              apiVersion: data.apiVersion,
            }
          : { url: data.url.replace(/\/+$/, ""), instance: data.instance };
      const bindingKey =
        data.provider === "META"
          ? `meta:${data.phoneNumberId}`
          : `evolution:${data.url.replace(/\/+$/, "")}:${data.instance}`;
      if (existing?.connection && existing.connection.bindingKey !== bindingKey)
        fail(
          "IDENTITY_IMMUTABLE",
          "Para alterar número, servidor ou instância, crie outra conta. O histórico mantém a identidade original.",
        );
      const used = await tx.avChannelConnection.findUnique({
        where: { bindingKey },
      });
      if (used && used.accountId !== existing?.id)
        fail(
          "CHANNEL_ALREADY_BOUND",
          "Este número ou instância já está vinculado. Use outra conta do provedor.",
        );
      const id = existing?.id ?? randomUUID(),
        fullScope = {
          organizationId: scope.organizationId,
          storeId: data.storeId,
          accountId: id,
        };
      const secrets: ChannelSecrets = existing?.connection
        ? JSON.parse(
            decryptChannelValue(
              fullScope,
              existing.connection.encryptedCredentials,
            ),
          )
        : {};
      if (data.provider === "META")
        Object.assign(secrets, {
          ...(data.accessToken ? { accessToken: data.accessToken } : {}),
          ...(data.appSecret ? { appSecret: data.appSecret } : {}),
          ...(data.verifyToken ? { verifyToken: data.verifyToken } : {}),
        });
      else
        Object.assign(secrets, {
          ...(data.apiKey ? { apiKey: data.apiKey } : {}),
          ...(data.webhookSecret ? { webhookSecret: data.webhookSecret } : {}),
        });
      if (
        data.provider === "META"
          ? !secrets.accessToken || !secrets.appSecret || !secrets.verifyToken
          : !secrets.apiKey || !secrets.webhookSecret
      )
        fail(
          "CREDENTIAL_REQUIRED",
          "Preencha os campos privados da primeira conexão.",
          400,
        );
      if (existing) {
        await invalidateAccount(tx, id);
        await tx.avChannelAccount.update({
          where: { id },
          data: { name: data.name, active: false },
        });
      } else
        await tx.avChannelAccount.create({
          data: {
            id,
            organizationId: scope.organizationId,
            storeId: data.storeId,
            name: data.name,
            mode: data.provider,
            active: false,
            timezone: scope.unit.fusoHorario,
          },
        });
      await tx.avChannelConnection.upsert({
        where: { accountId: id },
        create: {
          ...fullScope,
          bindingKey,
          settings,
          encryptedCredentials: encryptChannelValue(
            fullScope,
            JSON.stringify(secrets),
          ),
        },
        update: {
          revision: { increment: 1 },
          settings,
          encryptedCredentials: encryptChannelValue(
            fullScope,
            JSON.stringify(secrets),
          ),
          connectionState: "PENDING",
          verifiedAt: null,
          verifiedRevision: null,
          webhookSeenAt: null,
          lastError: null,
        },
      });
      await virtualAudit(tx, scope, ctx.usuario.id, "CHANNEL_SAVED", {
        accountId: id,
        provider: data.provider,
      });
    },
    { timeout: 20000 },
  );
  return virtualChannels(ctx, data.storeId);
}
export async function changeVirtualChannel(
  ctx: ContextoSessao,
  raw: unknown,
  management: ChannelManagementFactory,
) {
  if (
    raw &&
    typeof raw === "object" &&
    "action" in raw &&
    raw.action === "save"
  )
    return saveChannel(ctx, raw);
  const data = operations.parse(raw),
    scope = await authorizeVirtual(ctx, data.storeId, true, true);
  const row = await db.avChannelAccount.findFirst({
    where: {
      id: data.accountId,
      organizationId: scope.organizationId,
      storeId: data.storeId,
    },
    include: { connection: true },
  });
  if (!row?.connection || row.mode === "DEMO")
    return fail("NOT_FOUND", "Selecione uma conta real desta unidade.", 404);
  const connection = row.connection,
    fullScope = {
      organizationId: scope.organizationId,
      storeId: data.storeId,
      accountId: row.id,
    };
  if (connection.revision !== data.revision)
    fail("REVISION_CHANGED", "A configuração mudou. Atualize a tela.");
  if (data.action === "activate") {
    if (data.enabled) {
      const status = await virtualChannels(ctx, data.storeId),
        account = status.accounts.find((a) => a.id === row.id);
      if (!account || account.blockers.length)
        fail(
          "CHANNEL_NOT_READY",
          account?.blockers.join(" ") ?? "Canal não está pronto.",
        );
    }
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${row.id}`}))`;
        const current = await tx.avChannelConnection.findUniqueOrThrow({
          where: { accountId: row.id },
        });
        if (current.revision !== data.revision)
          fail("REVISION_CHANGED", "A configuração mudou. Atualize a tela.");
        await invalidateAccount(tx, row.id);
        await tx.avChannelAccount.update({
          where: { id: row.id },
          data: { active: data.enabled },
        });
        await virtualAudit(tx, scope, ctx.usuario.id, "CHANNEL_ACTIVATION", {
          accountId: row.id,
          enabled: data.enabled,
          revision: data.revision,
        });
      },
      { timeout: 20000 },
    );
  } else if (data.action === "ackTest") {
    const result = await db.avChannelTest.updateMany({
      where: {
        ...fullScope,
        id: data.testId,
        revision: data.revision,
        state: "DELIVERED",
        deliveredAt: { not: null },
      },
      data: { observedAt: new Date(), observedById: ctx.usuario.id },
    });
    if (!result.count)
      fail(
        "DELIVERY_NOT_CONFIRMED",
        "A confirmação exige retorno autenticado de entrega deste teste.",
      );
    await db.avAuditEvent.create({
      data: {
        organizationId: scope.organizationId,
        storeId: data.storeId,
        actorId: ctx.usuario.id,
        action: "CHANNEL_TEST_OBSERVED",
        data: { accountId: row.id, testId: data.testId },
      },
    });
  } else {
    const adapter = await management(row.id);
    if (data.action === "qr") return adapter.qr();
    if (data.action === "createInstance") {
      if (row.mode !== "EVOLUTION" || !adapter.createInstance)
        fail(
          "INVALID_PROVIDER_ACTION",
          "Criar instância é exclusivo do Evolution.",
          400,
        );
      try {
        await adapter.createInstance();
      } catch {
        fail(
          "INSTANCE_CREATE_FAILED",
          "Não foi possível criar. Confira se a instância já existe e se a chave possui permissão. Nenhuma instância existente foi modificada.",
        );
      }
      await db.avAuditEvent.create({
        data: {
          organizationId: scope.organizationId,
          storeId: data.storeId,
          actorId: ctx.usuario.id,
          action: "CHANNEL_INSTANCE_CREATED",
          data: { accountId: row.id, revision: data.revision },
        },
      });
      return virtualChannels(ctx, data.storeId);
    }
    if (data.action === "verify" || data.action === "webhook") {
      let error: string | null = null,
        connected = false;
      try {
        if (data.action === "webhook") {
          const url = channelWebhookUrl(row.mode, row.id);
          if (!url)
            fail(
              "PUBLIC_URL_REQUIRED",
              "Configure APP_URL com o domínio HTTPS público.",
            );
          await adapter.webhook(url, data.replaceExistingWebhook);
        } else connected = (await adapter.verify()).connected;
      } catch (e) {
        if (e instanceof CrmError) throw e;
        error =
          e instanceof Error &&
          e.message === "EXISTING_WEBHOOK_CONFIRMATION_REQUIRED"
            ? "Já existe outro webhook na instância. Revise e confirme a substituição no painel."
            : "O provedor recusou ou não respondeu. Confira credenciais e conexão.";
      }
      await db.avChannelConnection.updateMany({
        where: { accountId: row.id, revision: data.revision },
        data:
          data.action === "verify"
            ? {
                connectionState: connected ? "VERIFIED" : "FAILED",
                verifiedRevision: connected ? data.revision : null,
                verifiedAt: connected ? new Date() : null,
                lastError:
                  error ??
                  (connected ? null : "A instância ainda não está conectada."),
              }
            : { lastError: error },
      });
      if (error) fail("PROVIDER_CONFIGURATION_FAILED", error);
    } else if (data.action === "sendTest") {
      if (
        connection.connectionState !== "VERIFIED" ||
        connection.verifiedRevision !== data.revision
      )
        fail("VERIFY_FIRST", "Verifique a conexão antes do teste.");
      if (
        row.mode === "META" &&
        !(await channelServiceWindow(row.id, data.recipient))
      )
        fail(
          "CUSTOMER_WINDOW_REQUIRED",
          "Envie primeiro uma mensagem do seu número de teste para o número comercial. A API oficial permite texto livre dentro da janela de 24 horas.",
        );
      const test = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:test:${row.id}`}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${row.id}`}))`;
        const current = await tx.avChannelConnection.findUniqueOrThrow({
          where: { accountId: row.id },
        });
        if (
          current.revision !== data.revision ||
          current.verifiedRevision !== data.revision ||
          current.connectionState !== "VERIFIED"
        )
          fail(
            "REVISION_CHANGED",
            "A conexão mudou. Atualize e verifique antes do teste.",
          );
        const previous = await tx.avChannelTest.findUnique({
          where: {
            accountId_requestId: {
              accountId: row.id,
              requestId: data.requestId,
            },
          },
        });
        if (previous) {
          if (
            previous.recipientHash !==
              channelRecipientHash(fullScope, data.recipient) ||
            previous.actorId !== ctx.usuario.id ||
            previous.revision !== data.revision
          )
            fail(
              "IDEMPOTENCY_CONFLICT",
              "Esta tentativa já pertence a outro teste.",
            );
          return { row: previous, fresh: false };
        }
        const count = await tx.avChannelTest.count({
          where: {
            accountId: row.id,
            createdAt: { gte: new Date(Date.now() - 3600000) },
          },
        });
        if (count >= 3)
          fail(
            "TEST_RATE_LIMIT",
            "Limite de três testes por hora nesta conta.",
            429,
          );
        return {
          row: await tx.avChannelTest.create({
            data: {
              ...fullScope,
              revision: data.revision,
              actorId: ctx.usuario.id,
              requestId: data.requestId,
              recipientHash: channelRecipientHash(fullScope, data.recipient),
              encryptedRecipient: encryptChannelValue(
                fullScope,
                data.recipient,
              ),
            },
          }),
          fresh: true,
        };
      });
      if (test.fresh) {
        const result = await adapter.sendText({
          recipient: data.recipient,
          text: "Teste autorizado da Severina • Vitaliano. Esta mensagem confirma apenas a conexão de teste, sem reserva ou pedido.",
          correlationId: `test:${test.row.id}`,
        });
        await db.avChannelTest.updateMany({
          where: { id: test.row.id, state: "SENDING" },
          data:
            result.state === "ACCEPTED"
              ? {
                  state: "ACCEPTED",
                  providerId: result.providerId,
                  acceptedAt: new Date(),
                }
              : { state: result.state, error: result.error },
        });
        if (result.state === "ACCEPTED")
          await reconcileStoredChannelDeliveries(row.id, result.providerId);
      }
    } else if (data.action === "reconcileTest") {
      const test = await db.avChannelTest.findFirst({
        where: {
          ...fullScope,
          revision: data.revision,
          ...(data.testId ? { id: data.testId } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      if (!test) fail("TEST_MISSING", "Nenhum teste encontrado nesta revisão.");
      const result =
        (await recordedChannelReceipt(row.id, `test:${test.id}`)) ??
        (await adapter.consultStatus(`test:${test.id}`));
      if (result.state === "ACCEPTED")
        await db.avChannelTest.updateMany({
          where: { id: test.id, state: { in: ["SENDING", "UNCERTAIN"] } },
          data: {
            state: "ACCEPTED",
            providerId: result.providerId,
            acceptedAt: new Date(),
            error: null,
          },
        });
      else
        await db.avChannelTest.updateMany({
          where: { id: test.id, state: "SENDING" },
          data: {
            state: "UNCERTAIN",
            error:
              "Sem confirmação correlacionada. Não reenvie automaticamente.",
          },
        });
      if (result.state === "ACCEPTED")
        await reconcileStoredChannelDeliveries(row.id, result.providerId);
    }
  }
  return virtualChannels(ctx, data.storeId);
}
