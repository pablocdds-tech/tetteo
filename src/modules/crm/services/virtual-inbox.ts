import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import {
  VIRTUAL_STATUSES,
  type VirtualConversationDetail,
  type VirtualEscalation,
  type VirtualHealth,
  type VirtualInboxItem,
  type VirtualInboxResult,
  type VirtualStatus,
} from "../virtual-types";
import { CrmError, protectIdentity } from "./campaign-domain";
import {
  authorizeVirtual,
  createVirtualEscalation,
  receiveVirtualInbound,
  virtualAudit,
} from "./virtual-runtime";
import { ensureVirtualDemoKnowledge } from "./virtual-knowledge";
import { safeVirtualModelStatus } from "./virtual-model";

const listSchema = z
  .object({
    storeId: z.string().min(1),
    accountId: z.string().uuid().optional(),
    status: z.enum([...VIRTUAL_STATUSES, "ALL"]).default("ALL"),
    search: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    escalationOnly: z.coerce.string().optional(),
  })
  .strict();
const withList = {
  account: { select: { name: true, mode: true } },
  messages: { orderBy: { sequence: "desc" as const }, take: 1 },
  pauses: {
    where: { resumedAt: null },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  escalations: {
    where: { status: { not: "RESOLVED" } },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
};
type Listed = Prisma.AvConversationGetPayload<{ include: typeof withList }>;
async function names(ids: (string | null)[]) {
  const users = await db.usuario.findMany({
    where: { id: { in: ids.filter((x): x is string => Boolean(x)) } },
    select: { id: true, nome: true },
  });
  return new Map(users.map((u) => [u.id, u.nome]));
}
function escalationDto(
  e: {
    id: string;
    conversationId: string;
    reason: string;
    excerpt: string;
    status: string;
    assignedToId: string | null;
    acknowledgedAt: Date | null;
    alertState: string;
    alertError: string | null;
    createdAt: Date;
  },
  customerName: string,
  users: Map<string, string>,
): VirtualEscalation {
  return {
    id: e.id,
    conversationId: e.conversationId,
    customerName,
    reason: e.reason,
    excerpt: e.excerpt,
    status: e.status,
    owner: e.assignedToId ? (users.get(e.assignedToId) ?? "Responsável") : null,
    acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
    alertStatus: e.alertState,
    alertError: e.alertError,
    createdAt: e.createdAt.toISOString(),
  };
}
function itemDto(
  c: Listed,
  unitName: string,
  users: Map<string, string>,
): VirtualInboxItem {
  return {
    id: c.id,
    customerName: c.displayName,
    customerId: c.contactId,
    unitName,
    channel: c.account.name,
    demo: c.account.mode === "DEMO",
    lastMessage: c.messages[0]?.text ?? "Conversa iniciada",
    lastMessageAt: c.lastMessageAt.toISOString(),
    owner: c.assignedToId ? (users.get(c.assignedToId) ?? "Responsável") : null,
    status: c.status as VirtualStatus,
    agentEnabled: c.agentEnabled,
    version: c.version,
    pauseUntil: c.pauses[0]?.until?.toISOString() ?? null,
    latestEscalation: c.escalations[0]
      ? escalationDto(c.escalations[0], c.displayName, users)
      : null,
  };
}
export async function listVirtualInbox(
  context: ContextoSessao,
  raw: unknown,
): Promise<VirtualInboxResult> {
  const data = listSchema.parse(raw);
  const scope = await authorizeVirtual(context, data.storeId);
  const base: Prisma.AvConversationWhereInput = {
    organizationId: scope.organizationId,
    storeId: data.storeId,
    ...(data.accountId ? { accountId: data.accountId } : {}),
  };
  if (data.search) {
    const literal = data.search.replace(/[\\%_]/g, "\\$&");
    base.OR = [
      { displayName: { contains: literal, mode: "insensitive" } },
      ...(data.search.replace(/\D/g, "").length >= 3
        ? [{ externalCustomerId: { contains: data.search.replace(/\D/g, "") } }]
        : []),
      {
        messages: {
          some: { text: { contains: literal, mode: "insensitive" } },
        },
      },
    ];
  }
  if (data.escalationOnly === "true")
    base.escalations = { some: { status: { not: "RESOLVED" } } };
  const result = await db.$transaction(
    async (tx) => {
      const grouped = await tx.avConversation.groupBy({
        by: ["status"],
        where: base,
        _count: { _all: true },
      });
      const where = {
        ...base,
        ...(data.status !== "ALL" ? { status: data.status } : {}),
      };
      const total = await tx.avConversation.count({ where });
      const page = Math.min(data.page, Math.max(1, Math.ceil(total / 20)));
      const rows = await tx.avConversation.findMany({
        where,
        include: withList,
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 20,
        take: 20,
      });
      return { grouped, total, page, rows };
    },
    { isolationLevel: "RepeatableRead" },
  );
  const users = await names(
    result.rows.flatMap((c) => [
      c.assignedToId,
      ...c.escalations.map((e) => e.assignedToId),
    ]),
  );
  const counts = Object.fromEntries(
    VIRTUAL_STATUSES.map((status) => [
      status,
      result.grouped.find((g) => g.status === status)?._count._all ?? 0,
    ]),
  ) as Record<VirtualStatus, number>;
  return {
    items: result.rows.map((c) => itemDto(c, scope.unit.nome, users)),
    total: result.total,
    page: result.page,
    pageSize: 20,
    counts,
  };
}
export async function getVirtualConversation(
  context: ContextoSessao,
  storeId: string,
  id: string,
): Promise<VirtualConversationDetail> {
  const scope = await authorizeVirtual(context, storeId);
  const c = await db.avConversation.findFirst({
    where: { id, organizationId: scope.organizationId, storeId },
    include: withList,
  });
  if (!c)
    throw new CrmError(
      "NOT_FOUND",
      "Conversa indisponível nesta unidade.",
      404,
    );
  const full = {
    organizationId: scope.organizationId,
    storeId,
    accountId: c.accountId,
  };
  const [
    messages,
    pauses,
    escalations,
    reservations,
    runs,
    preferences,
    contact,
    outbox,
  ] = await Promise.all([
    db.avMessage.findMany({
      where: { ...full, conversationId: id },
      orderBy: { sequence: "desc" },
      take: 200,
    }),
    db.avAgentPause.findFirst({
      where: { ...full, conversationId: id, resumedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    db.avEscalation.findMany({
      where: { ...full, conversationId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.avReservation.findMany({
      where: { ...full, externalCustomerId: c.externalCustomerId },
      include: { slot: { select: { date: true, time: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.avAgentRun.findMany({
      where: { ...full, conversationId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.avCustomerPreference.findMany({
      where: { ...full, externalCustomerId: c.externalCustomerId },
      select: { key: true, value: true },
      take: 20,
    }),
    c.contactId
      ? db.crmContact.findFirst({
          where: { id: c.contactId, storeId, active: true, mergedIntoId: null },
          select: { id: true, name: true, updatedAt: true },
        })
      : Promise.resolve(null),
    db.avMessageOutbox.findMany({
      where: { ...full, conversationId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  const users = await names([
    c.assignedToId,
    pauses?.actorId ?? null,
    ...escalations.map((e) => e.assignedToId),
  ]);
  return {
    conversation: itemDto(c, scope.unit.nome, users),
    messages: [
      ...messages.map((m) => ({
        id: m.id,
        text: m.text,
        direction: m.direction,
        author: m.author,
        kind: m.kind,
        status:
          m.direction === "INBOUND"
            ? "RECEIVED"
            : (outbox.find((o) => o.providerId === m.externalId)?.state ??
              "ACCEPTED"),
        createdAt: m.createdAt.toISOString(),
      })),
      ...outbox
        .filter(
          (o) =>
            !o.providerId ||
            !messages.some((m) => m.externalId === o.providerId),
        )
        .map((o) => ({
          id: o.id,
          text: o.text,
          direction: "OUTBOUND",
          author: o.author,
          kind: "TEXT",
          status: o.state,
          createdAt: o.createdAt.toISOString(),
        })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    customer: {
      id: contact?.id ?? null,
      name:
        preferences.find((p) => p.key === "name")?.value ??
        contact?.name ??
        c.displayName,
      known: Boolean(contact),
      source: contact
        ? c.account.mode === "DEMO"
          ? "Identificador verificado da conta de demonstração"
          : "CRM: identificador verificado do canal desta unidade"
        : "Identidade não cadastrada; somente contexto desta conversa",
      updatedAt: contact?.updatedAt.toISOString() ?? null,
      preferences,
    },
    pause: pauses
      ? {
          id: pauses.id,
          until: pauses.until?.toISOString() ?? null,
          actor: users.get(pauses.actorId) ?? "Equipe",
          reason: pauses.reason,
          createdAt: pauses.createdAt.toISOString(),
        }
      : null,
    escalations: escalations.map((e) => escalationDto(e, c.displayName, users)),
    reservations: reservations.map((r) => ({
      id: r.id,
      date: r.slot.date,
      time: r.slot.time,
      partySize: r.partySize,
      status: r.status,
      guestName: r.guestName,
    })),
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      model: r.model,
      tokens: r.tokens,
      costMicros: r.costMicros,
      latencyMs: r.latencyMs,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    })),
    summary: c.summary,
  };
}
export async function getVirtualHealth(
  context: ContextoSessao,
  storeId: string,
  accountId?: string,
): Promise<VirtualHealth> {
  const scope = await authorizeVirtual(context, storeId);
  const account = await db.avChannelAccount.findFirst({
    where: {
      organizationId: scope.organizationId,
      storeId,
      ...(accountId ? { id: accountId } : { mode: "DEMO" }),
    },
  });
  const base = {
    organizationId: scope.organizationId,
    storeId,
    ...(accountId ? { accountId } : {}),
  };
  const [
    pending,
    oldest,
    errors,
    empty,
    loops,
    escalations,
    failedAlerts,
    cost,
    probeCost,
    last,
  ] = await Promise.all([
    db.avConversation.count({
      where: { ...base, pendingSince: { not: null }, agentEnabled: true },
    }),
    db.avConversation.findFirst({
      where: { ...base, pendingSince: { not: null }, agentEnabled: true },
      orderBy: { pendingSince: "asc" },
      select: { pendingSince: true },
    }),
    db.avMessageOutbox.count({
      where: { ...base, state: { in: ["FAILED", "UNCERTAIN", "BLOCKED"] } },
    }),
    db.avAgentRun.count({ where: { ...base, error: "EMPTY_RESPONSE" } }),
    db.avAgentRun.count({
      where: { ...base, error: { in: ["TOOL_LOOP", "CONVERSATION_LOOP"] } },
    }),
    db.avEscalation.count({ where: { ...base, status: { not: "RESOLVED" } } }),
    db.avEscalation.count({
      where: { ...base, status: { not: "RESOLVED" }, alertState: "FAILED" },
    }),
    db.avAgentRun.aggregate({
      where: { ...base, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      _sum: { tokens: true, costMicros: true },
    }),
    db.avModelProbe.aggregate({
      where: {
        organizationId: scope.organizationId,
        storeId,
        createdAt: { gte: new Date(Date.now() - 86_400_000) },
      },
      _sum: { tokens: true, costMicros: true },
    }),
    db.avAgentRun.findFirst({
      where: { ...base, error: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { error: true },
    }),
  ]);
  return {
    demo: account?.mode === "DEMO",
    engine: await safeVirtualModelStatus({
      organizationId: scope.organizationId,
      storeId,
    }),
    accountName: account?.name ?? "Nenhum canal selecionado",
    active: account?.active ?? false,
    lastWebhookAt: account?.lastWebhookAt?.toISOString() ?? null,
    queuePending: pending,
    queueDelayMs: oldest?.pendingSince
      ? Date.now() - oldest.pendingSince.getTime()
      : 0,
    channelErrors: errors,
    emptyResponses: empty,
    loopsBlocked: loops,
    pendingEscalations: escalations,
    failedAlerts,
    tokens: (cost._sum.tokens ?? 0) + (probeCost._sum.tokens ?? 0),
    costMicros: (cost._sum.costMicros ?? 0) + (probeCost._sum.costMicros ?? 0),
    dailyBudgetMicros: account?.dailyBudgetMicros ?? 0,
    circuitUntil: account?.circuitUntil?.toISOString() ?? null,
    lastError: last?.error ?? null,
  };
}
export async function ensureVirtualDemo(
  context: ContextoSessao,
  storeId: string,
) {
  const scope = await authorizeVirtual(context, storeId, true);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:init:${storeId}`}))`;
      const existingAccount = await tx.avChannelAccount.findFirst({
        where: { organizationId: scope.organizationId, storeId, mode: "DEMO" },
        orderBy: { createdAt: "asc" },
      });
      const account =
        existingAccount ??
        (await tx.avChannelAccount.create({
          data: {
            organizationId: scope.organizationId,
            storeId,
            name: "Kairu · demonstração",
            mode: "DEMO",
            timezone: scope.unit.fusoHorario,
            notificationUserId: context.usuario.id,
          },
        }));
      const full = {
        organizationId: scope.organizationId,
        storeId,
        accountId: account.id,
      };
      await ensureVirtualDemoKnowledge(tx, full, context.usuario.id);
      const ids: string[] = [];
      for (const fixture of [
        {
          key: "demo:ana",
          name: "Ana · exemplo Kairu",
          text: "Olá! Vocês têm opção vegetariana?",
          known: true,
        },
        {
          key: "demo:bruno",
          name: "Bruno · exemplo Kairu",
          text: "Gostaria de reservar amanhã, às 19h, para quatro pessoas.",
          known: false,
        },
        {
          key: "demo:carla",
          name: "Carla · exemplo Kairu",
          text: "Preciso conversar com alguém sobre uma cobrança.",
          known: false,
        },
      ]) {
        const exists = await tx.avConversation.findUnique({
          where: {
            accountId_externalCustomerId: {
              accountId: account.id,
              externalCustomerId: fixture.key,
            },
          },
        });
        if (exists) {
          ids.push(exists.id);
          continue;
        }
        let contactId: string | null = null;
        if (fixture.known) {
          const contact = await tx.crmContact.create({
            data: { storeId, name: fixture.name, marketingOptIn: false },
          });
          contactId = contact.id;
          const protectedValue = protectIdentity(
            storeId,
            `AV_DEMO:${account.id}`,
            fixture.key,
          );
          await tx.crmIdentity.create({
            data: {
              storeId,
              contactId,
              type: `AV_DEMO:${account.id}`,
              ...protectedValue,
              verifiedAt: new Date(),
              verifiedById: context.usuario.id,
            },
          });
        }
        const conversation = await tx.avConversation.create({
          data: {
            ...full,
            externalCustomerId: fixture.key,
            displayName: fixture.name,
            contactId,
            pendingSince: new Date(),
            processAfter: new Date(),
          },
        });
        ids.push(conversation.id);
        await tx.avMessage.create({
          data: {
            ...full,
            conversationId: conversation.id,
            externalId: `fixture:${fixture.key}`,
            direction: "INBOUND",
            author: "CUSTOMER",
            text: fixture.text,
          },
        });
        if (fixture.key === "demo:carla") {
          const task = await createVirtualEscalation(
            tx,
            { ...full, conversationId: conversation.id },
            {
              key: "fixture:billing",
              reason: "Dúvida sobre cobrança precisa da equipe.",
              excerpt: fixture.text,
            },
          );
          // Histórico fictício reconhecido fica identificado como demonstração.
          await tx.avEscalation.update({
            where: { id: task.id },
            data: {
              status: "ACKNOWLEDGED",
              acknowledgedAt: new Date(),
              acknowledgedById: context.usuario.id,
              assignedToId: context.usuario.id,
            },
          });
          await tx.avConversation.update({
            where: { id: conversation.id },
            data: { assignedToId: context.usuario.id },
          });
        }
        await virtualAudit(
          tx,
          { ...full, conversationId: conversation.id },
          context.usuario.id,
          "DEMO_FIXTURE_CREATED",
        );
      }
      return { accountId: account.id, conversationIds: ids };
    },
    { timeout: 20000 },
  );
}
const demoSchema = z
  .object({
    storeId: z.string().min(1),
    scenario: z
      .enum(["known", "new", "escalated", "international", "audio"])
      .optional(),
    conversationId: z.string().uuid().optional(),
    text: z.string().max(4000).optional(),
    requestId: z.string().uuid(),
  })
  .strict();
export async function simulateVirtualMessage(
  context: ContextoSessao,
  raw: unknown,
) {
  const data = demoSchema.parse(raw);
  const initialized = await ensureVirtualDemo(context, data.storeId);
  if (!data.text && !data.scenario && !data.conversationId) return initialized;
  const target = data.conversationId
    ? await db.avConversation.findFirst({
        where: {
          id: data.conversationId,
          organizationId: context.organizacao.id,
          storeId: data.storeId,
          accountId: initialized.accountId,
        },
      })
    : null;
  if (data.conversationId && !target)
    throw new CrmError("NOT_FOUND", "Conversa indisponível.", 404);
  const senderKey =
    target?.externalCustomerId ??
    {
      known: "demo:ana",
      new: "demo:visitante",
      escalated: "demo:carla",
      international: "demo:international",
      audio: "demo:audio",
    }[data.scenario ?? "new"];
  return receiveVirtualInbound(initialized.accountId, {
    externalId: `demo-event:${data.requestId}`,
    senderKey,
    type: "MESSAGE",
    text:
      data.text ??
      (data.scenario === "audio"
        ? ""
        : data.scenario === "international"
          ? "Olá, estou viajando e quero saber o cardápio."
          : "Olá! Qual o horário da unidade?"),
    kind: data.scenario === "audio" ? "AUDIO" : "TEXT",
    transcriptionCertain: data.scenario !== "audio",
  });
}
