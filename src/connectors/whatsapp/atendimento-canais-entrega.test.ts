import assert from "node:assert/strict";
import test from "node:test";
import type { LiveChannelConfig } from "@/server/atendimento-provedor";
import { evolutionAttendance } from "./atendimento-evolution";
import { metaAttendance } from "./atendimento-meta";

const config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }> = {
  organizationId: "org-ficticia",
  storeId: "unidade-ficticia",
  accountId: "conta-ficticia",
  name: "Canal fictício Kairu",
  revision: 3,
  active: false,
  provider: "EVOLUTION",
  settings: { url: "https://provider.invalid", instance: "ficticia" },
  secrets: { apiKey: "private-fake-key" },
};
const recipient = "+12025550123";
const correlationId = "test:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sentAt = new Date("2026-11-04T11:31:08.000Z");
const providerId = "ficticio-provider-id";
const context = { recipient, sentAt, providerId };
const row = (updates: unknown = []) => ({
  key: {
    fromMe: true,
    remoteJid: `${recipient.slice(1)}@s.whatsapp.net`,
    id: providerId,
  },
  messageTimestamp: Math.floor(sentAt.getTime() / 1000),
  message: {
    conversation: `Teste fictício Kairu\n\nProtocolo: SV-${correlationId}`,
  },
  MessageUpdate: updates,
});
const response = (records: unknown[]) =>
  Response.json({ messages: { records } });

test("consulta Evolution prova entrega por todos os updates do outgoing correlacionado, inclusive LID aninhado", async (t) => {
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      assert.equal(
        String(url),
        "https://provider.invalid/chat/findMessages/ficticia",
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(
        (init?.headers as Record<string, string>).apikey,
        "private-fake-key",
      );
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.where.key, {
        fromMe: true,
        remoteJid: `${recipient.slice(1)}@s.whatsapp.net`,
        id: providerId,
      });
      assert.equal(body.where.messageTimestamp.gte, "2026-11-04T11:30:08.000Z");
      assert.equal(body.where.messageTimestamp.lte, "2026-11-04T11:41:08.000Z");
      return response([
        row([
          { status: "DELIVERY_ACK", remoteJid: "999999@lid" },
          { status: "DELIVERY_ACK" },
          { status: "SERVER_ACK" },
          { status: "SERVER_ACK" },
        ]),
      ]);
    },
  );
  const adapter = evolutionAttendance(config, async () => context);
  const proof = await adapter.consultDelivery!(correlationId);
  assert.equal(proof?.state, "DELIVERED");
  assert.equal(proof?.providerId, providerId);
  assert.equal(proof?.recipient, recipient);
  assert.equal(proof?.correlationId, correlationId);
  assert.match(proof!.externalId, /^query:[a-f0-9]{64}$/);
  const repeated = await adapter.consultDelivery!(correlationId);
  assert.deepEqual(repeated, proof);
  assert.equal(calls, 2);
  assert.doesNotMatch(
    JSON.stringify(proof),
    /private-fake-key|Teste fictício Kairu|999999@lid/,
  );
});

test("recibos consultados são monotônicos na ordem desordenada e status desconhecido não prova entrega", async (t) => {
  const cases = [
    { updates: ["READ", "ERROR", "SERVER_ACK", "DELIVERY_ACK"], state: "READ" },
    { updates: ["PLAYED", "SERVER_ACK"], state: "READ" },
    { updates: ["ERROR", "SERVER_ACK"], state: "FAILED" },
    { updates: ["PENDING", "SERVER_ACK"], state: "ACCEPTED" },
    { updates: ["DELIVERED", "unknown", 3, true], state: "ACCEPTED" },
    { updates: [], state: "ACCEPTED" },
  ];
  let updates: unknown[] = [];
  t.mock.method(globalThis, "fetch", async () =>
    response([
      { ...row(updates.map((status) => ({ status }))), status: "READ" },
    ]),
  );
  const adapter = evolutionAttendance(config, async () => context);
  for (const item of cases) {
    updates = item.updates;
    assert.equal(
      (await adapter.consultDelivery!(correlationId))?.state,
      item.state,
    );
  }
});

