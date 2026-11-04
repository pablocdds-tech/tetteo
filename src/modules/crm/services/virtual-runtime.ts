import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import {
  demoChannel,
  isDemoRecipient,
  maskVirtualSecrets,
  type AtendimentoChannelAdapter,
} from "@/server/atendimento-canal";
import { db } from "@/server/db";
import { channelRecipientHash } from "@/server/atendimento-credenciais";
import { canonicalHash, CrmError, protectIdentity } from "./campaign-domain";
import {
  type VirtualClaim,
  type VirtualTurnInput,
  type VirtualTurnResult,
} from "../virtual-types";

export type VirtualTx = Prisma.TransactionClient;
export type VirtualScope = {
  organizationId: string;
  storeId: string;
  accountId: string;
  conversationId: string;
};
function scopedVirtual(input: VirtualScope): VirtualScope {
  return {
    organizationId: input.organizationId,
    storeId: input.storeId,
    accountId: input.accountId,
    conversationId: input.conversationId,
  };
}
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;
const CHANNEL_MODES = ["DEMO", "EVOLUTION", "META"] as const;
const canonicalPhone = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);
export type VirtualChannelFactory = (
  accountId: string,
) => AtendimentoChannelAdapter | Promise<AtendimentoChannelAdapter>;
export type VirtualInboundAttestation = {
  provider: "EVOLUTION" | "META";
  revision?: number;
};
async function liveConnectionReady(
  tx: VirtualTx,
  account: {
    id: string;
    organizationId: string;
    storeId: string;
    mode: string;
  },
) {
  if (account.mode === "DEMO") return true;
  if (!CHANNEL_MODES.includes(account.mode as (typeof CHANNEL_MODES)[number]))
    return false;
  const connection = await tx.avChannelConnection.findFirst({
    where: {
      accountId: account.id,
      organizationId: account.organizationId,
      storeId: account.storeId,
    },
    select: {
      connectionState: true,
      revision: true,
      verifiedRevision: true,
      verifiedAt: true,
    },
  });
  return Boolean(
    connection &&
    connection.connectionState === "VERIFIED" &&
    connection.verifiedRevision === connection.revision &&
    connection.verifiedAt,
  );
}
async function detectVirtualConversationLoop(
  tx: VirtualTx,
  conversationId: string,
  currentText: string,
) {
  const since = new Date(Date.now() - 5 * 60_000);
  const turns = await tx.avAgentRun.count({
    where: { conversationId, createdAt: { gte: since } },
  });
  if (turns >= 30) return "TURN_RATE_LIMIT";
  const messages = await tx.avMessage.findMany({
    where: {
      conversationId,
      createdAt: { gte: since },
      author: { in: ["CUSTOMER", "AGENT"] },
      source: "LIVE",
    },
    orderBy: { sequence: "desc" },
    take: 100,
    select: { author: true, text: true },
  });
  const normalize = (text: string) =>
    canonicalHash(text.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"));
  const customerHash = normalize(currentText);
  const latestAgent = messages.find((m) => m.author === "AGENT");
  if (!latestAgent) return null;
  const agentHash = normalize(latestAgent.text);
  const customerRepeats = messages.filter(
    (m) => m.author === "CUSTOMER" && normalize(m.text) === customerHash,
  ).length;
  const agentRepeats = messages.filter(
    (m) => m.author === "AGENT" && normalize(m.text) === agentHash,
  ).length;
  return customerRepeats >= 5 && agentRepeats >= 5 ? "REPEATED_EXCHANGE" : null;
}
export async function authorizeVirtual(
  context: ContextoSessao,
  storeId: string,
  write = false,
  manage = false,
) {
  if (
    !pode(
      context,
      manage ? "crm.gerenciar" : write ? "crm.editar" : "crm.ver",
    ) ||
    context.unidadeAtiva?.id !== storeId ||
    !context.unidadesVisiveis.some((u) => u.id === storeId)
  )
    throw new CrmError(
      "FORBIDDEN",
      "Sem acesso ao atendimento desta unidade.",
      403,
    );
  const unit = await db.unidade.findFirst({
    where: {
      id: storeId,
      organizacaoId: context.organizacao.id,
      ativa: true,
      excluidoEm: null,
      organizacao: { ativa: true, excluidoEm: null },
    },
    select: { id: true, nome: true, fusoHorario: true },
  });
  if (!unit) throw new CrmError("NOT_FOUND", "Unidade indisponível.", 404);
  return { organizationId: context.organizacao.id, storeId, unit };
}
export async function lockVirtualConversation(tx: VirtualTx, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:conversation:${id}`}))`;
}
export async function assertVirtualTurn(
  tx: VirtualTx,
  input: Pick<
    VirtualTurnInput,
    | "organizationId"
    | "storeId"
    | "accountId"
    | "conversationId"
    | "version"
    | "leaseOwner"
    | "runId"
  >,
) {
  await lockVirtualConversation(tx, input.conversationId);
  const conversation = await tx.avConversation.findFirst({
    where: {
      id: input.conversationId,
      organizationId: input.organizationId,
      storeId: input.storeId,
      accountId: input.accountId,
    },
  });
  const run = await tx.avAgentRun.findFirst({
    where: {
      id: input.runId,
      conversationId: input.conversationId,
      status: "RUNNING",
      leaseOwner: input.leaseOwner,
    },
    select: { id: true },
  });
  const account = await tx.avChannelAccount.findFirst({
    where: {
      id: input.accountId,
      organizationId: input.organizationId,
      storeId: input.storeId,
      active: true,
      mode: { in: [...CHANNEL_MODES] },
    },
    select: { id: true, mode: true },
  });
  if (
    !account ||
    !(await liveConnectionReady(tx, {
      id: input.accountId,
      organizationId: input.organizationId,
      storeId: input.storeId,
      mode: account.mode,
    })) ||
    !run ||
    !conversation ||
    conversation.version !== input.version ||
    conversation.leaseOwner !== input.leaseOwner ||
    !conversation.leaseUntil ||
    conversation.leaseUntil.getTime() <= Date.now() ||
    !conversation.agentEnabled ||
    conversation.optedOut ||
    ["PAUSED", "RESOLVED"].includes(conversation.status)
  )
    throw new CrmError(
      "STALE_TURN",
      "A conversa mudou ou está em controle humano.",
    );
  return conversation;
}
export function virtualAudit(
  tx: VirtualTx,
  scope: { organizationId: string; storeId: string; conversationId?: string },
  actorId: string,
  action: string,
  data: Prisma.InputJsonValue = {},
) {
  return tx.avAuditEvent.create({
    data: {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      conversationId: scope.conversationId,
      actorId,
      action,
      data,
    },
  });
}
export async function notifyVirtualEscalation(
  tx: VirtualTx,
  input: VirtualScope,
  id: string,
) {
  const scope = scopedVirtual(input);
  const escalation = await tx.avEscalation.findFirst({
    where: { id, ...scope },
  });
  if (!escalation || escalation.notificationId) return;
  const account = await tx.avChannelAccount.findFirst({
    where: {
      id: scope.accountId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
    },
  });
  const destination = account?.notificationUserId;
  const accesses = destination
    ? await tx.acesso.findMany({
        where: {
          usuarioId: destination,
          organizacaoId: scope.organizationId,
          status: "ATIVO",
          excluidoEm: null,
          OR: [{ unidadeId: scope.storeId }, { unidadeId: null }],
          usuario: { status: "ATIVO", excluidoEm: null },
        },
        select: {
          papel: { select: { permissoes: { select: { chave: true } } } },
        },
      })
    : [];
  const destinationScope = {
    permissoes: new Set(
      accesses.flatMap((a) => a.papel.permissoes.map((p) => p.chave)),
    ),
  };
  if (
    !destination ||
    !pode(destinationScope, "crm.ver") ||
    !pode(destinationScope, "crm.editar")
  ) {
    await tx.avEscalation.update({
      where: { id },
      data: {
        alertState: "FAILED",
        alertError:
          "Configure um responsável autorizado para receber as pendências.",
        alertAttempts: { increment: 1 },
      },
    });
    return;
  }
  const notification = await tx.notificacao.create({
    data: {
      destinatarioId: destination,
      organizacaoId: scope.organizationId,
      unidadeId: scope.storeId,
      appOrigem: "crm",
      tipo: "ATENDIMENTO_ESCALADO",
      titulo: "Atendimento precisa da equipe",
      mensagem:
        "Uma conversa aguarda revisão no Inbox. Abra a pendência e assuma o atendimento.",
      link: `/crm/atendimento?conversa=${scope.conversationId}`,
      prioridade: "ALTA",
    },
  });
  await tx.avEscalation.update({
    where: { id },
    data: {
      alertState: "NOTIFIED",
      notificationId: notification.id,
      alertError: null,
      alertAttempts: { increment: 1 },
    },
  });
}
export async function createVirtualEscalation(
  tx: VirtualTx,
  input: VirtualScope,
  data: { key: string; reason: string; excerpt: string },
) {
  const scope = scopedVirtual(input);
  await lockVirtualConversation(tx, scope.conversationId);
  const task = await tx.avEscalation.upsert({
    where: {
      conversationId_key: {
        conversationId: scope.conversationId,
        key: data.key,
      },
    },
    create: {
      ...scope,
      key: data.key,
      reason: maskVirtualSecrets(data.reason).slice(0, 500),
      excerpt: maskVirtualSecrets(data.excerpt).slice(0, 800),
    },
    update: {},
  });
  await tx.avConversation.updateMany({
    where: {
      id: scope.conversationId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
    },
    data: { status: "ESCALATED", agentEnabled: false },
  });
  await notifyVirtualEscalation(tx, scope, task.id);
  return tx.avEscalation.findUniqueOrThrow({ where: { id: task.id } });
}
const inboundSchema = z
  .object({
    externalId: z.string().min(1).max(300),
    senderKey: z.string().max(100),
    type: z.enum(["MESSAGE", "DELIVERY"]),
    text: z.string().max(16384).default(""),
    kind: z.enum(["TEXT", "AUDIO", "IMAGE"]).default("TEXT"),
    transcriptionCertain: z.boolean().default(true),
    fromSelf: z.boolean().default(false),
    group: z.boolean().default(false),
    providerId: z.string().min(1).max(200).optional(),
    deliveryState: z.enum(["DELIVERED", "READ", "FAILED"]).optional(),
    trustedPhone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    recipient: z.string().max(160).optional(),
    occurredAt: z.iso.datetime().optional(),
  })
  .strict();
export async function receiveVirtualInbound(
  accountId: string,
  raw: unknown,
  attestation?: VirtualInboundAttestation,
) {
  const data = inboundSchema.parse(raw);
  const account = await db.avChannelAccount.findUnique({
    where: { id: accountId },
  });
  if (
    !account ||
    !CHANNEL_MODES.includes(account.mode as (typeof CHANNEL_MODES)[number])
  )
    throw new CrmError(
      "CHANNEL_DISABLED",
      "Canal de atendimento indisponível.",
      503,
    );
  if (account.mode !== "DEMO" && attestation?.provider !== account.mode)
    throw new CrmError(
      "CHANNEL_ATTESTATION_REQUIRED",
      "A entrada deve vir do webhook autenticado do provedor desta conta.",
      403,
    );
  if (account.mode === "DEMO" && attestation)
    throw new CrmError(
      "CHANNEL_PROVIDER_MISMATCH",
      "O provedor recebido não corresponde à conta.",
      403,
    );
  if (account.mode === "DEMO" && !isDemoRecipient(data.senderKey))
    throw new CrmError(
      "REAL_RECIPIENT_DENIED",
      "Modo demonstração recusa destinatários reais.",
      400,
    );
  const text = maskVirtualSecrets(data.text);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${account.id}`}))`;
    if (account.mode !== "DEMO" && attestation?.revision !== undefined) {
      const currentConnection = await tx.avChannelConnection.findUnique({
        where: { accountId },
        select: { revision: true },
      });
      if (currentConnection?.revision !== attestation.revision)
        throw new CrmError(
          "CHANNEL_REVISION_CHANGED",
          "A configuração do canal mudou. Repita o evento com a configuração vigente.",
          503,
        );
    }
    const existing = await tx.avInboundEvent.findUnique({
      where: {
        accountId_externalId: { accountId, externalId: data.externalId },
      },
    });
    if (existing) return { duplicate: true, conversationId: null };
    const scope = {
      organizationId: account.organizationId,
      storeId: account.storeId,
      accountId,
    };
    const event = await tx.avInboundEvent.create({
      data: {
        ...scope,
        externalId: data.externalId,
        type: data.type,
        senderKey: data.senderKey,
        payload: { ...data, text },
      },
    });
    await tx.avChannelAccount.update({
      where: { id: accountId },
      data: { lastWebhookAt: new Date() },
    });
    if (data.type === "DELIVERY" && data.providerId && data.deliveryState) {
      await tx.avMessageOutbox.updateMany({
        where: {
          accountId,
          providerId: data.providerId,
          state: {
            in:
              data.deliveryState === "READ"
                ? ["ACCEPTED", "DELIVERED"]
                : ["ACCEPTED"],
          },
        },
        data:
          data.deliveryState === "READ"
            ? { state: "READ", error: null }
            : data.deliveryState === "DELIVERED"
              ? {
                  state: "DELIVERED",
                  deliveredAt: data.occurredAt
                    ? new Date(data.occurredAt)
                    : new Date(),
                  error: null,
                }
              : {
                  state: "FAILED",
                  error: "O canal informou falha na entrega.",
                },
      });
      await tx.avInboundEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      return { duplicate: false, conversationId: null };
    }
    if (data.fromSelf || data.group || data.type !== "MESSAGE") {
      await tx.avInboundEvent.update({
        where: { id: event.id },
        data: { status: "IGNORED", processedAt: new Date() },
      });
      return { duplicate: false, conversationId: null };
    }
    if (
      data.occurredAt &&
      Date.now() - new Date(data.occurredAt).getTime() > 24 * 3600_000
    ) {
      await tx.avInboundEvent.update({
        where: { id: event.id },
        data: {
          status: "IGNORED",
          error: "STALE_EVENT",
          processedAt: new Date(),
        },
      });
      return { duplicate: false, conversationId: null };
    }
    if (account.mode !== "DEMO" && !data.occurredAt) {
      await tx.avInboundEvent.update({
        where: { id: event.id },
        data: {
          status: "IGNORED",
          error: "MISSING_EVENT_TIME",
          processedAt: new Date(),
        },
      });
      return { duplicate: false, conversationId: null };
    }
    if (
      account.mode !== "DEMO" &&
      (!canonicalPhone(data.senderKey) ||
        (data.trustedPhone && data.trustedPhone !== data.senderKey) ||
        (data.recipient && data.recipient !== data.senderKey))
    ) {
      await tx.avInboundEvent.update({
        where: { id: event.id },
        data: {
          status: "IGNORED",
          error: "UNRESOLVED_SENDER",
          processedAt: new Date(),
        },
      });
      return { duplicate: false, conversationId: null };
    }
    const imported = await tx.avMessage.findUnique({
      where: {
        accountId_externalId: { accountId, externalId: data.externalId },
      },
      select: { id: true, conversationId: true },
    });
    if (imported) {
      await tx.avInboundEvent.update({
        where: { id: event.id },
        data: {
          status: "IGNORED",
          error: "MESSAGE_ALREADY_STORED",
          processedAt: new Date(),
        },
      });
      return { duplicate: true, conversationId: imported.conversationId };
    }
    if (account.mode !== "DEMO") {
      const recipientHash = channelRecipientHash(scope, data.senderKey);
      const observedAt = new Date(
        Math.min(
          Date.now(),
          data.occurredAt ? new Date(data.occurredAt).getTime() : Date.now(),
        ),
      );
      await tx.avChannelWindow.upsert({
        where: { accountId_recipientHash: { accountId, recipientHash } },
        create: { ...scope, recipientHash, lastInboundAt: observedAt },
        update: {},
      });
      await tx.avChannelWindow.updateMany({
        where: { accountId, recipientHash, lastInboundAt: { lt: observedAt } },
        data: { lastInboundAt: observedAt },
      });
    }
    const identityType =
      account.mode === "DEMO"
        ? `AV_DEMO:${accountId}`
        : `AV_CHANNEL:${accountId}`;
    const identity = protectIdentity(
      account.storeId,
      identityType,
      data.senderKey,
    );
    let known = await tx.crmIdentity.findUnique({
      where: {
        storeId_type_normalizedHash: {
          storeId: account.storeId,
          type: identityType,
          normalizedHash: identity.normalizedHash,
        },
      },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            active: true,
            mergedIntoId: true,
            store: { select: { organizacaoId: true } },
          },
        },
      },
    });
    if (!known && account.mode !== "DEMO") {
      const phoneIdentity = protectIdentity(
        account.storeId,
        "PHONE",
        data.senderKey,
      );
      known = await tx.crmIdentity.findUnique({
        where: {
          storeId_type_normalizedHash: {
            storeId: account.storeId,
            type: "PHONE",
            normalizedHash: phoneIdentity.normalizedHash,
          },
        },
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              active: true,
              mergedIntoId: true,
              store: { select: { organizacaoId: true } },
            },
          },
        },
      });
      if (
        known?.verifiedAt &&
        known.verifiedAt.getTime() <= Date.now() &&
        known.verifiedById.trim() &&
        known.contact.active &&
        !known.contact.mergedIntoId &&
        known.contact.store.organizacaoId === account.organizationId
      ) {
        await tx.crmIdentity.upsert({
          where: {
            storeId_type_normalizedHash: {
              storeId: account.storeId,
              type: identityType,
              normalizedHash: identity.normalizedHash,
            },
          },
          create: {
            storeId: account.storeId,
            contactId: known.contactId,
            type: identityType,
            ...identity,
            verifiedAt: new Date(),
            verifiedById: known.verifiedById,
          },
          update: {},
        });
      }
    }
    const contact =
      known?.verifiedAt &&
      known.verifiedAt.getTime() <= Date.now() &&
      known.verifiedById.trim() &&
      known.contact.active &&
      !known.contact.mergedIntoId &&
      known.contact.store.organizacaoId === account.organizationId
        ? known.contact
        : null;
    const namePreference = await tx.avCustomerPreference.findUnique({
      where: {
        accountId_externalCustomerId_key: {
          accountId,
          externalCustomerId: data.senderKey,
          key: "name",
        },
      },
      select: { value: true },
    });
    const conversation = await tx.avConversation.upsert({
      where: {
        accountId_externalCustomerId: {
          accountId,
          externalCustomerId: data.senderKey,
        },
      },
      create: {
        ...scope,
        externalCustomerId: data.senderKey,
        contactId: contact?.id,
        displayName:
          namePreference?.value ??
          contact?.name ??
          (account.mode === "DEMO"
            ? "Visitante · exemplo Kairu"
            : "Cliente sem cadastro"),
      },
      update: {},
    });
    await lockVirtualConversation(tx, conversation.id);
    const current = await tx.avConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    const now = new Date();
    const first = current.pendingSince ?? now;
    const due = new Date(
      Math.min(
        now.getTime() + account.debounceMs,
        first.getTime() + account.maxWaitMs,
      ),
    );
    await tx.avMessage.create({
      data: {
        ...scope,
        conversationId: conversation.id,
        externalId: data.externalId,
        direction: "INBOUND",
        author: "CUSTOMER",
        text:
          text ||
          (data.kind === "AUDIO"
            ? "[Áudio sem transcrição confiável]"
            : "[Imagem recebida; consulta visual indisponível]"),
        kind: data.kind,
        transcriptionCertain:
          data.transcriptionCertain &&
          (account.mode === "DEMO" ||
            Boolean(
              data.occurredAt &&
              new Date(data.occurredAt).getTime() <= Date.now() + 5 * 60_000,
            )),
        ...(data.occurredAt ? { createdAt: new Date(data.occurredAt) } : {}),
      },
    });
    await tx.avConversation.update({
      where: { id: conversation.id },
      data: {
        contactId: contact?.id ?? null,
        displayName:
          namePreference?.value ?? contact?.name ?? current.displayName,
        version: { increment: 1 },
        pendingSince: first,
        processAfter: due,
        lastMessageAt: now,
        attempts: 0,
        ...(current.status === "RESOLVED"
          ? { status: "OPEN", agentEnabled: true }
          : {}),
        ...(current.status === "WAITING_CUSTOMER" ? { status: "OPEN" } : {}),
        ...(text.trim().toLowerCase() === "parar"
          ? { optedOut: true, agentEnabled: false, status: "WAITING_TEAM" }
          : {}),
      },
    });
    await tx.avInboundEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: now },
    });
    return { duplicate: false, conversationId: conversation.id };
  });
}
export async function validateVirtualClaims(
  tx: VirtualTx,
  input: VirtualScope,
  claims: VirtualClaim[],
) {
  if (claims.length > 8) return false;
  for (const claim of claims) {
    const execution = await tx.avToolExecution.findFirst({
      where: {
        id: claim.toolExecutionId,
        ...scopedVirtual(input),
        objectId: claim.objectId,
        name: claim.action,
        success: true,
      },
    });
    if (!execution) return false;
  }
  return true;
}
function virtualOutboxIsStale(
  out: {
    version: number;
    author: string;
    runId: string | null;
    claims: Prisma.JsonValue;
  },
  conversation: {
    version: number;
    status: string;
    agentEnabled: boolean;
    optedOut: boolean;
    account: { active: boolean };
  },
) {
  const escalationReply =
    conversation.status === "ESCALATED" &&
    Boolean(out.runId) &&
    (out.claims as unknown as VirtualClaim[]).some(
      (c) => c.action === "escalar_para_humano",
    );
  return (
    !conversation.account.active ||
    out.version !== conversation.version ||
    (out.author === "AGENT" &&
      ((!conversation.agentEnabled && !escalationReply) ||
        conversation.optedOut ||
        ["PAUSED", "RESOLVED"].includes(conversation.status)))
  );
}

