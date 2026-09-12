import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lerConfig } from "./config.js";

const base = {
  DATABASE_URL: "postgresql://tetteo_mcp:segredo@localhost:5432/tetteo",
  MCP_URL_PUBLICA: "https://mcp.exemplo.com.br",
};

describe("lerConfig", () => {
  it("monta emissor e recurso a partir da URL pública", () => {
    const config = lerConfig({ ...base, NODE_ENV: "production" });

    assert.equal(config.emissor, "https://mcp.exemplo.com.br");
    assert.equal(config.urlMcp.href, "https://mcp.exemplo.com.br/mcp");
    assert.deepEqual(config.hostsPermitidos, [
      "mcp.exemplo.com.br",
      "localhost",
      "127.0.0.1",
    ]);
    assert.deepEqual(config.clientesConfiaveis, ["claude.ai", "claude.com"]);
    assert.equal(config.porta, 8080);
    assert.equal(config.fonte, "ficticia");
  });

  it("recusa http em produção", () => {
    assert.throws(
      () =>
        lerConfig({
          ...base,
          NODE_ENV: "production",
          MCP_URL_PUBLICA: "http://mcp.exemplo.com.br",
        }),
      /https/,
    );
  });

  it("aceita http em desenvolvimento", () => {
    const config = lerConfig({
      ...base,
      MCP_URL_PUBLICA: "http://127.0.0.1:8787",
    });
    assert.equal(config.emissor, "http://127.0.0.1:8787");
  });

  it("recusa URL pública com caminho", () => {
    assert.throws(
      () =>
        lerConfig({
          ...base,
          MCP_URL_PUBLICA: "https://mcp.exemplo.com.br/mcp",
        }),
      /sem caminho/,
    );
  });

  it("nomeia a variável que falta", () => {
    assert.throws(
      () => lerConfig({ MCP_URL_PUBLICA: base.MCP_URL_PUBLICA }),
      /DATABASE_URL/,
    );
  });

  it("nunca repete o valor da DATABASE_URL no erro", () => {
    assert.throws(
      () => lerConfig({ ...base, DATABASE_URL: "mysql://u:segredo@h/banco" }),
      (erro: Error) =>
        /DATABASE_URL/.test(erro.message) && !erro.message.includes("segredo"),
    );
  });

  it("normaliza listas com espaços e maiúsculas", () => {
    const config = lerConfig({
      ...base,
      MCP_HOSTS_PERMITIDOS: " MCP.exemplo.com.br , localhost ",
      MCP_CLIENTES_CONFIAVEIS: "Claude.ai",
    });
    assert.deepEqual(config.hostsPermitidos, [
      "mcp.exemplo.com.br",
      "localhost",
    ]);
    assert.deepEqual(config.clientesConfiaveis, ["claude.ai"]);
  });
});
