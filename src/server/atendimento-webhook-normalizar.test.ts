import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  normalizeEvolutionWebhook,
  normalizeMetaWebhook,
  readChannelWebhookBody,
} from "./atendimento-webhook-normalizar";

const meta = {
  phoneNumberId: "1234567890",
  businessAccountId: "9876543210",
  apiVersion: "v26.0",
};
const evo = { url: "http://evolution_api:8080", instance: "fixture-isolated" };
const metaEvent = (value: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: meta.businessAccountId,
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: meta.phoneNumberId },
            ...value,
          },
        },
      ],
    },
  ],
});
test("Meta confere WABA e número antes de normalizar mensagens ou status", () => {
  const raw = metaEvent({
    messages: [
      {
        id: "wamid.fixture",
        from: "12025550123",
        timestamp: "1793650000",
        type: "text",
        text: { body: "Olá, exemplo Kairu" },
      },
    ],
  });
  const result = normalizeMetaWebhook(raw, meta);
  assert.equal(result.matched, true);
  assert.equal(result.messages[0].senderKey, "+12025550123");
  assert.equal(result.messages[0].trustedPhone, "+12025550123");
  assert.equal(result.messages[0].text, "Olá, exemplo Kairu");
  assert.equal(result.deliveries.length, 0);
  assert.throws(
    () => normalizeMetaWebhook(raw, { ...meta, businessAccountId: "foreign" }),
    /Conta do provedor/,
  );
  assert.throws(
    () => normalizeMetaWebhook(raw, { ...meta, phoneNumberId: "foreign" }),
    /Número do provedor/,
  );
  assert.equal(
    normalizeMetaWebhook(
      raw,
      { ...meta, phoneNumberId: "foreign" },
      { allowUnrelated: true },
    ).matched,
    false,
  );
});
test("Meta distingue sent de delivered/read sem converter callback em fala e descarta correlação inválida", () => {
  const id = randomUUID();
  const result = normalizeMetaWebhook(
    metaEvent({
      statuses: ["sent", "delivered", "read", "failed"].map((status) => ({
        id: "wamid.fixture",
        recipient_id: "12025550123",
        status,
        biz_opaque_callback_data: `test:${id}`,
      })),
    }),
    meta,
  );
  assert.equal(result.messages.length, 0);
  assert.deepEqual(
    result.deliveries.map((d) => d.state),
    ["ACCEPTED", "DELIVERED", "READ", "FAILED"],
  );
  assert.ok(result.deliveries.every((d) => d.correlationId === `test:${id}`));
  const invalid = normalizeMetaWebhook(
    metaEvent({
      statuses: [
        {
          id: "wamid.fixture",
          recipient_id: "12025550123",
          status: "delivered",
          biz_opaque_callback_data: "ignore-permissions",
        },
      ],
    }),
    meta,
  );
  assert.equal(invalid.deliveries[0].correlationId, undefined);
});
test("Evolution mantém instância, grupo/fromMe e LID sem atribuir telefone incorreto", () => {
  const raw = {
    event: "messages.upsert",
    instance: evo.instance,
    data: {
      key: {
        id: "fixture-message",
        fromMe: false,
        remoteJid: "12025550123@s.whatsapp.net",
      },
      message: { conversation: "Olá" },
      messageTimestamp: 1793650000,
    },
  };
  assert.equal(
    normalizeEvolutionWebhook(raw, evo).messages[0].senderKey,
    "+12025550123",
  );
  assert.throws(
    () =>
      normalizeEvolutionWebhook(raw, { ...evo, instance: "staff-instance" }),
    /Instância do provedor/,
  );
  const lid = normalizeEvolutionWebhook(
    {
      ...raw,
      data: {
        ...raw.data,
        key: { ...raw.data.key, remoteJid: "123456789012345@lid" },
      },
    },
    evo,
  ).messages[0];
  assert.equal(lid.trustedPhone, undefined);
  assert.equal(lid.senderKey, "unresolved:evolution");
  const group = normalizeEvolutionWebhook(
    {
      ...raw,
      data: {
        ...raw.data,
        key: { ...raw.data.key, remoteJid: "123456@g.us", fromMe: true },
      },
    },
    evo,
  ).messages[0];
  assert.equal(group.group, true);
  assert.equal(group.fromSelf, true);
});
test("mídia recebida permanece referência sem download e áudio nunca vira confirmação confiável", () => {
  const audio = normalizeMetaWebhook(
    metaEvent({
      messages: [
        {
          id: "wamid.audio",
          from: "12025550123",
          type: "audio",
          audio: { id: "media-fixture", url: "http://169.254.169.254/private" },
        },
      ],
    }),
    meta,
  ).messages[0];
  assert.equal(audio.kind, "AUDIO");
  assert.equal(audio.transcriptionCertain, false);
  assert.doesNotMatch(JSON.stringify(audio), /169\.254|media-fixture/);
  const image = normalizeEvolutionWebhook(
    {
      event: "messages.upsert",
      instance: evo.instance,
      data: {
        key: {
          id: "fixture-image",
          fromMe: false,
          remoteJid: "12025550123@s.whatsapp.net",
        },
        message: { imageMessage: { url: "https://untrusted.invalid/image" } },
      },
    },
    evo,
  ).messages[0];
  assert.equal(image.kind, "IMAGE");
  assert.equal(image.transcriptionCertain, false);
  assert.doesNotMatch(JSON.stringify(image), /untrusted/);
});
test("Evolution ACK do servidor não comprova entrega e recibo de mensagem recebida é ignorado", () => {
  const event = {
    event: "messages.update",
    instance: evo.instance,
    data: {
      keyId: "fixture-outgoing",
      remoteJid: "12025550123@s.whatsapp.net",
      fromMe: true,
      status: "SERVER_ACK",
    },
  };
  assert.equal(
    normalizeEvolutionWebhook(event, evo).deliveries[0].state,
    "ACCEPTED",
  );
  assert.equal(
    normalizeEvolutionWebhook(
      { ...event, data: { ...event.data, status: "DELIVERY_ACK" } },
      evo,
    ).deliveries[0].state,
    "DELIVERED",
  );
  assert.equal(
    normalizeEvolutionWebhook(
      { ...event, data: { ...event.data, fromMe: false } },
      evo,
    ).deliveries.length,
    0,
  );
  assert.equal(
    normalizeEvolutionWebhook(
      { ...event, data: { ...event.data, fromMe: undefined } },
      evo,
    ).deliveries.length,
    0,
  );
});
test("leitor de webhook conta bytes reais e preserva corpo exato para autenticação", async () => {
  const body = '{ "ficticio": "Kairu" }\n';
  assert.equal(
    await readChannelWebhookBody(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    ),
    body,
  );
  await assert.rejects(
    readChannelWebhookBody(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body,
      }),
    ),
    /JSON/,
  );
  await assert.rejects(
    readChannelWebhookBody(
      new Request("https://fixture.invalid", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "1" },
        body: "á".repeat(20),
      }),
      25,
    ),
    /limite/,
  );
});
