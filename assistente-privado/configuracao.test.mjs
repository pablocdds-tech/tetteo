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
const instalador = await readFile(
  new URL("./scripts/instalar.sh", import.meta.url),
  "utf8",
);

test("nenhuma chave de API e nenhum modelo reserva", () => {
  assert.ok(
    !/apiKey|OPENAI_API_KEY|CODEX_API_KEY|sk-/.test(JSON.stringify(config)),
  );
  assert.deepEqual(config.agents.defaults.model.fallbacks, []);
});

test("nenhum agentRuntime em openai/* — a assinatura só entra pela rota automática", () => {
  // docs.openclaw.ai/providers/openai/setup.md, aba "Codex subscription":
  // "No runtime config is required for this exact official HTTPS native
  // route." Fixar `agentRuntime.id: "openclaw"` pula essa rota e troca para
  // o runtime embutido do OpenClaw, cuja autenticação é um perfil de CHAVE
  // DE API `openai` (ou OAuth só por um transporte interno com ordem de auth
  // declarada) — e não temos nenhum dos dois, de propósito. Foi exatamente
  // esse override que produziu, ao vivo, "No route-compatible authentication
  // source is configured for openai" com `models list --provider openai`
  // mostrando `Auth: no` mesmo com OAuth válido. Sem esta trava, qualquer um
  // pode recolocar o override e trazer o defeito de volta.
  assert.ok(
    !/agentRuntime/.test(JSON.stringify(config)),
    "achou agentRuntime na config — isso tira a rota automática da assinatura",
  );
});

test("plugin do Codex habilitado — de fábrica ele vem desligado", () => {
  // A rota da assinatura "pode selecionar o runtime do Codex app-server
  // automaticamente, e o OpenClaw instala ou repara o plugin do Codex
  // embutido quando esse runtime é escolhido" — mas só se o plugin estiver
  // habilitado. Verificado ao vivo: `config get plugins.entries.codex` vem
  // "valid but unset" e `plugins list` mostra o Codex como "disabled" de
  // fábrica. Sem este `enabled: true`, a assinatura não tem por onde
  // autenticar.
  assert.equal(config.plugins.entries.codex.enabled, true);
});

test("gateway com token por variável e freio de força bruta", () => {
  assert.equal(config.gateway.auth.mode, "token");
  assert.equal(config.gateway.auth.token, "${OPENCLAW_GATEWAY_TOKEN}");
  assert.deepEqual(config.gateway.auth.rateLimit, {
    maxAttempts: 10,
    windowMs: 60000,
    lockoutMs: 300000,
  });
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

test("o instalador fecha a configuração para leitura só do dono", () => {
  assert.match(instalador, /chmod 600 \/estado\/openclaw\.json/);
});