export async function deliverVirtualOutbox(
  limit = 20,
  channelFor: VirtualChannelFactory = demoChannel,
) {
  const now = new Date();
  const entries = await db.avMessageOutbox.findMany({
    where: {
      OR: [
        {
          state: "PENDING",
          attempts: { lt: 4 },
          conversation: {
            account: {
              active: true,
              OR: [
                { mode: "DEMO" },
                {
                  mode: { in: ["EVOLUTION", "META"] },
                  connection: {
                    is: {
                      connectionState: "VERIFIED",
                      verifiedAt: { not: null },
                    },
                  },
                },
              ],
            },
            outbox: { none: { state: { in: ["SENDING", "UNCERTAIN"] } } },
          },
        },
        {
          state: "UNCERTAIN",
          attempts: { lt: 4 },
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
        {
          state: "SENDING",
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let accepted = 0;
  for (const entry of entries) {
    const token = randomUUID();
    const claim = await db.$transaction(async (tx) => {
      await lockVirtualConversation(tx, entry.conversationId);
      let out = await tx.avMessageOutbox.findUniqueOrThrow({
        where: { id: entry.id },
      });
      if (!["PENDING", "SENDING", "UNCERTAIN"].includes(out.state)) return null;
      if (out.leaseOwner && out.leaseUntil && out.leaseUntil > new Date())
        return null;
      if (out.state === "SENDING") {
        // A process may have died after HTTP acceptance and before persisting
        // its response. An expired sending claim can only be reconciled.
        out = await tx.avMessageOutbox.update({
          where: { id: out.id },
          data: {
            state: "UNCERTAIN",
            leaseOwner: null,
            leaseUntil: null,
            error:
              "O envio foi interrompido; consulte a mesma correlação antes de decidir qualquer reenvio.",
          },
        });
      }
      const conversation = await tx.avConversation.findUniqueOrThrow({
        where: { id: out.conversationId },
        include: { account: true },
      });
      if (
        !CHANNEL_MODES.includes(
          conversation.account.mode as (typeof CHANNEL_MODES)[number],
        ) ||
        (conversation.account.mode === "DEMO"
          ? !isDemoRecipient(conversation.externalCustomerId)
          : !canonicalPhone(conversation.externalCustomerId))
      )
        throw new CrmError(
          "REAL_RECIPIENT_DENIED",
          "O destinatário não corresponde ao modo deste canal.",
        );
      if (out.state === "PENDING") {
        if (!(await liveConnectionReady(tx, conversation.account))) return null;
        if (virtualOutboxIsStale(out, conversation)) {
          await tx.avMessageOutbox.update({
            where: { id: out.id },
            data: {
              state: "DISCARDED",
              leaseOwner: null,
              leaseUntil: null,
              error: "Resposta obsoleta descartada antes do envio.",
            },
          });
          return null;
        }
        // A manual answer waits for an already dispatched answer to settle.
        // Reconciliation never blocks the takeover transaction itself.
        if (
          await tx.avMessageOutbox.findFirst({
            where: {
              conversationId: out.conversationId,
              id: { not: out.id },
              state: { in: ["SENDING", "UNCERTAIN"] },
            },
            select: { id: true },
          })
        )
          return null;
        if (
          !(await validateVirtualClaims(
            tx,
            out,
            out.claims as unknown as VirtualClaim[],
          ))
        ) {
          await tx.avMessageOutbox.update({
            where: { id: out.id },
            data: {
              state: "BLOCKED",
              error: "A resposta alegou uma ação sem resultado correspondente.",
            },
          });
          return null;
        }
      }
      if (out.attempts >= 4) {
        await createVirtualEscalation(tx, out, {
          key: `outbox:${out.id}`,
          reason:
            "O resultado do envio ainda precisa ser conciliado pela equipe.",
          excerpt:
            "A tentativa permanece incerta. O sistema não repetiu o envio.",
        });
        return null;
      }
      const reconcile = out.state === "UNCERTAIN";
      const claimed = await tx.avMessageOutbox.update({
        where: { id: out.id },
        data: {
          state: reconcile ? "UNCERTAIN" : "SENDING",
          attempts: { increment: 1 },
          leaseOwner: token,
          leaseUntil: new Date(Date.now() + LEASE_MS),
        },
      });
      return {
        out: claimed,
        recipient: conversation.externalCustomerId,
        reconcile,
        mode: conversation.account.mode,
      };
    });
    if (!claim) continue;

    let adapter: AtendimentoChannelAdapter;
    try {
      adapter = await channelFor(claim.out.accountId);
      const identity = adapter.identify();
      if (
        identity.accountKey !== claim.out.accountId ||
        identity.mode !== claim.mode
      )
        throw new Error("CHANNEL_ADAPTER_MISMATCH");
    } catch {
      await db.avMessageOutbox.updateMany({
        where: { id: claim.out.id, leaseOwner: token },
        data: {
          state: claim.reconcile ? "UNCERTAIN" : "FAILED",
          leaseOwner: null,
          leaseUntil: null,
          error:
            "Configure o adaptador e as credenciais desta conta em Conexões.",
        },
      });
      continue;
    }

    if (!claim.reconcile) {
      // This is the dispatch authorization boundary. A takeover committed
      // before it cancels an unsent reply. Requests already authorized here
      // may be in flight; their receipt must remain visible after takeover.
      const authorized = await db.$transaction(async (tx) => {
        await lockVirtualConversation(tx, claim.out.conversationId);
        const out = await tx.avMessageOutbox.findUniqueOrThrow({
          where: { id: claim.out.id },
        });
        if (
          out.state !== "SENDING" ||
          out.leaseOwner !== token ||
          !out.leaseUntil ||
          out.leaseUntil <= new Date()
        )
          return false;
        const conversation = await tx.avConversation.findUniqueOrThrow({
          where: { id: out.conversationId },
          include: { account: true },
        });
        const connection =
          claim.mode === "DEMO"
            ? null
            : await tx.avChannelConnection.findUnique({
                where: { accountId: out.accountId },
                select: { revision: true },
              });
        if (
          virtualOutboxIsStale(out, conversation) ||
          !(await liveConnectionReady(tx, conversation.account)) ||
          (claim.mode !== "DEMO" &&
            (adapter.identify().revision === undefined ||
              adapter.identify().revision !== connection?.revision))
        ) {
          await tx.avMessageOutbox.update({
            where: { id: out.id },
            data: {
              state: "DISCARDED",
              leaseOwner: null,
              leaseUntil: null,
              error: "A conversa mudou antes de autorizar o envio ao canal.",
            },
          });
          return false;
        }
        return true;
      });
      if (!authorized) continue;
    }

    // No database transaction or conversation lock crosses provider I/O.
    const result = await (async () => {
      try {
        return claim.reconcile
          ? await adapter.consultStatus(claim.out.id)
          : await adapter.sendText({
              recipient: claim.recipient,
              text: claim.out.text,
              correlationId: claim.out.id,
            });
      } catch {
        return {
          state: "UNCERTAIN" as const,
          error:
            "O resultado do canal é desconhecido. Consulte a correlação original; não repita o envio.",
        };
      }
    })();

    const saved = await db.$transaction(async (tx) => {
      await lockVirtualConversation(tx, claim.out.conversationId);
      const out = await tx.avMessageOutbox.findUniqueOrThrow({
        where: { id: claim.out.id },
      });
      // A later worker may already have reconciled this attempt. A stale
      // sender cannot replace its receipt or regress a terminal status.
      if (out.leaseOwner !== token) {
        if (
          result.state !== "ACCEPTED" ||
          out.providerId ||
          ["FAILED", "DISCARDED", "BLOCKED"].includes(out.state)
        )
          return false;
        // Acceptance is durable evidence of this same correlation, even if
        // its lease expired while the provider was still responding.
      }
      if (result.state !== "ACCEPTED") {
        if (out.leaseOwner !== token) return false;
        if (
          out.providerId ||
          out.acceptedAt ||
          ["DELIVERED", "READ"].includes(out.state)
        )
          return false;
        await tx.avMessageOutbox.update({
          where: { id: out.id },
          data: {
            state: result.state,
            leaseOwner: null,
            leaseUntil: null,
            error: maskVirtualSecrets(result.error).slice(0, 500),
          },
        });
        if (result.state === "UNCERTAIN" && out.attempts >= 4)
          await createVirtualEscalation(tx, out, {
            key: `outbox:${out.id}`,
            reason:
              "Resultado do envio continua desconhecido após as consultas de status.",
            excerpt:
              "Confira o histórico do canal e concilie pelo ID da saída. O sistema não reenviou a mensagem.",
          });
        return false;
      }
      if (out.providerId && out.providerId !== result.providerId) return false;
      const callbacks = await tx.avInboundEvent.findMany({
        where: {
          accountId: out.accountId,
          type: "DELIVERY",
          status: "PROCESSED",
          payload: { path: ["providerId"], equals: result.providerId },
        },
        select: { payload: true },
        take: 50,
      });
      const states = callbacks.flatMap((c) => {
        const receipt = c.payload as {
          deliveryState?: string;
          recipient?: string;
          revision?: number;
          correlationId?: string | null;
        };
        if (
          claim.mode !== "DEMO" &&
          (receipt.recipient !== claim.recipient ||
            receipt.revision !== adapter.identify().revision ||
            (receipt.correlationId && receipt.correlationId !== out.id))
        )
          return [];
        return [receipt.deliveryState];
      });
      const state =
        out.state === "READ" || states.includes("READ")
          ? "READ"
          : out.state === "DELIVERED" || states.includes("DELIVERED")
            ? "DELIVERED"
            : out.state === "FAILED" || states.includes("FAILED")
              ? "FAILED"
              : "ACCEPTED";
      await tx.avMessageOutbox.update({
        where: { id: out.id },
        data: {
          state,
          providerId: result.providerId,
          acceptedAt: out.acceptedAt ?? new Date(),
          ...(["DELIVERED", "READ"].includes(state)
            ? { deliveredAt: out.deliveredAt ?? new Date() }
            : {}),
          leaseOwner: null,
          leaseUntil: null,
          error:
            state === "FAILED" ? "O canal informou falha na entrega." : null,
        },
      });
      await tx.avMessage.upsert({
        where: {
          accountId_externalId: {
            accountId: out.accountId,
            externalId: result.providerId,
          },
        },
        create: {
          organizationId: out.organizationId,
          storeId: out.storeId,
          accountId: out.accountId,
          conversationId: out.conversationId,
          externalId: result.providerId,
          direction: "OUTBOUND",
          author: out.author,
          actorId: out.actorId,
          text: out.text,
          processedAt: new Date(),
        },
        update: {},
      });
      return !out.acceptedAt;
    });
    if (saved) accepted++;
  }
  return accepted;
}

export async function processVirtualQueue(
  execute: (input: VirtualTurnInput) => Promise<VirtualTurnResult>,
  limit = 5,
  channelFor: VirtualChannelFactory = demoChannel,
) {
  const now = new Date();
  // Expiração é auditada e não libera uma escalação pendente.
  const expired = await db.avAgentPause.findMany({
    where: { resumedAt: null, until: { lte: now } },
    take: 50,
  });
  for (const pause of expired)
    await db.$transaction(async (tx) => {
      await lockVirtualConversation(tx, pause.conversationId);
      const claimed = await tx.avAgentPause.updateMany({
        where: { id: pause.id, resumedAt: null },
        data: { resumedAt: now, resumedById: "system:pause-expiry" },
      });
      if (!claimed.count) return;
      const pending = await tx.avEscalation.count({
        where: {
          conversationId: pause.conversationId,
          status: { not: "RESOLVED" },
        },
      });
      if (!pending)
        await tx.avConversation.updateMany({
          where: { id: pause.conversationId, status: "PAUSED" },
          data: {
            agentEnabled: true,
            status: "OPEN",
            version: { increment: 1 },
            processAfter: now,
          },
        });
      else
        await tx.avConversation.updateMany({
          where: { id: pause.conversationId, status: "PAUSED" },
          data: {
            agentEnabled: false,
            status: "ESCALATED",
            version: { increment: 1 },
          },
        });
      await virtualAudit(tx, pause, "system:pause-expiry", "PAUSE_EXPIRED");
    });
  const candidates = await db.avConversation.findMany({
    where: {
      agentEnabled: true,
      optedOut: false,
      status: { notIn: ["RESOLVED", "PAUSED"] },
      pendingSince: { not: null },
      processAfter: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      account: {
        active: true,
        OR: [
          { mode: "DEMO" },
          {
            mode: { in: ["EVOLUTION", "META"] },
            connection: {
              is: { connectionState: "VERIFIED", verifiedAt: { not: null } },
            },
          },
        ],
      },
    },
    orderBy: { processAfter: "asc" },
    take: limit,
  });
  let processed = 0;
  for (const candidate of candidates) {
    const owner = randomUUID();
    const input = await db.$transaction(async (tx) => {
      await lockVirtualConversation(tx, candidate.id);
      const conversation = await tx.avConversation.findUniqueOrThrow({
        where: { id: candidate.id },
        include: { account: true },
      });
      if (
        !conversation.account.active ||
        !(await liveConnectionReady(tx, conversation.account)) ||
        !conversation.agentEnabled ||
        conversation.optedOut ||
        !conversation.pendingSince ||
        (conversation.processAfter && conversation.processAfter > new Date()) ||
        (conversation.leaseUntil && conversation.leaseUntil > new Date())
      )
        return null;
      if (
        conversation.leaseOwner &&
        conversation.leaseUntil &&
        conversation.leaseUntil <= new Date()
      ) {
        await tx.avAgentRun.updateMany({
          where: { conversationId: conversation.id, status: "RUNNING" },
          data: {
            status: "FAILED",
            error: "LEASE_EXPIRED",
            completedAt: new Date(),
          },
        });
        const recoveredAttempts = conversation.attempts + 1;
        await tx.avConversation.update({
          where: { id: conversation.id },
          data: { attempts: recoveredAttempts, lastError: "LEASE_EXPIRED" },
        });
        if (recoveredAttempts >= MAX_ATTEMPTS) {
          await createVirtualEscalation(
            tx,
            {
              organizationId: conversation.organizationId,
              storeId: conversation.storeId,
              accountId: conversation.accountId,
              conversationId: conversation.id,
            },
            {
              key: `lease:${conversation.version}`,
              reason:
                "O processamento foi interrompido repetidamente e precisa da equipe.",
              excerpt:
                "As mensagens foram preservadas. Nenhum envio ou ação deve ser repetido sem conferir o histórico.",
            },
          );
          return null;
        }
      }
      const total = await tx.avAgentRun.aggregate({
        where: {
          accountId: conversation.accountId,
          createdAt: { gte: new Date(Date.now() - 86_400_000) },
        },
        _sum: { costMicros: true },
      });
      const notas = await tx.notaFiscalWhatsapp.aggregate({
        where: {
          organizacaoId: conversation.organizationId,
          unidadeId: conversation.storeId,
          criadoEm: { gte: new Date(Date.now() - 86_400_000) },
        },
        _sum: { custoMicros: true },
      });
      if (
        (conversation.account.circuitUntil &&
          conversation.account.circuitUntil > new Date()) ||
        (total._sum.costMicros ?? 0) + (notas._sum.custoMicros ?? 0) >=
          conversation.account.dailyBudgetMicros
      ) {
        await createVirtualEscalation(
          tx,
          {
            organizationId: conversation.organizationId,
            storeId: conversation.storeId,
            accountId: conversation.accountId,
            conversationId: conversation.id,
          },
          {
            key: `budget:${conversation.version}`,
            reason: "Atendimento automático interrompido pelo limite de custo.",
            excerpt: "A equipe precisa continuar esta conversa.",
          },
        );
        return null;
      }
      await tx.avConversation.update({
        where: { id: conversation.id },
        data: {
          leaseOwner: owner,
          leaseUntil: new Date(Date.now() + LEASE_MS),
        },
      });
      const messages = await tx.avMessage.findMany({
        where: {
          conversationId: conversation.id,
          direction: "INBOUND",
          processedAt: null,
        },
        orderBy: [{ createdAt: "asc" }, { sequence: "asc" }],
        take: 30,
      });
      const loop = await detectVirtualConversationLoop(
        tx,
        conversation.id,
        messages[messages.length - 1]?.text ?? "",
      );
      if (loop) {
        await tx.avAgentRun.create({
          data: {
            organizationId: conversation.organizationId,
            storeId: conversation.storeId,
            accountId: conversation.accountId,
            conversationId: conversation.id,
            version: conversation.version,
            leaseOwner: owner,
            status: "FAILED",
            model: "LOOP_GUARD",
            error: "CONVERSATION_LOOP",
            completedAt: new Date(),
          },
        });
        await tx.avConversation.update({
          where: { id: conversation.id },
          data: {
            leaseOwner: null,
            leaseUntil: null,
            lastError: "CONVERSATION_LOOP",
          },
        });
        await createVirtualEscalation(
          tx,
          {
            organizationId: conversation.organizationId,
            storeId: conversation.storeId,
            accountId: conversation.accountId,
            conversationId: conversation.id,
          },
          {
            key: `loop:${conversation.version}`,
            reason:
              "A automação foi interrompida para evitar uma sequência repetitiva de respostas.",
            excerpt: `Código: ${loop}. A equipe deve conferir a conversa antes de retomar.`,
          },
        );
        await virtualAudit(
          tx,
          {
            organizationId: conversation.organizationId,
            storeId: conversation.storeId,
            conversationId: conversation.id,
          },
          "system:loop-guard",
          "CONVERSATION_LOOP_BLOCKED",
          { reason: loop },
        );
        return null;
      }
      const run = await tx.avAgentRun.create({
        data: {
          organizationId: conversation.organizationId,
          storeId: conversation.storeId,
          accountId: conversation.accountId,
          conversationId: conversation.id,
          version: conversation.version,
          leaseOwner: owner,
        },
      });
      return {
        organizationId: conversation.organizationId,
        storeId: conversation.storeId,
        accountId: conversation.accountId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        senderKey: conversation.externalCustomerId,
        runId: run.id,
        version: conversation.version,
        leaseOwner: owner,
        timezone: conversation.account.timezone,
        customerName: conversation.displayName,
        summary: conversation.summary,
        state: conversation.state,
        messages: messages.map((m) => ({
          id: m.id,
          text: m.text,
          kind: m.kind,
          transcriptionCertain: m.transcriptionCertain,
          occurredAt: m.createdAt.toISOString(),
        })),
        limits: {
          maxTokens: conversation.account.maxTurnTokens,
          maxCostMicros: conversation.account.maxTurnCostMicros,
          timeoutMs: 30_000,
        },
        now: new Date(),
      } satisfies VirtualTurnInput;
    });
    if (!input) continue;
    const started = Date.now();
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        execute(input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new CrmError(
                  "TURN_TIMEOUT",
                  "O processamento excedeu o prazo.",
                ),
              ),
            input.limits.timeoutMs,
          );
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      await db.$transaction(async (tx) => {
        await lockVirtualConversation(tx, input.conversationId);
        const current = await tx.avConversation.findUniqueOrThrow({
          where: { id: input.conversationId },
          include: { account: { select: { active: true, mode: true } } },
        });
        const runData = {
          tokens: Math.max(0, result.tokens),
          costMicros: Math.max(0, result.costMicros),
          model: result.model ?? "DEMO_RULES",
          latencyMs: Date.now() - started,
          completedAt: new Date(),
        };
        if (
          !current.account.active ||
          !(await liveConnectionReady(tx, {
            id: input.accountId,
            organizationId: input.organizationId,
            storeId: input.storeId,
            mode: current.account.mode,
          })) ||
          current.version !== input.version ||
          current.leaseOwner !== owner ||
          !current.leaseUntil ||
          current.leaseUntil.getTime() <= Date.now() ||
          current.status === "PAUSED" ||
          current.status === "RESOLVED" ||
          current.optedOut
        ) {
          await tx.avAgentRun.update({
            where: { id: input.runId },
            data: {
              ...runData,
              status: "DISCARDED",
              error: "Conversa alterada durante a geração.",
            },
          });
          return;
        }
        if (!result.text.trim())
          throw new CrmError(
            "EMPTY_RESPONSE",
            "O atendimento não gerou uma resposta com texto.",
          );
        if (
          result.text.length > 4000 ||
          result.tokens > input.limits.maxTokens ||
          result.costMicros > input.limits.maxCostMicros
        )
          throw new CrmError(
            "TURN_LIMIT",
            "Resposta vazia ou limite do turno excedido.",
          );
        const claims = result.claims ?? [];
        if (
          !current.agentEnabled &&
          !(
            current.status === "ESCALATED" &&
            claims.some((c) => c.action === "escalar_para_humano")
          )
        ) {
          await tx.avAgentRun.update({
            where: { id: input.runId },
            data: {
              ...runData,
              status: "DISCARDED",
              error: "A equipe assumiu a conversa antes da saída.",
            },
          });
          return;
        }
        if (!(await validateVirtualClaims(tx, input, claims)))
          throw new CrmError(
            "CLAIM_BLOCKED",
            "Ação alegada sem resultado bem-sucedido.",
          );
        await tx.avMessageOutbox.create({
          data: {
            organizationId: input.organizationId,
            storeId: input.storeId,
            accountId: input.accountId,
            conversationId: input.conversationId,
            runId: input.runId,
            requestId: `run:${input.runId}`,
            version: input.version,
            text: maskVirtualSecrets(result.text),
            claims: claims as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.avMessage.updateMany({
          where: {
            id: { in: input.messages.map((m) => m.id) },
            conversationId: input.conversationId,
          },
          data: { processedAt: new Date() },
        });
        const remaining = await tx.avMessage.findFirst({
          where: {
            conversationId: input.conversationId,
            direction: "INBOUND",
            processedAt: null,
          },
          orderBy: { sequence: "asc" },
        });
        await tx.avConversation.update({
          where: { id: input.conversationId },
          data: {
            pendingSince: remaining?.createdAt ?? null,
            processAfter: remaining ? new Date() : null,
            attempts: 0,
            lastError: null,
            ...(result.state !== undefined
              ? { state: result.state as Prisma.InputJsonValue }
              : {}),
            ...(current.status !== "ESCALATED"
              ? { status: result.status ?? "WAITING_CUSTOMER" }
              : {}),
            lastMessageAt: new Date(),
          },
        });
        await tx.avAgentRun.update({
          where: { id: input.runId },
          data: { ...runData, status: "COMPLETED" },
        });
      });
      processed++;
    } catch (error) {
      await db.$transaction(async (tx) => {
        await lockVirtualConversation(tx, input.conversationId);
        const current = await tx.avConversation.findUniqueOrThrow({
          where: { id: input.conversationId },
        });
        const code = error instanceof CrmError ? error.code : "TURN_FAILED";
        await tx.avAgentRun.update({
          where: { id: input.runId },
          data: {
            status: code === "STALE_TURN" ? "DISCARDED" : "FAILED",
            error: code,
            latencyMs: Date.now() - started,
            completedAt: new Date(),
          },
        });
        if (current.version !== input.version || current.leaseOwner !== owner)
          return;
        const attempts = current.attempts + 1;
        await tx.avConversation.update({
          where: { id: current.id },
          data: {
            attempts,
            lastError: code,
            processAfter: new Date(Date.now() + attempts * 5000),
          },
        });
        if (
          attempts >= MAX_ATTEMPTS ||
          [
            "EMPTY_RESPONSE",
            "TURN_LIMIT",
            "CLAIM_BLOCKED",
            "TOOL_LOOP",
          ].includes(code)
        )
          await createVirtualEscalation(tx, input, {
            key: `failure:${input.version}`,
            reason: "A automação foi interrompida e precisa de revisão.",
            excerpt: `Código: ${code}. Nenhum sucesso foi anunciado.`,
          });
      });
    } finally {
      await db.avConversation.updateMany({
        where: { id: input.conversationId, leaseOwner: owner },
        data: { leaseOwner: null, leaseUntil: null },
      });
    }
  }
  return { processed, accepted: await deliverVirtualOutbox(20, channelFor) };
}

const actionSchema = z
  .object({
    storeId: z.string().min(1).max(128),
    action: z.enum([
      "takeover",
      "pause",
      "resume",
      "resolve",
      "reopen",
      "reply",
      "ack_escalation",
      "retry_alert",
    ]),
    version: z.number().int().min(1),
    requestId: z.string().uuid(),
    text: z.string().trim().min(1).max(4000).optional(),
    minutes: z.number().int().min(1).max(10080).optional(),
    escalationId: z.string().uuid().optional(),
    summary: z.string().trim().max(1000).optional(),
  })
  .strict();
export async function actOnVirtualConversation(
  context: ContextoSessao,
  id: string,
  raw: unknown,
  channelFor: VirtualChannelFactory = demoChannel,
) {
  const data = actionSchema.parse(raw);
  const scope = await authorizeVirtual(context, data.storeId, true);
  await db.$transaction(async (tx) => {
    await lockVirtualConversation(tx, id);
    const conversation = await tx.avConversation.findFirst({
      where: {
        id,
        organizationId: scope.organizationId,
        storeId: data.storeId,
      },
    });
    if (!conversation)
      throw new CrmError(
        "NOT_FOUND",
        "Conversa indisponível nesta unidade.",
        404,
      );
    const hash = canonicalHash(data);
    const previous = await tx.avOperatorRequest.findUnique({
      where: {
        conversationId_requestId: {
          conversationId: id,
          requestId: data.requestId,
        },
      },
    });
    if (previous) {
      if (previous.actorId !== context.usuario.id || previous.hash !== hash)
        throw new CrmError(
          "IDEMPOTENCY_CONFLICT",
          "Tentativa já usada com outros dados.",
        );
      return;
    }
    if (conversation.version !== data.version)
      throw new CrmError(
        "CONVERSATION_CHANGED",
        "O atendimento mudou. Atualize a conversa antes de continuar.",
      );
    const full = {
      organizationId: scope.organizationId,
      storeId: data.storeId,
      accountId: conversation.accountId,
      conversationId: id,
    };
    const now = new Date();
    const version = conversation.version + 1;
    const update: Prisma.AvConversationUpdateInput = {
      version: { increment: 1 },
      leaseOwner: null,
      leaseUntil: null,
    };
    await tx.avAgentRun.updateMany({
      where: { conversationId: id, status: "RUNNING" },
      data: {
        status: "DISCARDED",
        error: "OPERATOR_CHANGED_CONVERSATION",
        completedAt: now,
      },
    });
    if (["takeover", "pause", "reply"].includes(data.action)) {
      update.agentEnabled = false;
      update.status = "PAUSED";
      update.assignedToId = context.usuario.id;
      await tx.avAgentPause.updateMany({
        where: { conversationId: id, resumedAt: null },
        data: { resumedAt: now, resumedById: context.usuario.id },
      });
      await tx.avAgentPause.create({
        data: {
          ...full,
          actorId: context.usuario.id,
          reason:
            data.action === "takeover"
              ? "Atendimento assumido pela equipe."
              : data.action === "reply"
                ? "Resposta manual."
                : "Pausa solicitada pela equipe.",
          until: data.minutes
            ? new Date(Date.now() + data.minutes * 60_000)
            : null,
        },
      });
      await tx.avMessageOutbox.updateMany({
        where: { conversationId: id, author: "AGENT", state: "PENDING" },
        data: {
          state: "DISCARDED",
          error: "Atendimento assumido por uma pessoa.",
        },
      });
    }
    if (data.action === "reply") {
      if (!data.text)
        throw new CrmError(
          "TEXT_REQUIRED",
          "Digite uma mensagem para responder.",
          400,
        );
      await tx.avMessageOutbox.create({
        data: {
          ...full,
          requestId: data.requestId,
          version,
          author: "HUMAN",
          actorId: context.usuario.id,
          text: maskVirtualSecrets(data.text),
        },
      });
    }
    if (data.action === "resume" || data.action === "reopen") {
      const pendingTasks = await tx.avEscalation.findMany({
        where: { conversationId: id, status: { not: "RESOLVED" } },
        select: { id: true },
      });
      if (pendingTasks.length && !data.summary?.trim())
        throw new CrmError(
          "RESUME_SUMMARY_REQUIRED",
          "Resuma o que a equipe resolveu antes de retomar a IA.",
          400,
        );
      if (pendingTasks.length > 1 && !data.escalationId)
        throw new CrmError(
          "ESCALATION_REQUIRED",
          "Escolha a pendência resolvida. As outras continuam com a equipe.",
          400,
        );
      const selectedTask = data.escalationId
        ? pendingTasks.find((t) => t.id === data.escalationId)
        : pendingTasks[0];
      if (data.escalationId && !selectedTask)
        throw new CrmError(
          "NOT_FOUND",
          "A pendência escolhida já foi resolvida ou não pertence à conversa.",
          404,
        );
      if (selectedTask)
        await tx.avEscalation.update({
          where: { id: selectedTask.id },
          data: { status: "RESOLVED", resolvedAt: now },
        });
      const remaining = pendingTasks.length - (selectedTask ? 1 : 0);
      update.agentEnabled = remaining === 0;
      update.status = remaining ? "ESCALATED" : "OPEN";
      update.optedOut = false;
      update.assignedToId = null;
      update.attempts = 0;
      update.lastError = null;
      update.processAfter = now;
      if (data.summary) update.summary = maskVirtualSecrets(data.summary);
      if (data.summary?.trim()) {
        await tx.avMessage.updateMany({
          where: {
            conversationId: id,
            direction: "INBOUND",
            processedAt: null,
          },
          data: { processedAt: now },
        });
        update.pendingSince = null;
        update.processAfter = null;
      }
      await tx.avAgentPause.updateMany({
        where: { conversationId: id, resumedAt: null },
        data: {
          resumedAt: now,
          resumedById: context.usuario.id,
          summary: maskVirtualSecrets(data.summary ?? ""),
        },
      });
    }
    if (data.action === "resolve") {
      update.status = "RESOLVED";
      update.agentEnabled = false;
      await tx.avEscalation.updateMany({
        where: { conversationId: id, status: { not: "RESOLVED" } },
        data: { status: "RESOLVED", resolvedAt: now },
      });
    }
    if (data.action === "ack_escalation" || data.action === "retry_alert") {
      const task = await tx.avEscalation.findFirst({
        where: {
          ...full,
          ...(data.escalationId ? { id: data.escalationId } : {}),
          status: { not: "RESOLVED" },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!task)
        throw new CrmError("NOT_FOUND", "Pendência não encontrada.", 404);
      if (data.action === "ack_escalation") {
        await tx.avEscalation.update({
          where: { id: task.id },
          data: {
            status: "ACKNOWLEDGED",
            acknowledgedAt: now,
            acknowledgedById: context.usuario.id,
            assignedToId: context.usuario.id,
          },
        });
        update.agentEnabled = false;
        update.assignedToId = context.usuario.id;
      } else await notifyVirtualEscalation(tx, full, task.id);
    }
    await tx.avConversation.update({ where: { id }, data: update });
    await tx.avOperatorRequest.create({
      data: {
        organizationId: scope.organizationId,
        storeId: data.storeId,
        conversationId: id,
        actorId: context.usuario.id,
        requestId: data.requestId,
        hash,
      },
    });
    await virtualAudit(tx, full, context.usuario.id, data.action, { version });
  });
  await deliverVirtualOutbox(20, channelFor);
  return { success: true };
}
