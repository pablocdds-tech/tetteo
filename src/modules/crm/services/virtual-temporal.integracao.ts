import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, afterEach } from "node:test";
import { db } from "@/server/db";
import { processVirtualQueue, receiveVirtualInbound } from "./virtual-runtime";
import { runVirtualAgent } from "./virtual-agent";
import { dateInZone } from "./virtual-domain";
import type { VirtualTurnInput, VirtualTurnResult } from "../virtual-types";
import { newPendingReservation } from "./virtual-tools";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !database.pathname.includes("_test")
)
  throw new Error("O teste temporal exige PostgreSQL local exclusivo _test.");
const created: string[] = [];
afterEach(async () => {
  await db.avChannelAccount.updateMany({
    where: { id: { in: created } },
    data: { active: false },
  });
});
after(async () => {
  await db.$disconnect();
});
async function fixture(mode = "DEMO") {
  const organization = await db.organizacao.create({
    data: { nome: "Temporal fictício Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Unidade fictícia",
      codigo: "TEMPO",
    },
  });
  const account = await db.avChannelAccount.create({
    data: {
      organizationId: organization.id,
      storeId: unit.id,
      mode,
      name: "Canal temporal fictício",
      active: mode === "DEMO",
      debounceMs: 0,
      maxWaitMs: 1000,
    },
  });
  created.push(account.id);
  return { account, organization, unit };
}
function sourceTimes() {
  const today = dateInZone(new Date(), "America/Sao_Paulo");
  let midnight = new Date(`${today}T00:00:00-03:00`);
  if (Date.now() - (midnight.getTime() - 60_000) > 24 * 3600_000)
    midnight = new Date(midnight.getTime() + 24 * 3600_000);
  return {
    before: new Date(midnight.getTime() - 60_000),
    after: new Date(midnight.getTime() + 60_000),
    expected: dateInZone(midnight, "America/Sao_Paulo"),
  };
}
async function runQueued(reverse = false) {
  const f = await fixture(),
    times = sourceTimes();
  const messages = [
    { text: "Quero reservar amanhã", occurredAt: times.before.toISOString() },
    { text: "às 19h", occurredAt: times.after.toISOString() },
  ];
  let conversationId: string | null = null;
  for (const message of reverse ? [...messages].reverse() : messages)
    conversationId = (
      await receiveVirtualInbound(f.account.id, {
        externalId: randomUUID(),
        senderKey: "demo:temporal",
        type: "MESSAGE",
        ...message,
      })
    ).conversationId;
  assert.ok(conversationId);
  await db.avConversation.update({
    where: { id: conversationId },
    data: { processAfter: new Date(Date.now() - 1000) },
  });
  let input: VirtualTurnInput | undefined,
    result: VirtualTurnResult | undefined;
  await processVirtualQueue(async (turn) => {
    if (turn.conversationId === conversationId) {
      input = turn;
      result = await runVirtualAgent(turn);
      return result;
    }
    return { text: "Teste fictício", tokens: 0, costMicros: 0 };
  }, 20);
  assert.ok(input);
  assert.ok(result);
  assert.deepEqual(
    input.messages.map((m) => m.text),
    messages.map((m) => m.text),
  );
  assert.equal(
    (result.state as { draft: { date: string } }).draft.date,
    times.expected,
  );
  assert.match(result.text, /quantas pessoas/);
  assert.equal(await db.avReservation.count({ where: { conversationId } }), 0);
  return f;
}
test("amanhã dito23:59 preserva a data quando a fila agrupa complemento00:01", async () => {
  await runQueued();
});
test("eventos recebidos fora de ordem mantêm texto e data de origem no turno", async () => {
  await runQueued(true);
});
test("mensagem histórica maior24h fica durável como STALE_EVENT sem resposta ou reserva", async () => {
  const f = await fixture(),
    externalId = randomUUID();
  const result = await receiveVirtualInbound(f.account.id, {
    externalId,
    senderKey: "demo:historico",
    type: "MESSAGE",
    text: "Quero reservar amanhã",
    occurredAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
  });
  assert.equal(result.conversationId, null);
  const event = await db.avInboundEvent.findUniqueOrThrow({
    where: { accountId_externalId: { accountId: f.account.id, externalId } },
  });
  assert.equal(event.status, "IGNORED");
  assert.equal(event.error, "STALE_EVENT");
  assert.equal(
    await db.avConversation.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    await db.avAgentRun.count({ where: { accountId: f.account.id } }),
    0,
  );
});
test("canal real sem horário de origem fica durável como MISSING_EVENT_TIME sem efeito automático", async () => {
  const f = await fixture("META"),
    externalId = randomUUID();
  const result = await receiveVirtualInbound(
    f.account.id,
    {
      externalId,
      senderKey: "+12025550123",
      type: "MESSAGE",
      text: "Confirmo a reserva",
    },
    { provider: "META" },
  );
  assert.equal(result.conversationId, null);
  const event = await db.avInboundEvent.findUniqueOrThrow({
    where: { accountId_externalId: { accountId: f.account.id, externalId } },
  });
  assert.equal(event.status, "IGNORED");
  assert.equal(event.error, "MISSING_EVENT_TIME");
  assert.equal(
    await db.avChannelWindow.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    await db.avAgentRun.count({ where: { accountId: f.account.id } }),
    0,
  );
  assert.equal(
    await db.avReservation.count({ where: { accountId: f.account.id } }),
    0,
  );
});
test("confirmação atrasada não aprova um objeto de reserva criado depois da fala", async () => {
  const f = await fixture();
  const inbound = await receiveVirtualInbound(f.account.id, {
    externalId: randomUUID(),
    senderKey: "demo:confirmacao",
    type: "MESSAGE",
    text: "confirmo",
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.ok(inbound.conversationId);
  const pending = newPendingReservation({
    type: "create",
    date: dateInZone(new Date(Date.now() + 24 * 3600_000), "America/Sao_Paulo"),
    time: "20:00",
    partySize: 2,
    guestName: "Pessoa fictícia",
  });
  await db.avConversation.update({
    where: { id: inbound.conversationId },
    data: { state: { pending }, processAfter: new Date(Date.now() - 1000) },
  });
  let result: VirtualTurnResult | undefined;
  await processVirtualQueue(async (input) => {
    const response = await runVirtualAgent(input);
    if (input.conversationId === inbound.conversationId) result = response;
    return response;
  }, 20);
  assert.ok(result);
  assert.match(result.text, /fora de ordem/);
  assert.equal(
    await db.avReservation.count({
      where: { conversationId: inbound.conversationId },
    }),
    0,
  );
  const next = await db.avConversation.findUniqueOrThrow({
    where: { id: inbound.conversationId },
  });
  assert.notEqual(
    (next.state as { pending: { token: string } }).pending.token,
    pending.token,
  );
  const attempt = await db.avToolExecution.findFirstOrThrow({
    where: { conversationId: inbound.conversationId, name: "criar_reserva" },
  });
  assert.equal(attempt.success, false);
  assert.equal(attempt.state, "CONFIRMATION_OUTDATED");
});
