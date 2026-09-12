import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { config } from "@/proxy";

/**
 * A LARGURA DA EXCEÇÃO NO PROXY.
 *
 * O matcher é um regex negativo: quem ele NÃO reconhece fica fora do login.
 * Este teste constrói o regex a partir do próprio `config.matcher` e checa a
 * classificação de um punhado de caminhos — se algum dia alguém alargar a
 * exceção de volta para o prefixo `api/assistente-privado` (em vez da rota
 * exata `api/assistente-privado/registros`), este teste quebra.
 */

const regexDoMatcher = new RegExp(`^${config.matcher[0]}$`);

/** `true` = passa pelo proxy, exige sessão. `false` = exceção, fica de fora. */
function exigeLogin(caminho: string): boolean {
  return regexDoMatcher.test(caminho);
}

describe("a exceção do assistente privado no proxy", () => {
  test("só a rota exata fica fora do login", () => {
    assert.equal(exigeLogin("/api/assistente-privado/registros"), false);
  });

  test("o prefixo sozinho, e vizinhos parecidos, continuam atrás do login", () => {
    assert.equal(exigeLogin("/api/assistente-privado"), true);
    assert.equal(exigeLogin("/api/assistente-privado-outra/x"), true);
    assert.equal(exigeLogin("/api/assistente-privadoX"), true);
    assert.equal(exigeLogin("/assistente-privado/registros"), true);
    assert.equal(exigeLogin("/assistente"), true);
    assert.equal(exigeLogin("/"), true);
    assert.equal(exigeLogin("/app"), true);
  });

  test("as outras exceções não mudaram", () => {
    assert.equal(exigeLogin("/api/compras/tick"), false);
    assert.equal(exigeLogin("/api/arquivos/1"), true);
  });
});
