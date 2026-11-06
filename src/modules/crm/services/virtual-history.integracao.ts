import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, afterEach } from "node:test";
import { contextoDeFundo } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type {
  ChannelHistoryMessage,
  ChannelHistoryPage,
  ChannelManagementFactory,
} from "@/server/atendimento-provedor";
import {
  getVirtualHistory,
  startVirtualHistory,
  processVirtualHistoryQueue,
  scheduleAutomaticVirtualHistory,
  refreshVirtualHistoryConnections,
} from "./virtual-history";
import {
  lockVirtualConversation,
  receiveVirtualInbound,
} from "./virtual-runtime";
import { getVirtualConversation, listVirtualInbox } from "./virtual-inbox";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
const accounts: string[] = [];
afterEach(async () => {
  await db.avChannelConnection.updateMany({
    where: { accountId: { in: accounts } },
    data: {
      connectionState: "PENDING",
      verifiedAt: null,
      verifiedRevision: null,
    },
  });
  await db.avChannelHistoryRecentSync.updateMany({
    where: { accountId: { in: accounts } },
    data: {
      state: "FAILED",
      leaseOwner: null,
      leaseUntil: null,
      finishedAt: new Date(),
    },
  });
  await db.avChannelHistorySync.updateMany({
    where: { accountId: { in: accounts } },
    data: {
      state: "FAILED",
      leaseOwner: null,
      leaseUntil: null,
      finishedAt: new Date(),
    },
  });
});
after(async () => db.$disconnect());
const sender = "+12025550123";
const historical = (
  extra: Partial<ChannelHistoryMessage> = {},
): ChannelHistoryMessage => ({
  externalId: `message:${randomUUID()}`,
  senderKey: sender,
  trustedPhone: sender,
  fromSelf: false,
  kind: "TEXT",
  text: "Mensagem fictícia Kairu",
  occurredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  transcriptionCertain: true,
  ...extra,
});
const page = (
  messages: ChannelHistoryMessage[],
  number = 1,
  next: number | null = null,
): ChannelHistoryPage => ({
  messages,
  page: number,
  pageSize: 100,
  total: messages.length,
  pages: next ?? number,
  nextPage: next,
  skipped: 0,
});
async function fixture(mode = "EVOLUTION") {
  const organization = await db.organizacao.create({
    data: { nome: "Histórico fictício Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Unidade fictícia",
      codigo: "QA",
    },
  });
  const actor = await db.usuario.create({
    data: {
      nome: "Gestor fictício Kairu",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const role = await db.papel.create({
    data: {
      organizacaoId: organization.id,
      nome: "Gestão fictícia",
      permissoes: {
        create: ["crm.ver", "crm.editar", "crm.gerenciar"].map((chave) => ({
          chave,
        })),
      },
    },
  });
  const access = await db.acesso.create({
    data: {
      usuarioId: actor.id,
      organizacaoId: organization.id,
      unidadeId: unit.id,
      papelId: role.id,
    },
  });
  const context = (await contextoDeFundo(actor.id, unit.id))!;
  const account = await db.avChannelAccount.create({
    data: {
      organizationId: organization.id,
      storeId: unit.id,
      name: "WhatsApp fictício Kairu",
      mode,
      active: false,
    },
  });
  accounts.push(account.id);
  await db.avChannelConnection.create({
    data: {
      organizationId: organization.id,
      storeId: unit.id,
      accountId: account.id,
      encryptedCredentials: "cipher-not-used-by-fake-adapter",
      settings: {},
      bindingKey: `fixture:${randomUUID()}`,
      connectionState: "VERIFIED",
      verifiedRevision: 1,
      verifiedAt: new Date(),
    },
  });
  let reads = 0;
  let reader: (query: {
    page: number;
  }) => Promise<ChannelHistoryPage> = async () => page([]);
  const factory: ChannelManagementFactory = async (id) => ({
    identify: () => ({ mode: "EVOLUTION", accountKey: id, revision: 1 }),
    verify: async () => ({ connected: true }),
    webhook: async () => {
      throw new Error("Histórico não altera webhook");
    },
    qr: async () => {
      throw new Error("Histórico não gera QR");
    },
    sendText: async () => {
      throw new Error("Histórico não envia texto");
    },
    sendMedia: async () => {
      throw new Error("Histórico não envia mídia");
    },
    consultStatus: async () => {
      throw new Error("Histórico não consulta entrega");
    },
    readHistoryPage: async (query) => {
      reads++;
      return reader(query);
    },
  });
  const start = (requestId = randomUUID()) =>
    startVirtualHistory(context, {
      storeId: unit.id,
      accountId: account.id,
      action: "sync",
      requestId,
    });
  const result = () => getVirtualHistory(context, unit.id, account.id);
  return {
    organization,
    unit,
    actor,
    access,
    context,
    account,
    factory,
    start,
    result,
    reads: () => reads,
    setReader: (value: typeof reader) => {
      reader = value;
    },
  };
}
const scopeOf = (f: Awaited<ReturnType<typeof fixture>>) => ({
  organizationId: f.organization.id,
  storeId: f.unit.id,
  accountId: f.account.id,
});

test("importa conta pausada com data original, direções e segredos mascarados sem criar automação", async () => {
  const f = await fixture();
  const before = historical({
    text: "Quero reservar amanhã; token=SEGREDO_FICTICIO",
    displayName: "Ana • exemplo Kairu",
  });
  const after = historical({
    fromSelf: true,
    text: "Resposta histórica fictícia",
    occurredAt: new Date(
      new Date(before.occurredAt).getTime() + 10000,
    ).toISOString(),
  });
  f.setReader(async () => page([after, before]));
  await f.start();
  await processVirtualHistoryQueue(f.factory);
  const result = await f.result();
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.importedMessages, 2);
  assert.equal(result.importedConversations, 1);
  assert.equal(result.complete, true);
  const conversation = await db.avConversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(conversation.agentEnabled, false);
  assert.equal(conversation.status, "OPEN");
  assert.equal(conversation.pendingSince, null);
  assert.equal(conversation.processAfter, null);
  assert.equal(conversation.lastMessageAt.toISOString(), after.occurredAt);
  assert.equal(conversation.contactId, null);
  const messages = await db.avMessage.findMany({
    where: { accountId: f.account.id },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    messages.map((m) => [m.direction, m.author, m.source]),
    [
      ["INBOUND", "CUSTOMER", "HISTORY"],
      ["OUTBOUND", "HUMAN", "HISTORY"],
    ],
  );
  assert.ok(messages.every((m) => m.processedAt));
  assert.doesNotMatch(JSON.stringify(messages), /SEGREDO_FICTICIO/);
  assert.equal(
    await db.avAgentRun.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    await db.avToolExecution.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    await db.avMessageOutbox.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    await db.avChannelWindow.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    await db.avReservation.count({ where: { accountId: f.account.id } }),
    0,
  );
  const detail = await getVirtualConversation(
    f.context,
    f.unit.id,
    conversation.id,
  );
  assert.equal(detail.messages[0].createdAt, before.occurredAt);
  const inbox = await listVirtualInbox(f.context, {
    storeId: f.unit.id,
    accountId: f.account.id,
  });
  assert.equal(inbox.items[0].lastMessage, after.text);
});

test("autorização e conta são verificadas antes da importação; Meta não oferece histórico arbitrário", async () => {
  const f = await fixture(),
    other = await fixture("META");
  await assert.rejects(
    startVirtualHistory(
      { ...f.context, permissoes: new Set(["crm.ver"]) },
      {
        storeId: f.unit.id,
        accountId: f.account.id,
        action: "sync",
        requestId: randomUUID(),
      },
    ),
    /Sem acesso/,
  );
  await assert.rejects(
    getVirtualHistory(f.context, f.unit.id, other.account.id),
    /Conta não encontrada/,
  );
  assert.equal((await other.result()).supported, false);
  await assert.rejects(other.start(), /não oferece/);
  await f.start();
  await db.acesso.update({
    where: { id: f.access.id },
    data: { status: "SUSPENSO" },
  });
  await processVirtualHistoryQueue(f.factory);
  assert.equal(f.reads(), 0);
  assert.equal((await f.result()).state, "FAILED");
});

test("deduplica mensagens live e saídas do sistema sem alterar controle humano ou fila pendente", async () => {
  const f = await fixture();
  const liveId = `message:${randomUUID()}`;
  const received = await receiveVirtualInbound(
    f.account.id,
    {
      externalId: liveId,
      senderKey: sender,
      trustedPhone: sender,
      type: "MESSAGE",
      text: "Mensagem nova",
      occurredAt: new Date().toISOString(),
    },
    { provider: "EVOLUTION", revision: 1 },
  );
  const conversation = await db.avConversation.update({
    where: { id: received.conversationId! },
    data: {
      status: "PAUSED",
      agentEnabled: false,
      assignedToId: f.actor.id,
      state: { pending: "preservar" },
    },
  });
  const outgoing = randomUUID();
  await db.avMessage.create({
    data: {
      ...scopeOf(f),
      conversationId: conversation.id,
      externalId: outgoing,
      direction: "OUTBOUND",
      author: "AGENT",
      text: "Saída real do serviço fictício",
      processedAt: new Date(),
    },
  });
  f.setReader(async () =>
    page([
      historical({ externalId: liveId }),
      historical({
        externalId: liveId,
        senderKey: "+12025550124",
        trustedPhone: "+12025550124",
      }),
      historical({ externalId: `message:${outgoing}`, fromSelf: true }),
      historical(),
    ]),
  );
  await f.start();
  await processVirtualHistoryQueue(f.factory);
  assert.equal((await f.result()).importedMessages, 1);
  assert.equal((await f.result()).skippedMessages, 3);
  assert.equal(await db.avConversation.count({ where: scopeOf(f) }), 1);
  const current = await db.avConversation.findUniqueOrThrow({
    where: { id: conversation.id },
  });
  assert.equal(current.status, conversation.status);
  assert.equal(current.version, conversation.version);
  assert.equal(current.agentEnabled, conversation.agentEnabled);
  assert.deepEqual(current.state, conversation.state);
  assert.equal(
    current.pendingSince?.getTime(),
    conversation.pendingSince?.getTime(),
  );
  assert.equal(
    current.processAfter?.getTime(),
    conversation.processAfter?.getTime(),
  );
  assert.equal(
    (
      await db.avMessage.findUniqueOrThrow({
        where: {
          accountId_externalId: { accountId: f.account.id, externalId: liveId },
        },
      })
    ).processedAt,
    null,
  );
});

test("webhook posterior à importação não reabre nem enfileira a mesma mensagem histórica", async () => {
  const f = await fixture(),
    message = historical({
      occurredAt: new Date(Date.now() - 10000).toISOString(),
    });
  f.setReader(async () => page([message]));
  await f.start();
  await processVirtualHistoryQueue(f.factory);
  const previous = await db.avConversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  const liveMessage = { ...message };
  delete liveMessage.displayName;
  await receiveVirtualInbound(
    f.account.id,
    { ...liveMessage, type: "MESSAGE" },
    { provider: "EVOLUTION", revision: 1 },
  );
  const current = await db.avConversation.findUniqueOrThrow({
    where: { id: previous.id },
  });
  assert.equal(current.version, previous.version);
  assert.equal(current.pendingSince, null);
  assert.equal(
    await db.avMessage.count({ where: { accountId: f.account.id } }),
    1,
  );
});

test("replay é idempotente e importação parcial continua cursor e cobertura no novo pedido", async () => {
  const f = await fixture();
  const requestId = randomUUID();
  await f.start(requestId);
  await f.start(requestId);
  await db.avChannelHistorySync.update({
    where: { accountId: f.account.id },
    data: { pagesProcessed: 999 },
  });
  f.setReader(async (query) =>
    query.page === 1 ? page([historical()], 1, 2) : page([historical()], 2),
  );
  await processVirtualHistoryQueue(f.factory);
  assert.equal((await f.result()).state, "PARTIAL");
  const prior = await db.avChannelHistorySync.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  await f.start(randomUUID());
  const resumed = await db.avChannelHistorySync.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(resumed.nextPage, 2);
  assert.equal(resumed.until.getTime(), prior.until.getTime());
  assert.equal(resumed.importedMessages, 1);
  assert.equal(resumed.pagesProcessed, 0);
  await processVirtualHistoryQueue(f.factory);
  assert.equal((await f.result()).state, "COMPLETE");
  assert.equal((await f.result()).importedMessages, 2);
  assert.equal(f.reads(), 2);
  await f.start(requestId);
  assert.equal((await f.result()).state, "COMPLETE");
  assert.equal((await f.result()).importedMessages, 2);
  await f.start();
  assert.equal((await f.result()).state, "RUNNING");
  assert.equal((await f.result()).importedMessages, 0);
  await f.start(requestId);
  assert.equal((await f.result()).importedMessages, 0);
  assert.equal(
    (
      await db.avChannelHistorySync.findUniqueOrThrow({
        where: { accountId: f.account.id },
      })
    ).nextPage,
    1,
  );
});

test("página repetida é interrompida e erro externo não revela credencial nem repete além de três tentativas", async () => {
  const f = await fixture(),
    same = historical();
  f.setReader(async (query) => page([same], query.page, query.page + 1));
  await f.start();
  await processVirtualHistoryQueue(f.factory);
  await processVirtualHistoryQueue(f.factory);
  assert.equal((await f.result()).state, "FAILED");
  assert.equal((await f.result()).importedMessages, 1);
  await f.start();
  f.setReader(async () => {
    throw new Error("token=SEGREDO_FICTICIO");
  });
  for (let i = 0; i < 4; i++) await processVirtualHistoryQueue(f.factory);
  const result = await f.result();
  assert.equal(result.state, "FAILED");
  assert.doesNotMatch(JSON.stringify(result), /SEGREDO_FICTICIO/);
  assert.equal(f.reads(), 5);
});

test("duas réplicas disputam uma página e somente uma consulta o provedor fora da transação", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
  f.setReader(async () => {
    entered();
    await waiting;
    return page([historical()]);
  });
  await f.start();
  const first = processVirtualHistoryQueue(f.factory);
  await started;
  try {
    await processVirtualHistoryQueue(f.factory);
    assert.equal(f.reads(), 1);
  } finally {
    release();
    await first;
  }
  assert.equal((await f.result()).importedMessages, 1);
});

test("resposta atrasada não grava mensagens nem limpa lease de outro dono; lease expirado recupera", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
  f.setReader(async () => {
    entered();
    await waiting;
    return page([historical()]);
  });
  await f.start();
  const first = processVirtualHistoryQueue(f.factory);
  await started;
  await db.avChannelHistorySync.update({
    where: { accountId: f.account.id },
    data: {
      leaseOwner: "replacement-worker",
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  release();
  await first;
  assert.equal(
    await db.avMessage.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    (
      await db.avChannelHistorySync.findUniqueOrThrow({
        where: { accountId: f.account.id },
      })
    ).leaseOwner,
    "replacement-worker",
  );
  await db.avChannelHistorySync.update({
    where: { accountId: f.account.id },
    data: { leaseUntil: new Date(Date.now() - 1000) },
  });
  f.setReader(async () => page([historical()]));
  await processVirtualHistoryQueue(f.factory);
  assert.equal((await f.result()).state, "COMPLETE");
});

test("mudança de revisão durante consulta interrompe importação sem persistir resposta antiga", async () => {
  const f = await fixture();
  f.setReader(async () => {
    await db.avChannelConnection.update({
      where: { accountId: f.account.id },
      data: {
        revision: 2,
        verifiedRevision: null,
        verifiedAt: null,
        connectionState: "PENDING",
      },
    });
    return page([historical()]);
  });
  await f.start();
  await processVirtualHistoryQueue(f.factory);
  assert.equal((await f.result()).state, "FAILED");
  assert.equal(
    await db.avMessage.count({ where: { accountId: f.account.id } }),
    0,
  );
});

test("linhas sem identidade/data confiável são descartadas sem criar janela ou cadastro", async () => {
  const f = await fixture();
  const rows = [
    historical({ senderKey: "123@lid" }),
    historical({ trustedPhone: "+12025550124" }),
    historical({ occurredAt: "" }),
    historical({ occurredAt: "2099-01-01T00:00:00.000Z" }),
  ];
  f.setReader(async () => page(rows));
  await f.start();
  await processVirtualHistoryQueue(f.factory);
  const result = await f.result();
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.importedMessages, 0);
  assert.equal(result.skippedMessages, 4);
  assert.equal(
    await db.avConversation.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    await db.avChannelWindow.count({ where: { accountId: f.account.id } }),
    0,
  );
});

test("revogação do responsável durante HTTP impede persistência da página", async () => {
  const f = await fixture();
  f.setReader(async () => {
    await db.acesso.update({
      where: { id: f.access.id },
      data: { status: "SUSPENSO" },
    });
    return page([historical()]);
  });
  await f.start();
  await processVirtualHistoryQueue(f.factory);
  assert.equal((await f.result()).state, "FAILED");
  assert.equal(await db.avMessage.count({ where: scopeOf(f) }), 0);
  assert.equal(await db.avConversation.count({ where: scopeOf(f) }), 0);
});

test("três leases abandonados encerram a página sem repetir consultas indefinidamente", async () => {
  const f = await fixture();
  await f.start();
  await db.avChannelHistorySync.update({
    where: { accountId: f.account.id },
    data: {
      attempts: 2,
      leaseOwner: "processo-interrompido",
      leaseUntil: new Date(Date.now() - 1000),
    },
  });
  await processVirtualHistoryQueue(f.factory);
  const job = await db.avChannelHistorySync.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(job.state, "FAILED");
  assert.equal(job.attempts, 3);
  assert.equal(job.leaseOwner, null);
  assert.equal(f.reads(), 0);
});

test("resposta live concluída durante espera pelo lock mantém lastMessageAt mais recente", async () => {
  const f = await fixture();
  const conversation = await db.avConversation.create({
    data: {
      ...scopeOf(f),
      externalCustomerId: sender,
      displayName: "Cliente fictício Kairu",
      agentEnabled: false,
      lastMessageAt: new Date(Date.now() - 10 * 86400000),
    },
  });
  f.setReader(async () => page([historical()]));
  await f.start();
  let entered!: () => void, release!: () => void;
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const newest = new Date();
  const live = db.$transaction(
    async (tx) => {
      await lockVirtualConversation(tx, conversation.id);
      entered();
      await waiting;
      await tx.avConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: newest },
      });
    },
    { timeout: 10000 },
  );
  await held;
  const importing = processVirtualHistoryQueue(f.factory);
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.$queryRaw<
        { blocked: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock%') AS blocked`;
      if (rows[0]?.blocked) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, "Importação deve aguardar o lock da conversa.");
  } finally {
    release();
    await Promise.all([live, importing]);
  }
  assert.equal(
    (
      await db.avConversation.findUniqueOrThrow({
        where: { id: conversation.id },
      })
    ).lastMessageAt.getTime(),
    newest.getTime(),
  );
  assert.equal((await f.result()).importedMessages, 1);
});

