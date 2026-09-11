import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVIDOR = fileURLToPath(new URL("./servidor.mjs", import.meta.url));

async function esperar(condicao, limiteMs = 5_000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs)
      throw new Error("tempo esgotado esperando resposta");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("fala MCP por stdio, de ponta a ponta", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "servidor-"));
  const dados = path.join(raiz, "dados");
  await mkdir(dados, { recursive: true });
  await writeFile(
    path.join(dados, "vendas.csv"),
    "data;loja;pedidos;valor_total\n09/09/2026;Loja Centro;10;100,00\n10/09/2026;Loja Centro;10;100,00\n",
  );

  const filho = spawn(process.execPath, [SERVIDOR], {
    env: {
      ...process.env,
      PASTA_DADOS: dados,
      PASTA_TRABALHO: path.join(raiz, "trabalho"),
      LOJA_PERMITIDA: "Loja Centro",
      TETTEO_REGISTRO_URL: "",
      TETTEO_REGISTRO_SEGREDO: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const respostas = [];
  let buffer = "";
  filho.stdout.on("data", (pedaco) => {
    buffer += pedaco;
    let fim;
    while ((fim = buffer.indexOf("\n")) >= 0) {
      respostas.push(JSON.parse(buffer.slice(0, fim)));
      buffer = buffer.slice(fim + 1);
    }
  });
  const mandar = (m) => filho.stdin.write(`${JSON.stringify(m)}\n`);

  mandar({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "teste", version: "0" },
    },
  });
  mandar({ jsonrpc: "2.0", method: "notifications/initialized" });
  mandar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  mandar({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "calcular_fechamento",
      arguments: { arquivo: "vendas.csv" },
    },
  });
  filho.stdin.write("isto não é json\n");

  await esperar(() => respostas.length >= 4);
  filho.stdin.end();
  await new Promise((r) => filho.on("close", r));

  const porId = Object.fromEntries(
    respostas.filter((r) => r.id !== null).map((r) => [r.id, r]),
  );
  assert.equal(porId[1].result.serverInfo.name, "fechamento");
  assert.equal(porId[2].result.tools.length, 5);
  const resultado = JSON.parse(porId[3].result.content[0].text);
  assert.equal(resultado.estado, "calculado");
  assert.equal(resultado.totalCentavos, 20000);
  assert.ok(respostas.some((r) => r.id === null && r.error?.code === -32700));
});

test("a resposta do tools/call não é cortada quando o stdin fecha logo em seguida", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "servidor-fecha-"));
  const dados = path.join(raiz, "dados");
  await mkdir(dados, { recursive: true });
  await writeFile(
    path.join(dados, "vendas.csv"),
    "data;loja;pedidos;valor_total\n09/09/2026;Loja Centro;10;100,00\n10/09/2026;Loja Centro;10;100,00\n",
  );

  const filho = spawn(process.execPath, [SERVIDOR], {
    env: {
      ...process.env,
      PASTA_DADOS: dados,
      PASTA_TRABALHO: path.join(raiz, "trabalho"),
      LOJA_PERMITIDA: "Loja Centro",
      TETTEO_REGISTRO_URL: "",
      TETTEO_REGISTRO_SEGREDO: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const respostas = [];
  let buffer = "";
  filho.stdout.on("data", (pedaco) => {
    buffer += pedaco;
    let fim;
    while ((fim = buffer.indexOf("\n")) >= 0) {
      respostas.push(JSON.parse(buffer.slice(0, fim)));
      buffer = buffer.slice(fim + 1);
    }
  });
  const mandar = (m) => filho.stdin.write(`${JSON.stringify(m)}\n`);

  mandar({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "teste", version: "0" },
    },
  });
  mandar({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "calcular_fechamento",
      arguments: { arquivo: "vendas.csv" },
    },
  });
  // Fecha a entrada IMEDIATAMENTE após mandar o pedido, sem esperar
  // resposta nenhuma — é exatamente a corrida que cortava a resposta.
  filho.stdin.end();

  const codigo = await new Promise((resolve) => filho.on("close", resolve));

  const porId = Object.fromEntries(
    respostas.filter((r) => r.id !== null).map((r) => [r.id, r]),
  );
  assert.ok(
    porId[2],
    "a resposta do tools/call foi cortada pelo fechamento do stdin",
  );
  const resultado = JSON.parse(porId[2].result.content[0].text);
  assert.equal(resultado.estado, "calculado");
  assert.equal(codigo, 0);
});
