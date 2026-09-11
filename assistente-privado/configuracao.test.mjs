import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * A TRAVA DA CONFIGURAÇÃO — o que não pode mudar sem alguém perceber.
 * Se um dia alguém puser chave de API, modelo reserva ou abrir ferramenta,
 * este teste quebra no `npm run check`, antes de chegar à VPS.
 */

const config = JSON.parse(
  await readFile(new URL("./openclaw.exemplo.json", import.meta.url), "utf8"),
);
const compose = await readFile(
  new URL("./compose.yml", import.meta.url),
  "utf8",
);

test("nenhuma chave de API e nenhum modelo reserva", () => {
  assert.ok(
    !/apiKey|OPENAI_API_KEY|CODEX_API_KEY|sk-/.test(JSON.stringify(config)),
  );
  assert.deepEqual(config.agents.defaults.model.fallbacks, []);
});

test("runtime embutido para qualquer modelo openai", () => {
  assert.deepEqual(config.agents.defaults.models["openai/*"].agentRuntime, {
    id: "openclaw",
  });
});

test("gateway com token por variável", () => {
  assert.equal(config.gateway.auth.mode, "token");
  assert.equal(config.gateway.auth.token, "${OPENCLAW_GATEWAY_TOKEN}");
});

test("ferramentas: só o MCP; o resto negado; sem agendamento", () => {
  assert.equal(config.tools.profile, "messaging");
  for (const grupo of [
    "group:runtime",
    "group:fs",
    "group:web",
    "group:ui",
    "group:automation",
    "group:messaging",
    "group:sessions",
    "group:nodes",
    "group:media",
    "group:memory",
    "group:agents",
  ]) {
    assert.ok(config.tools.deny.includes(grupo), grupo);
  }
  assert.equal(config.tools.elevated.enabled, false);
  assert.equal(config.tools.exec.security, "deny");
  assert.equal(config.cron.enabled, false);
  assert.deepEqual(Object.keys(config.mcp.servers), ["fechamento"]);
  assert.equal(config.mcp.servers.fechamento.env.LOJA_PERMITIDA, "Loja Centro");
  assert.equal(config.browser.enabled, false);
  assert.equal(config.plugins.entries.browser.enabled, false);
  assert.equal(config.agents.defaults.heartbeat.every, "0m");
});

test("o servidor MCP: pastas, loja e segredos por referência", () => {
  const servidor = config.mcp.servers.fechamento;
  assert.deepEqual(Object.keys(servidor).sort(), [
    "args",
    "command",
    "connectionTimeoutMs",
    "cwd",
    "env",
    "requestTimeoutMs",
  ]);
  assert.deepEqual(servidor.env, {
    PASTA_DADOS: "/home/node/.openclaw/workspace/dados-exemplo",
    PASTA_TRABALHO: "/home/node/.openclaw/workspace",
    LOJA_PERMITIDA: "Loja Centro",
    DIAS_PARA_DESATUALIZADO: "2",
    DEMONSTRACAO: "1",
    TETTEO_REGISTRO_URL: "${TETTEO_REGISTRO_URL}",
    TETTEO_REGISTRO_SEGREDO: "${TETTEO_REGISTRO_SEGREDO}",
  });
});

test("o compose fixa a versão e publica uma porta só, em 127.0.0.1", () => {
  const bloco = /\n\s*ports:\n((?:\s*-\s*.*\n)+)/.exec(compose);
  assert.ok(bloco, "não achei o bloco ports: no compose");
  const entradas = bloco[1]
    .trimEnd()
    .split("\n")
    .map((linha) => linha.trim());
  assert.deepEqual(entradas, ['- "127.0.0.1:18789:18789"']);
  assert.ok(!/0\.0\.0\.0/.test(compose));
  assert.match(compose, /image: ghcr\.io\/openclaw\/openclaw:2026\.9\.4\n/);
  assert.match(compose, /\/opt\/ferramenta:ro/);
});