test("recibo exige ID, PN, fromMe, tempo e protocolo; duplicatas não viram prova", async (t) => {
  let records: unknown[] = [];
  t.mock.method(globalThis, "fetch", async () => response(records));
  const adapter = evolutionAttendance(config, async () => context);
  const valid = row([{ status: "DELIVERY_ACK" }]);
  const cases = [
    { ...valid, key: { ...valid.key, fromMe: false } },
    { ...valid, key: { ...valid.key, fromMe: "true" } },
    {
      ...valid,
      key: {
        ...valid.key,
        remoteJid: "999999@lid",
        remoteJidAlt: valid.key.remoteJid,
      },
    },
    {
      ...valid,
      key: { ...valid.key, remoteJid: "12025550124@s.whatsapp.net" },
    },
    { ...valid, key: { ...valid.key, id: "outro-id" } },
    { ...valid, messageTimestamp: Math.floor(sentAt.getTime() / 1000) - 61 },
    { ...valid, messageTimestamp: Math.floor(sentAt.getTime() / 1000) + 601 },
    { ...valid, message: { conversation: "Protocolo: SV-outro" } },
  ];
  for (const invalid of cases) {
    records = [invalid];
    assert.equal(await adapter.consultDelivery!(correlationId), null);
  }
  records = [valid, valid];
  assert.equal(await adapter.consultDelivery!(correlationId), null);
  const withoutId = evolutionAttendance(config, async () => ({
    recipient,
    sentAt,
  }));
  records = [valid, { ...valid, key: { ...valid.key, id: "segundo-id" } }];
  assert.equal(await withoutId.consultDelivery!(correlationId), null);
});

test("status de envio e recibo concorrentes compartilham uma consulta sem mudar ChannelSendResult", async (t) => {
  let calls = 0,
    lookups = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return response([row([{ status: "READ" }])]);
  });
  const adapter = evolutionAttendance(config, async () => {
    lookups++;
    return context;
  });
  const [status, delivery] = await Promise.all([
    adapter.consultStatus(correlationId),
    adapter.consultDelivery!(correlationId),
  ]);
  assert.deepEqual(status, { state: "ACCEPTED", providerId });
  assert.equal(delivery?.state, "READ");
  assert.equal(calls, 1);
  assert.equal(lookups, 1);
});

test("contexto ausente ou timeout não consulta outro destinatário, revela segredo nem reenvia", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls++;
    assert.match(String(url), /\/chat\/findMessages\/ficticia$/);
    throw new Error("private-fake-key corpo-privado");
  });
  assert.equal(
    await evolutionAttendance(config).consultDelivery!(correlationId),
    null,
  );
  assert.equal(calls, 0);
  const adapter = evolutionAttendance(config, async () => context);
  const [status, delivery] = await Promise.all([
    adapter.consultStatus(correlationId),
    adapter.consultDelivery!(correlationId),
  ]);
  assert.deepEqual(status, { state: "UNCERTAIN", error: "STATUS_UNAVAILABLE" });
  assert.equal(delivery, null);
  assert.equal(calls, 1);
});

test("ID aceito no envio é preservado no contexto recente para consultar o mesmo objeto", async (t) => {
  let sends = 0,
    queries = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/message/sendText/")) {
        sends++;
        return Response.json({ key: { id: providerId } });
      }
      queries++;
      assert.match(String(url), /\/chat\/findMessages\/ficticia$/);
      assert.equal(JSON.parse(String(init?.body)).where.key.id, providerId);
      return response([
        {
          ...row([{ status: "DELIVERY_ACK" }]),
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
    },
  );
  const adapter = evolutionAttendance(config);
  assert.deepEqual(
    await adapter.sendText({
      recipient,
      correlationId,
      text: "Teste fictício Kairu",
    }),
    { state: "ACCEPTED", providerId },
  );
  assert.equal(
    (await adapter.consultDelivery!(correlationId))?.state,
    "DELIVERED",
  );
  assert.equal(sends, 1);
  assert.equal(queries, 1);
});

test("Meta não ganha consulta de entrega sem API oficial correspondente", () => {
  const adapter = metaAttendance({
    ...config,
    provider: "META",
    settings: {
      phoneNumberId: "123456",
      businessAccountId: "654321",
      apiVersion: "v26.0",
    },
    secrets: { accessToken: "fake" },
  });
  assert.equal(adapter.consultDelivery, undefined);
});
