import test from "node:test";
import assert from "node:assert/strict";
import { metaAttendance } from "./atendimento-meta";
import { evolutionAttendance } from "./atendimento-evolution";
import type { LiveChannelConfig } from "@/server/atendimento-provedor";
const base = {
  organizationId: "org",
  storeId: "store",
  accountId: "account",
  name: "Teste fictício",
  revision: 2,
  active: false,
  secrets: {
    accessToken: "private-fake-token",
    apiKey: "private-fake-key",
    webhookSecret: "private-fake-webhook",
  },
};
const meta: Extract<LiveChannelConfig, { provider: "META" }> = {
  ...base,
  provider: "META",
  settings: {
    phoneNumberId: "123456",
    businessAccountId: "765432",
    apiVersion: "v26.0",
  },
};
const evolution: Extract<LiveChannelConfig, { provider: "EVOLUTION" }> = {
  ...base,
  provider: "EVOLUTION",
  settings: { url: "https://provider.invalid", instance: "ficticia" },
};
const recipient = "+5511999990000",
  correlationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("Meta usa endpoint oficial, Bearer privado e correlação opaca; sucesso não prova entrega", async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(
        String(url),
        "https://graph.facebook.com/v26.0/123456/messages",
      );
      assert.equal(init?.redirect, "error");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer private-fake-token",
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.to, recipient.slice(1));
      assert.equal(body.biz_opaque_callback_data, correlationId);
      assert.equal(body.text.body, "Mensagem fictícia");
      return Response.json({ messages: [{ id: "wamid.ficticio" }] });
    };
    const result = await metaAttendance(meta).sendText({
      recipient,
      correlationId,
      text: "Mensagem fictícia",
    });
    assert.deepEqual(result, {
      state: "ACCEPTED",
      providerId: "wamid.ficticio",
    });
  } finally {
    globalThis.fetch = saved;
  }
});
test("timeout/5xx Meta não repete envio e 4xx fica explícito", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new Error("secret should never escape");
    };
    assert.deepEqual(
      await metaAttendance(meta).sendText({
        recipient,
        correlationId,
        text: "Teste",
      }),
      { state: "UNCERTAIN", error: "META_SEND_UNCERTAIN" },
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      new Response("sensitive provider body", { status: 403 });
    assert.deepEqual(
      await metaAttendance(meta).sendText({
        recipient,
        correlationId,
        text: "Teste",
      }),
      { state: "FAILED", error: "PROVIDER_HTTP_403" },
    );
  } finally {
    globalThis.fetch = saved;
  }
});
test("Evolution protege webhook existente e usa marcador correlacionado visível", async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      if (String(url).includes("webhook/find"))
        return Response.json({
          enabled: true,
          url: "https://other.invalid/hook",
        });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.text, `Teste\n\nProtocolo: SV-${correlationId}`);
      assert.equal(body.number, recipient.slice(1));
      return Response.json({ key: { id: "evo-ficticio" } });
    };
    const adapter = evolutionAttendance(evolution);
    await assert.rejects(
      adapter.webhook("https://app.invalid/callback", false),
      /EXISTING_WEBHOOK_CONFIRMATION_REQUIRED/,
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      await adapter.sendText({ recipient, correlationId, text: "Teste" }),
      { state: "ACCEPTED", providerId: "evo-ficticio" },
    );
  } finally {
    globalThis.fetch = saved;
  }
});
test("reconciliação Evolution exige destinatário, data e marcador exatos sem reenviar", async () => {
  const saved = globalThis.fetch,
    sentAt = new Date("2026-11-02T12:00:00Z");
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.match(String(url), /chat\/findMessages/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.where.messageTimestamp.gte, "2026-11-02T11:59:00.000Z");
      return Response.json({
        messages: {
          records: [
            {
              key: {
                fromMe: true,
                remoteJid: `${recipient.slice(1)}@s.whatsapp.net`,
                id: "matching",
              },
              messageTimestamp: Math.floor(sentAt.getTime() / 1000),
              message: {
                conversation: `Teste\n\nProtocolo: SV-${correlationId}`,
              },
            },
          ],
        },
      });
    };
    const adapter = evolutionAttendance(evolution, async () => ({
      recipient,
      sentAt,
    }));
    assert.deepEqual(await adapter.consultStatus(correlationId), {
      state: "ACCEPTED",
      providerId: "matching",
    });
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      Response.json({
        messages: {
          records: [
            {
              key: {
                fromMe: true,
                remoteJid: "11111111@s.whatsapp.net",
                id: "wrong",
              },
              messageTimestamp: Math.floor(sentAt.getTime() / 1000),
              message: {
                conversation: `Teste\n\nProtocolo: SV-${correlationId}`,
              },
            },
          ],
        },
      });
    assert.equal(
      (await adapter.consultStatus(correlationId)).state,
      "UNCERTAIN",
    );
  } finally {
    globalThis.fetch = saved;
  }
});
test("canal real recusa destinatário demo e mídia sem tocar rede", async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("network must not run");
    };
    for (const adapter of [
      metaAttendance(meta),
      evolutionAttendance(evolution),
    ]) {
      assert.equal(
        (
          await adapter.sendText({
            recipient: "demo:ana",
            text: "Teste",
            correlationId,
          })
        ).state,
        "FAILED",
      );
      assert.equal(
        (await adapter.sendMedia({ recipient, mediaId: "fake", correlationId }))
          .state,
        "FAILED",
      );
    }
  } finally {
    globalThis.fetch = saved;
  }
});
