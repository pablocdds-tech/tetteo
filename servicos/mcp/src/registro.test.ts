import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criarRegistro } from "./registro.js";

function capturar() {
  const linhas: Record<string, unknown>[] = [];
  const registro = criarRegistro((linha) => linhas.push(JSON.parse(linha)));
  return { linhas, registro };
}

describe("registro", () => {
  it("escreve uma linha JSON com hora, nível e mensagem", () => {
    const { linhas, registro } = capturar();
    registro.info("requisicao", { caminho: "/mcp", status: 200 });

    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.nivel, "info");
    assert.equal(linhas[0]?.mensagem, "requisicao");
    assert.equal(linhas[0]?.caminho, "/mcp");
    assert.match(String(linhas[0]?.hora), /^\d{4}-\d{2}-\d{2}T/);
  });

  it("apaga token, senha, e-mail e cabeçalho de autorização, inclusive aninhados", () => {
    const { linhas, registro } = capturar();
    registro.aviso("tentativa", {
      access_token: "tmcp_abc",
      senha: "123",
      email: "a@b.c",
      cabecalhos: { authorization: "Bearer tmcp_abc", accept: "json" },
    });

    const texto = JSON.stringify(linhas[0]);
    assert.ok(!texto.includes("tmcp_abc"));
    assert.ok(!texto.includes("a@b.c"));
    assert.ok(!texto.includes('"123"'));
    assert.equal(
      (linhas[0]?.cabecalhos as Record<string, string>).accept,
      "json",
    );
  });

  it("transforma Error em nome e mensagem", () => {
    const { linhas, registro } = capturar();
    registro.erro("falhou", { erro: new TypeError("quebrou") });

    const erro = linhas[0]?.erro as Record<string, string>;
    assert.equal(erro.nome, "TypeError");
    assert.equal(erro.mensagem, "quebrou");
  });
});