test("conectar agenda histórico e atualização recente sem ativar conta; duas réplicas não duplicam jobs", async () => {
  const f = await fixture();
  const input = { accountId: f.account.id, actorId: f.actor.id };
  const scheduled = await Promise.all([
    scheduleAutomaticVirtualHistory(input),
    scheduleAutomaticVirtualHistory(input),
  ]);
  assert.equal(
    scheduled.reduce((sum, n) => sum + n, 0),
    2,
  );
  assert.equal(
    await db.avChannelHistoryRecentSync.count({ where: scopeOf(f) }),
    1,
  );
  assert.equal(await db.avChannelHistorySync.count({ where: scopeOf(f) }), 1);
  const message = historical({
    occurredAt: new Date(Date.now() - 1000).toISOString(),
  });
  f.setReader(async () => page([message]));
  await processVirtualHistoryQueue(f.factory);
  const status = await f.result();
  assert.equal(status.automatic.enabled, true);
  assert.equal(status.automatic.state, "COMPLETE");
  assert.ok(status.automatic.lastSyncedAt);
  assert.ok(status.automatic.nextSyncAt);
  assert.equal(await db.avMessage.count({ where: scopeOf(f) }), 1);
  const account = await db.avChannelAccount.findUniqueOrThrow({
    where: { id: f.account.id },
  });
  assert.equal(account.active, false);
  const conversation = await db.avConversation.findFirstOrThrow({
    where: scopeOf(f),
  });
  assert.equal(conversation.agentEnabled, false);
  assert.equal(conversation.pendingSince, null);
  assert.equal(await db.avAgentRun.count({ where: scopeOf(f) }), 0);
  assert.equal(await db.avMessageOutbox.count({ where: scopeOf(f) }), 0);
  assert.equal(await scheduleAutomaticVirtualHistory(input), 0);
});

