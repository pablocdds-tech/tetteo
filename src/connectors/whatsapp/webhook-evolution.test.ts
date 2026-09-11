import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { interpretarWebhook } from "./webhook-evolution";

/**
 * O QUE A EVOLUTION 2.3.7 MANDA, e o que o Tetteo aceita.
 *
 * Os corpos abaixo seguem o formato que a 2.3.7 monta (webhook.controller.ts
 * e whatsapp.baileys.service.ts, etiqueta 2.3.7): envelope com event,
 * instance, data, destination, date_time, sender, server_url, apikey. Todos
 * os números e ids são FICTÍCIOS.
 */

function envelope(
  event: string,
  data: unknown,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    event,
    instance: "loja-ensaio",
    data,
    destination: "http://tetteo:3000/api/whatsapp/webhook",
    date_time: "2026-09-10T20:00:00.000Z",
    sender: "5511900000001@s.whatsapp.net",
    server_url: "http://evolution_api:8080",
    apikey: null,
    ...extra,
  });
}

test("connection.update: estado, código e o número do próprio aparelho", () => {
  const r = interpretarWebhook(
    envelope("connection.update", {
      instance: "loja-ensaio",
      wuid: "5511900000001@s.whatsapp.net",
      profileName: "Loja Ensaio",
      state: "open",
      statusReason: 200,
    }),
  );
  assert.ok(r.ok);
  assert.equal(r.evento.tipo, "connection.update");
  if (r.evento.tipo !== "connection.update") return;
  assert.equal(r.evento.instancia, "loja-ensaio");
  assert.equal(r.evento.estado, "open");
  assert.equal(r.evento.codigo, 200);
  assert.equal(r.evento.numero, "5511900000001");
  assert.ok(r.evento.idExterno.startsWith("conexao:"));
});

/** A Evolution reenvia o MESMO corpo quando não tem certeza de que chegou. */
test("connection.update repetido tem o mesmo idExterno; outro estado, outro id", () => {
  const corpo = envelope("connection.update", {
    state: "close",
    statusReason: 401,
  });
  const a = interpretarWebhook(corpo);
  const b = interpretarWebhook(corpo);
  const c = interpretarWebhook(
    envelope("connection.update", { state: "connecting" }),
  );
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.evento.idExterno, b.evento.idExterno);
  assert.notEqual(a.evento.idExterno, c.evento.idExterno);
});

test("messages.update: id da mensagem e status, sem guardar o remoteJid", () => {
  const r = interpretarWebhook(
    envelope("messages.update", {
      keyId: "3EB0FICTICIO0001",
      remoteJid: "5511900000012@s.whatsapp.net",
      fromMe: true,
      participant: null,
      status: "DELIVERY_ACK",
      instanceId: "id-ficticio",
    }),
  );
  assert.ok(r.ok);
  assert.deepEqual(r.evento, {
    tipo: "messages.update",
    instancia: "loja-ensaio",
    idExterno: "status:3EB0FICTICIO0001:DELIVERY_ACK",
    idMensagem: "3EB0FICTICIO0001",
    status: "DELIVERY_ACK",
    deMim: true,
  });
});

test("send.message: id e o hash do texto — nunca o texto", () => {
  const texto = "*Fechamento pronto para revisão*\nRef. AV-ENSAIO";
  const r = interpretarWebhook(
    envelope("send.message", {
      key: {
        remoteJid: "5511900000012@s.whatsapp.net",
        fromMe: true,
        id: "3EB0FICTICIO0002",
      },
      pushName: "",
      status: "PENDING",
      message: { conversation: texto },
      messageType: "conversation",
      messageTimestamp: 1789081200,
      instanceId: "id-ficticio",
      source: "unknown",
    }),
  );
  assert.ok(r.ok);
  if (r.evento.tipo !== "send.message") return assert.fail("tipo errado");
  assert.equal(r.evento.idExterno, "envio:3EB0FICTICIO0002");
  assert.equal(r.evento.idMensagem, "3EB0FICTICIO0002");
  assert.equal(
    r.evento.hashTexto,
    createHash("sha256").update(texto).digest("hex"),
  );
  assert.equal(r.evento.enviadaEm?.getTime(), 1789081200 * 1000);
  assert.ok(!JSON.stringify(r.evento).includes("Fechamento"));
});

test("messages.upsert: diz se é do próprio número e se é grupo", () => {
  const proprio = interpretarWebhook(
    envelope("messages.upsert", {
      key: {
        remoteJid: "5511900000012@s.whatsapp.net",
        fromMe: true,
        id: "3EB0FICTICIO0003",
      },
      message: { conversation: "texto que não pode ser guardado" },
      messageType: "conversation",
    }),
  );
  assert.ok(proprio.ok);
  if (proprio.evento.tipo !== "messages.upsert")
    return assert.fail("tipo errado");
  assert.equal(proprio.evento.deMim, true);
  assert.equal(proprio.evento.grupo, false);
  assert.equal(proprio.evento.idExterno, "entrada:3EB0FICTICIO0003");
  assert.ok(!JSON.stringify(proprio.evento).includes("não pode ser guardado"));

  const grupo = interpretarWebhook(
    envelope("messages.upsert", {
      key: {
        remoteJid: "120363000000000001@g.us",
        fromMe: false,
        id: "3EB0FICTICIO0004",
      },
    }),
  );
  assert.ok(
    grupo.ok && grupo.evento.tipo === "messages.upsert" && grupo.evento.grupo,
  );
});

test("JSON quebrado é 400", () => {
  const r = interpretarWebhook("{ isto não é json");
  assert.deepEqual(r.ok ? null : r.status, 400);
});

/**
 * O QR Code nunca pode chegar por webhook: o Tetteo não assina esse evento,
 * e se chegar mesmo assim, é recusado antes de qualquer gravação.
 */
test("tipo que o Tetteo não assina é 422 — inclusive o QR Code", () => {
  for (const tipo of ["qrcode.updated", "contacts.upsert", "chats.set"]) {
    const r = interpretarWebhook(envelope(tipo, { qrcode: { base64: "x" } }));
    assert.deepEqual(r.ok ? null : r.status, 422, tipo);
  }
});

test("envelope com campo que a 2.3.7 não manda é 400", () => {
  const r = interpretarWebhook(
    envelope(
      "messages.update",
      { keyId: "X", status: "READ" },
      { loja: "outra" },
    ),
  );
  assert.deepEqual(r.ok ? null : r.status, 400);
});

test("messages.update sem keyId, ou com status inventado, é 400", () => {
  const semId = interpretarWebhook(
    envelope("messages.update", { status: "READ" }),
  );
  assert.deepEqual(semId.ok ? null : semId.status, 400);
  const inventado = interpretarWebhook(
    envelope("messages.update", { keyId: "X", status: "ENTREGUE_MESMO" }),
  );
  assert.deepEqual(inventado.ok ? null : inventado.status, 400);
});

test("instância com nome absurdo, ou data que não é objeto, é 400", () => {
  const longo = JSON.stringify({
    event: "connection.update",
    instance: "x".repeat(200),
    data: { state: "open" },
  });
  assert.deepEqual(interpretarWebhook(longo).ok, false);
  const semData = JSON.stringify({
    event: "connection.update",
    instance: "a",
    data: "open",
  });
  const r = interpretarWebhook(semData);
  assert.deepEqual(r.ok ? null : r.status, 400);
});
