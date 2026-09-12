import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { consultarSaudeDoMcp } from "./saude";

const endereco = "https://mcp.exemplo.com.br";

describe("saúde do servidor MCP", () => {
  it("sem endereço configurado, diz isso — não tenta adivinhar", async () => {
    const saude = await consultarSaudeDoMcp({}, async () => {
      throw new Error("não deveria buscar");
    });
    assert.equal(saude.situacao, "sem-endereco");
    assert.equal(saude.endereco, null);
  });

  it("resposta boa traz versão, fonte e banco", async () => {
    const saude = await consultarSaudeDoMcp(
      { MCP_URL_PUBLICA: endereco },
      async (url) => {
        assert.equal(url, `${endereco}/health`);
        return new Response(
          JSON.stringify({
            status: "ok",
            servico: "tetteo-mcp",
            versao: "1.0.0",
            banco: "ok",
            fonte: "ficticia",
          }),
          { status: 200 },
        );
      },
    );
    assert.equal(saude.situacao, "ok");
    assert.equal(saude.versao, "1.0.0");
    assert.equal(saude.fonte, "ficticia");
    assert.equal(saude.banco, "ok");
    assert.equal(saude.endereco, endereco);
  });

  it("erro de rede, demora ou status ruim viram 'não respondeu'", async () => {
    const casos = [
      async () => {
        throw new Error("timeout");
      },
      async () => new Response("", { status: 502 }),
      async () => new Response("isto não é json", { status: 200 }),
    ];
    for (const buscar of casos) {
      const saude = await consultarSaudeDoMcp(
        { MCP_URL_PUBLICA: endereco },
        buscar,
      );
      assert.equal(saude.situacao, "nao-respondeu");
      assert.equal(saude.endereco, endereco);
    }
  });
});