test("atualização recente não espera backfill; etapa parcial continua automaticamente com corte congelado", async () => {
  const f = await fixture();
  const input = { accountId: f.account.id, actorId: f.actor.id };
  await scheduleAutomaticVirtualHistory(input);
  const before = await db.avChannelHistorySync.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  await db.avChannelHistorySync.update({
    where: { id: before.id },
    data: { pagesProcessed: 999 },
  });
  let recent = 0,
    old = 0;
  f.setReader(async (query) => {
    const isRecent =
      new Date((query as { since?: string }).since!).getFullYear() > 2000;
    if (isRecent) {
      recent++;
      return page([
        historical({ occurredAt: new Date(Date.now() - 1000).toISOString() }),
      ]);
    }
    old++;
    return query.page === 1
      ? page([historical()], 1, 2)
      : page([historical()], 2);
  });
  await processVirtualHistoryQueue(f.factory);
  assert.equal(recent, 1);
  assert.equal(old, 1);
  assert.equal((await f.result()).state, "PARTIAL");
  assert.equal((await f.result()).automatic.state, "COMPLETE");
  assert.equal(await scheduleAutomaticVirtualHistory(input), 1);
  const resumed = await db.avChannelHistorySync.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(resumed.nextPage, 2);
  assert.equal(resumed.until.getTime(), before.until.getTime());
  await db.avChannelHistoryRecentSync.update({
    where: { accountId: f.account.id },
    data: { finishedAt: new Date(Date.now() - 61_000) },
  });
  assert.equal(await scheduleAutomaticVirtualHistory(input), 1);
  assert.ok((await f.result()).automatic.lastSyncedAt);
  await processVirtualHistoryQueue(f.factory);
  assert.equal(recent, 2);
  assert.equal(old, 2);
  assert.equal((await f.result()).state, "COMPLETE");
});

