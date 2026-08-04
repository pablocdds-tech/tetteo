import assert from "node:assert/strict";
import { test } from "node:test";

import { numeroBr, numeroBrOpcional, paraCampo } from "./numero";

/**
 * Este arquivo existe por causa de um bug real.
 *
 * A leitura apagava todo ponto achando que era separador de milhar. "3,5"
 * salvo e reaberto voltava do banco como "3.5", era relido como 35, e uma
 * contagem de 3,5 kg de calabresa virava R$ 962,50 em vez de R$ 96,25 — sem
 * erro na tela, sem aviso, sem rastro.
 *
 * Cada caso abaixo é uma forma de o dinheiro sair errado em silêncio.
 */

const ler = (texto: string) => numeroBr("o valor").safeParse(texto);
const lerOpcional = (texto: string) =>
  numeroBrOpcional("a quantidade").safeParse(texto);

test("vírgula é o separador decimal", () => {
  assert.equal(ler("38,90").data, 38.9);
  assert.equal(ler("3,5").data, 3.5);
  assert.equal(ler("0,250").data, 0.25);
});

test("ponto com vírgula presente é separador de milhar", () => {
  assert.equal(ler("1.234,56").data, 1234.56);
  assert.equal(ler("1.234.567,89").data, 1234567.89);
});

test("ponto sozinho com 1, 2 ou 4+ casas é decimal — o bug que gerou este arquivo", () => {
  assert.equal(ler("3.5").data, 3.5);
  assert.equal(ler("12.75").data, 12.75);
  assert.equal(ler("38.9").data, 38.9);
  assert.equal(ler("0.1234").data, 0.1234);
});

test("vários pontos sem vírgula são milhar", () => {
  assert.equal(ler("1.234.567").data, 1234567);
});

test("ponto sozinho com exatamente 3 casas é recusado, não adivinhado", () => {
  // "1.200" pode ser mil e duzentos ou um vírgula dois. Errar aqui erra por
  // mil vezes, então o sistema para e pergunta.
  const r = ler("1.200");
  assert.equal(r.success, false);
  assert.match(r.error!.issues[0].message, /vírgula|sem ponto/);
});

test("texto que não é número é recusado", () => {
  assert.equal(ler("abc").success, false);
  assert.equal(ler("12kg").success, false);
});

test("negativo é recusado", () => {
  assert.equal(ler("-5").success, false);
});

test("em branco: zero no obrigatório, nulo no opcional", () => {
  // A diferença decide o CMV: "não contei" não é "acabou".
  assert.equal(ler("").data, 0);
  assert.equal(lerOpcional("").data, null);
  assert.equal(lerOpcional("0").data, 0);
});

test("paraCampo devolve algo que a própria leitura entende de volta", () => {
  // A ida e a volta precisam fechar. Foi a volta que quebrou em produção.
  for (const valor of [3.5, 38.9, 1234.56, 0.25, 24, 1200]) {
    const noCampo = paraCampo(valor);
    assert.equal(
      ler(noCampo).data,
      valor,
      `ida e volta falhou para ${valor} (campo: "${noCampo}")`,
    );
  }
});

test("paraCampo nunca emite separador de milhar", () => {
  // Um "1.234" devolvido pelo sistema cairia no caso ambíguo.
  assert.equal(paraCampo(1234), "1234");
  assert.equal(paraCampo(1234.56), "1234,56");
  assert.equal(paraCampo(38.9, 2), "38,90");
  assert.equal(paraCampo(null), "");
});
