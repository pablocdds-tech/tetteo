import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { enviarRegistro } from "./registro.mjs";

test("manda o corpo em JSON com o cabeçalho do segredo", async () => {
  let recebido;
  const servidor = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      recebido = {
        segredo: req.headers["x-assistente-segredo"],
        tipo: req.headers["content-type"],
        corpo: JSON.parse(corpo),
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${servidor.address().port}/registros`;
  const r = await enviarRegistro({
    url,
    segredo: "s".repeat(40),
    corpo: { tipo: "execucao", chave: "abc123" },
  });
  servidor.close();
  assert.deepEqual(r, { enviado: true });
  assert.equal(recebido.segredo, "s".repeat(40));
  assert.equal(recebido.tipo, "application/json");
  assert.equal(recebido.corpo.chave, "abc123");
});

test("sem endereço ou sem segredo, nem tenta", async () => {
  assert.deepEqual(await enviarRegistro({ url: "", segredo: "x", corpo: {} }), {
    enviado: false,
    motivo: "registro desligado",
  });
  assert.deepEqual(
    await enviarRegistro({ url: "http://x", segredo: "", corpo: {} }),
    {
      enviado: false,
      motivo: "registro desligado",
    },
  );
});

test("recusa do Tetteo e rede fora não derrubam nada nem mostram o segredo", async () => {
  const segredo = "SEGREDO-QUE-NAO-PODE-APARECER";
  const recusa = await enviarRegistro({
    url: "http://x",
    segredo,
    corpo: {},
    fetchImpl: async () => new Response("{}", { status: 401 }),
  });
  assert.deepEqual(recusa, { enviado: false, motivo: "Tetteo respondeu 401" });
  const rede = await enviarRegistro({
    url: "http://x",
    segredo,
    corpo: {},
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.deepEqual(rede, { enviado: false, motivo: "falha de rede" });
  const demora = await enviarRegistro({
    url: "http://x",
    segredo,
    corpo: {},
    fetchImpl: async () => {
      const erro = new Error("timeout");
      erro.name = "TimeoutError";
      throw erro;
    },
  });
  assert.deepEqual(demora, {
    enviado: false,
    motivo: "o Tetteo não respondeu a tempo",
  });
  assert.ok(!JSON.stringify([recusa, rede, demora]).includes("SEGREDO"));
});