test("automático usa somente gestor que configurou a conta e respeita revogação durante consulta", async () => {
  const f = await fixture();
  // No audit/prior history: an arbitrary active user is never selected.
  assert.equal(
    await db.avChannelHistoryRecentSync.count({ where: scopeOf(f) }),
    0,
  );
  await db.avAuditEvent.create({
    data: {
      organizationId: f.organization.id,
      storeId: f.unit.id,
      actorId: f.actor.id,
      action: "CHANNEL_SAVED",
      data: { accountId: f.account.id, provider: "EVOLUTION" },
    },
  });
  await scheduleAutomaticVirtualHistory({ accountId: f.account.id });
  const recent = await db.avChannelHistoryRecentSync.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(recent.requestedById, f.actor.id);
  f.setReader(async () => {
    await db.acesso.update({
      where: { id: f.access.id },
      data: { status: "SUSPENSO" },
    });
    return page([
      historical({ occurredAt: new Date(Date.now() - 1000).toISOString() }),
    ]);
  });
  await processVirtualHistoryQueue(f.factory);
  assert.equal(await db.avMessage.count({ where: scopeOf(f) }), 0);
  assert.equal((await f.result()).automatic.state, "FAILED");
  assert.equal(
    await scheduleAutomaticVirtualHistory({
      accountId: f.account.id,
      actorId: f.actor.id,
    }),
    0,
  );
});

