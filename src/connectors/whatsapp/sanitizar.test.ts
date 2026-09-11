import assert from "node:assert/strict";
import { test } from "node:test";

import { limparTexto } from "./sanitizar";

/**
 * Erro de integração é o lugar onde segredo vaza sem ninguém perceber: a
 * Evolution devolve o pedido inteiro dentro da mensagem de erro, com a chave
 * no cabeçalho — e a mensagem acaba gravada numa coluna que o gerente vê.
 *
 * Estes testes usam valores FICTÍCIOS. Nenhum é chave de verdade.
 */

test("tira o valor exato de um segredo conhecido", () => {
  const texto = limparTexto("recusado com a chave abc123segredo-ficticio", [
    "abc123segredo-ficticio",
  ]);
  assert.ok(!texto.includes("abc123segredo-ficticio"));
  assert.ok(texto.includes("[oculto]"));
});

test("tira a chave que vem num JSON de erro", () => {
  const texto = limparTexto('Evolution 401: {"apikey":"CHAVEFICTICIA123456"}');
  assert.ok(!texto.includes("CHAVEFICTICIA123456"));
});

test("tira a chave que vem num cabeçalho", () => {
  const texto = limparTexto("headers: apikey: CHAVEFICTICIA123456, host: x");
  assert.ok(!texto.includes("CHAVEFICTICIA123456"));
});

test("tira o Bearer e o JWT", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJhcHAiOiJldm9sdXRpb24ifQ.c2lnbmF0dXJhLWZpY3RpY2lh";
  const comBearer = limparTexto(`Authorization: Bearer ${jwt}`);
  assert.ok(!comBearer.includes("eyJ"));
  const solto = limparTexto(`o passe ${jwt} venceu`);
  assert.ok(!solto.includes("eyJ"));
});

/** O QR Code chega como imagem em base64. Nunca pode parar num log. */
test("tira imagem em base64 e sequência longa de base64", () => {
  const qr = `data:image/png;base64,${"iVBORw0KGgo".repeat(40)}`;
  assert.ok(!limparTexto(`qr: ${qr}`).includes("iVBORw0KGgo"));
  const longo = "QUJD".repeat(60);
  assert.ok(!limparTexto(`corpo ${longo}`).includes(longo));
});

test("tira telefone e identificador do WhatsApp", () => {
  const texto = limparTexto(
    "número 5511900000012 não existe; jid 5511900000013@s.whatsapp.net; lid 223170800000001@lid",
  );
  assert.ok(!texto.includes("5511900000012"));
  assert.ok(!texto.includes("5511900000013"));
  assert.ok(!texto.includes("223170800000001"));
});

test("não mexe em texto comum", () => {
  assert.equal(
    limparTexto("Evolution 404: instância não encontrada"),
    "Evolution 404: instância não encontrada",
  );
});

test("segredo vazio não apaga o texto inteiro", () => {
  assert.equal(limparTexto("tudo certo", ["", "  "]), "tudo certo");
});

test("corta texto longo demais para caber numa linha de erro", () => {
  const texto = limparTexto("erro ".repeat(200));
  assert.ok(texto.length <= 301);
  assert.ok(texto.endsWith("…"));
});
