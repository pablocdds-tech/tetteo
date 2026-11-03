import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEvolutionWebhook } from "./atendimento-webhook-normalizar";

test("Evolution aceita PN alternativo do transporte somente em conversa direta LID", () => {
  const settings = {
    url: "http://evolution.invalid",
    instance: "fixture-kairu",
  };
  const base = {
    event: "messages.upsert",
    instance: settings.instance,
    data: {
      key: {
        id: "fixture-lid",
        fromMe: false,
        remoteJid: "987654321098765@lid",
        remoteJidAlt: "12025550123@s.whatsapp.net",
      },
      message: { conversation: "Olá" },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
  const known = normalizeEvolutionWebhook(base, settings).messages[0];
  assert.equal(known.senderKey, "+12025550123");
  assert.equal(known.trustedPhone, "+12025550123");
  for (const alternate of [
    "12025550123@lid",
    "12025550123@g.us",
    "+12025550123",
    "not-a-phone@s.whatsapp.net",
  ]) {
    const unresolved = normalizeEvolutionWebhook(
      {
        ...base,
        data: {
          ...base.data,
          key: { ...base.data.key, remoteJidAlt: alternate },
        },
      },
      settings,
    ).messages[0];
    assert.equal(unresolved.trustedPhone, undefined);
  }
  const group = normalizeEvolutionWebhook(
    {
      ...base,
      data: {
        ...base.data,
        key: { ...base.data.key, remoteJid: "987654321@g.us" },
      },
    },
    settings,
  ).messages[0];
  assert.equal(group.group, true);
  assert.equal(group.trustedPhone, undefined);
});