test("automático não reinicia loops; falha transitória aguarda cooldown e revisão nova reinicia cursor", async () => {
  const f = await fixture();
  const input = { accountId: f.account.id, actorId: f.actor.id };
  await scheduleAutomaticVirtualHistory(input);
  await db.avChannelHistorySync.update({
    where: { accountId: f.account.id },
    data: {
      state: "FAILED",
      error:
        "O provedor repetiu a mesma página. A importação foi interrompida.",
      finishedAt: new Date(Date.now() - 24 * 3_600_000 - 1),
    },
  });
  await db.avChannelHistoryRecentSync.update({
    where: { accountId: f.account.id },
    data: {
      state: "FAILED",
      error:
        "Não foi possível consultar o histórico do provedor. Confira a conexão e tente novamente.",
      finishedAt: new Date(),
    },
  });
  assert.equal(await scheduleAutomaticVirtualHistory(input), 0);
  await db.avChannelHistoryRecentSync.update({
    where: { accountId: f.account.id },
    data: { finishedAt: new Date(Date.now() - 5 * 60_000 - 1) },
  });
  assert.equal(await scheduleAutomaticVirtualHistory(input), 1);
  await db.avChannelHistorySync.update({
    where: { accountId: f.account.id },
    data: { state: "PARTIAL", nextPage: 40 },
  });
  await db.avChannelConnection.update({
    where: { accountId: f.account.id },
    data: { revision: 2, verifiedRevision: 2, verifiedAt: new Date() },
  });
  assert.equal(await scheduleAutomaticVirtualHistory(input), 2);
  const full = await db.avChannelHistorySync.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(full.revision, 2);
  assert.equal(full.nextPage, 1);
});

