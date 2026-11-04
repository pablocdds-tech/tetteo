import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEvolutionWebhook,
  normalizeMetaWebhook,
} from "./atendimento-webhook-normalizar";

const evolution = { url: "https://provider.invalid", instance: "sv-ficticia" };
const epoch = 1793754000;
const event = (extra: Record<string, unknown> = {}) => ({
  event: "messages.upsert",
  instance: evolution.instance,
  data: {
    key: {
      id: "message-ficticia",
      fromMe: false,
      remoteJid: "12025550123@s.whatsapp.net",
    },
    message: { conversation: "Olá, exemplo Kairu" },
    messageTimestamp: epoch,
    pushName: "Ana do perfil",
    ...extra,
  },
});
const meta = {
  phoneNumberId: "1234567890",
  businessAccountId: "9876543210",
  apiVersion: "v26.0",
};
const metaEvent = (contacts: unknown) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: meta.businessAccountId,
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: meta.phoneNumberId },
            contacts,
            messages: [
              {
                id: "wamid.ficticia",
                from: "12025550123",
                timestamp: String(epoch),
                type: "text",
                text: { body: "Olá" },
              },
            ],
          },
        },
      ],
    },
  ],
});

test("Evolution transporta pushName de perfil e horário de origem sem usar texto como nome", () => {
  const result = normalizeEvolutionWebhook(event(), evolution).messages[0];
  assert.equal(result.profileName, "Ana do perfil");
  assert.equal(result.profileObservedAt, new Date(epoch * 1000).toISOString());
  assert.equal(result.profileObservedAt, result.occurredAt);
  assert.equal(result.senderKey, "+12025550123");
  const missingTime = normalizeEvolutionWebhook(
    event({ messageTimestamp: undefined }),
    evolution,
  ).messages[0];
  assert.equal(missingTime.profileName, "Ana do perfil");
  assert.equal(missingTime.profileObservedAt, undefined);
  const typed = normalizeEvolutionWebhook(
    event({
      pushName: undefined,
      message: { conversation: "Meu nome é outro; telefone +12025550124" },
    }),
    evolution,
  ).messages[0];
  assert.equal(typed.profileName, undefined);
});

test("nomes de mensagens próprias, grupos ou LID não resolvido não viram perfil do cliente", () => {
  for (const key of [
    { id: "self", fromMe: true, remoteJid: "12025550123@s.whatsapp.net" },
    { id: "group", fromMe: false, remoteJid: "12025550123@g.us" },
    { id: "lid", fromMe: false, remoteJid: "12025550123@lid" },
  ]) {
    const message = normalizeEvolutionWebhook(event({ key }), evolution)
      .messages[0];
    assert.equal(message.profileName, undefined);
    assert.equal(message.profileObservedAt, undefined);
  }
  const lid = normalizeEvolutionWebhook(
    event({
      key: {
        id: "lid",
        fromMe: false,
        remoteJid: "98765@lid",
        remoteJidAlt: "12025550123@s.whatsapp.net",
      },
    }),
    evolution,
  ).messages[0];
  assert.equal(lid.profileName, "Ana do perfil");
  assert.equal(lid.trustedPhone, "+12025550123");
});

test("Meta vincula perfil apenas ao wa_id exato da própria mensagem e ignora dados não necessários", () => {
  const result = normalizeMetaWebhook(
    metaEvent([
      { wa_id: "12025550124", profile: { name: "Outra pessoa" } },
      {
        wa_id: "12025550123",
        profile: { name: "Ana Meta" },
        token: "private-token",
        notes: "private-note",
      },
    ]),
    meta,
  ).messages[0];
  assert.equal(result.profileName, "Ana Meta");
  assert.equal(result.profileObservedAt, result.occurredAt);
  assert.doesNotMatch(
    JSON.stringify(result),
    /Outra pessoa|private-token|private-note/,
  );
  const unrelated = normalizeMetaWebhook(
    metaEvent([{ wa_id: "12025550124", profile: { name: "Outra pessoa" } }]),
    meta,
  ).messages[0];
  assert.equal(unrelated.profileName, undefined);
  const ambiguous = normalizeMetaWebhook(
    metaEvent([
      { wa_id: "12025550123", profile: { name: "Ana" } },
      { wa_id: "12025550123", profile: { name: "Bia" } },
    ]),
    meta,
  ).messages[0];
  assert.equal(ambiguous.profileName, undefined);
});

test("nome opcional inválido não derruba mensagem legítima nem é substituído por dados de outro contato", () => {
  for (const value of [" ", "x".repeat(161), "Ana\ncontrole", 123, null]) {
    const message = normalizeEvolutionWebhook(
      event({ pushName: value }),
      evolution,
    ).messages[0];
    assert.equal(message.profileName, undefined);
    assert.match(message.text, /Olá/);
    const item = normalizeMetaWebhook(
      metaEvent([{ wa_id: "12025550123", profile: { name: value } }]),
      meta,
    ).messages[0];
    assert.equal(item.profileName, undefined);
    assert.equal(item.text, "Olá");
  }
});
