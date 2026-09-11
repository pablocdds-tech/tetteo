import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFINICOES } from "./ferramentas.mjs";
import { criarProtocolo } from "./protocolo.mjs";

function protocolo(chamar = async () => ({ estado: "ok" })) {
  return criarProtocolo({
    nome: "fechamento",
    versao: "1.0.0",
    ferramentas: { definicoes: DEFINICOES, chamar },
  });
}

test("initialize devolve a versão pedida quando conhecida, e só a capacidade de ferramentas", async () => {
  const r = await protocolo()({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    },
  });
  assert.equal(r.id, 1);
  assert.equal(r.result.protocolVersion, "2025-03-26");
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(r.result.serverInfo, {
    name: "fechamento",
    version: "1.0.0",
  });
});

test("versão desconhecida recebe a mais nova que o servidor fala", async () => {
  const r = await protocolo()({
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { protocolVersion: "1999-01-01" },
  });
  assert.equal(r.result.protocolVersion, "2025-06-18");
});

test("notificação não tem resposta; ping tem", async () => {
  assert.equal(
    await protocolo()({ jsonrpc: "2.0", method: "notifications/initialized" }),
    null,
  );
  assert.deepEqual(
    await protocolo()({ jsonrpc: "2.0", id: 3, method: "ping" }),
    { jsonrpc: "2.0", id: 3, result: {} },
  );
});

test("tools/list devolve exatamente as cinco", async () => {
  const r = await protocolo()({ jsonrpc: "2.0", id: 4, method: "tools/list" });
  assert.deepEqual(
    r.result.tools.map((t) => t.name),
    DEFINICOES.map((d) => d.name),
  );
});

test("tools/call devolve o resultado como texto JSON", async () => {
  const r = await protocolo(async (nome, args) => ({ nome, args }))({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "listar_arquivos", arguments: {} },
  });
  assert.equal(r.result.isError, false);
  assert.deepEqual(JSON.parse(r.result.content[0].text), {
    nome: "listar_arquivos",
    args: {},
  });
});

test("ferramenta desconhecida é -32602; método desconhecido é -32601", async () => {
  const a = await protocolo()({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "apagar_tudo" },
  });
  assert.equal(a.error.code, -32602);
  const b = await protocolo()({
    jsonrpc: "2.0",
    id: 7,
    method: "resources/list",
  });
  assert.equal(b.error.code, -32601);
});

test("exceção dentro da ferramenta vira isError sem detalhe interno", async () => {
  const r = await protocolo(async () => {
    throw new Error("caminho /home/node/.openclaw/segredo");
  })({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: { name: "listar_arquivos", arguments: {} },
  });
  assert.equal(r.result.isError, true);
  assert.ok(!r.result.content[0].text.includes("/home/node"));
});