test("pareamento concluído é detectado sem navegador; lease e revisão descartam verificação obsoleta", async () => {
  const f = await fixture();
  await db.avAuditEvent.create({
    data: {
      organizationId: f.organization.id,
      storeId: f.unit.id,
      actorId: f.actor.id,
      action: "CHANNEL_SAVED",
      data: { accountId: f.account.id, provider: "EVOLUTION" },
    },
  });
  await db.avChannelConnection.update({
    where: { accountId: f.account.id },
    data: {
      connectionState: "PENDING",
      verifiedAt: null,
      verifiedRevision: null,
      updatedAt: new Date(Date.now() - 31_000),
    },
  });
  let calls = 0;
  const factory: ChannelManagementFactory = async (accountId) => ({
    ...(await f.factory(accountId)),
    verify: async () => {
      calls++;
      return { connected: true };
    },
  });
  await Promise.all([
    refreshVirtualHistoryConnections(factory, f.account.id),
    refreshVirtualHistoryConnections(factory, f.account.id),
  ]);
  assert.equal(calls, 1);
  const verified = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(verified.connectionState, "VERIFIED");
  assert.equal(verified.verifiedRevision, 1);
  assert.equal(verified.connectLeaseOwner, null);
  assert.equal(
    (
      await db.avChannelAccount.findUniqueOrThrow({
        where: { id: f.account.id },
      })
    ).active,
    false,
  );
  await scheduleAutomaticVirtualHistory({ accountId: f.account.id });
  assert.equal((await f.result()).automatic.state, "RUNNING");
  await db.avChannelConnection.update({
    where: { accountId: f.account.id },
    data: {
      connectionState: "PENDING",
      verifiedAt: null,
      verifiedRevision: null,
      updatedAt: new Date(Date.now() - 31_000),
    },
  });
  const staleFactory: ChannelManagementFactory = async (accountId) => ({
    ...(await f.factory(accountId)),
    verify: async () => {
      await db.avChannelConnection.update({
        where: { accountId },
        data: {
          revision: 2,
          connectionState: "PENDING",
          verifiedAt: null,
          verifiedRevision: null,
          connectLeaseOwner: "new-manager",
          connectLeaseUntil: new Date(Date.now() + 60_000),
        },
      });
      return { connected: true };
    },
  });
  await refreshVirtualHistoryConnections(staleFactory, f.account.id);
  const stale = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: f.account.id },
  });
  assert.equal(stale.connectionState, "PENDING");
  assert.equal(stale.verifiedRevision, null);
  assert.equal(stale.connectLeaseOwner, "new-manager");
});
