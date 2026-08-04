import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calcularCmv,
  percentualDoCmv,
  type CompraDoPeriodo,
  type ItemContado,
} from "./cmv";

/**
 * Este é o número que decide preço de cardápio. Cada caso abaixo é uma forma
 * de ele sair errado sem parecer errado.
 */

const item = (
  insumoId: string,
  nome: string,
  quantidade: number | null,
  custoUnitario: number,
): ItemContado => ({
  insumoId,
  nome,
  categoria: null,
  unidade: "KG",
  quantidade,
  custoUnitario,
});

test("a fórmula básica: inicial + compras − final", () => {
  const r = calcularCmv(
    [item("a", "mussarela", 10, 30)],
    [item("a", "mussarela", 4, 30)],
    [{ insumoId: "a", quantidade: 20, valor: 600 }],
  );

  assert.equal(r.valorInicial, 300);
  assert.equal(r.valorComprado, 600);
  assert.equal(r.valorFinal, 120);
  assert.equal(r.cmv, 780);
  assert.equal(r.linhas[0].consumo, 26);
});

test("sem compra no período, o CMV é a diferença entre as pontas", () => {
  const r = calcularCmv(
    [item("a", "farinha", 100, 4)],
    [item("a", "farinha", 60, 4)],
    [],
  );
  assert.equal(r.cmv, 160);
  assert.equal(r.linhas[0].consumo, 40);
});

test("cada ponta usa o custo congelado NA SUA contagem", () => {
  // A mussarela subiu de R$30 para R$40 no meio do período. Se o sistema
  // usasse um custo só, a alta de preço viraria consumo inventado.
  const r = calcularCmv(
    [item("a", "mussarela", 10, 30)],
    [item("a", "mussarela", 10, 40)],
    [],
  );
  assert.equal(r.valorInicial, 300);
  assert.equal(r.valorFinal, 400);
  assert.equal(r.cmv, -100);
  // A quantidade não mudou: nada foi consumido de verdade.
  assert.equal(r.linhas[0].consumo, 0);
});

test("item contado só na ponta final fica FORA, com nome e motivo", () => {
  // Entrar no cálculo daria consumo negativo e derrubaria o CMV total.
  const r = calcularCmv(
    [item("a", "mussarela", 10, 30)],
    [item("a", "mussarela", 4, 30), item("b", "calabresa", 5, 20)],
    [],
  );

  assert.equal(r.linhas.length, 1);
  assert.equal(r.foraDoCalculo.length, 1);
  assert.equal(r.foraDoCalculo[0].nome, "calabresa");
  assert.match(r.foraDoCalculo[0].motivo, /inicial/);
  assert.equal(r.cmv, 180);
});

test("item em branco numa das pontas também fica fora — branco não é zero", () => {
  const r = calcularCmv(
    [item("a", "provolone", null, 50)],
    [item("a", "provolone", 3, 50)],
    [],
  );
  assert.equal(r.linhas.length, 0);
  assert.equal(r.cmv, 0);
  assert.equal(r.foraDoCalculo.length, 1);
});

test("zero contado É contado: acabou não é 'não contei'", () => {
  const r = calcularCmv(
    [item("a", "azeitona", 8, 10)],
    [item("a", "azeitona", 0, 10)],
    [],
  );
  assert.equal(r.linhas.length, 1);
  assert.equal(r.cmv, 80);
  assert.equal(r.foraDoCalculo.length, 0);
});

test("consumo negativo é destacado como suspeita, não escondido", () => {
  // Sobrou mais do que existia: erro de contagem, de embalagem, ou nota
  // faltando. Some no total se ninguém olhar.
  const r = calcularCmv(
    [item("a", "farinha", 5, 4)],
    [item("a", "farinha", 30, 4)],
    [],
  );
  assert.equal(r.suspeitas.length, 1);
  assert.equal(r.suspeitas[0].nome, "farinha");
  assert.ok(r.linhas[0].consumo < 0);
});

test("várias compras do mesmo insumo somam", () => {
  const compras: CompraDoPeriodo[] = [
    { insumoId: "a", quantidade: 10, valor: 300 },
    { insumoId: "a", quantidade: 5, valor: 175 },
  ];
  const r = calcularCmv(
    [item("a", "mussarela", 0, 30)],
    [item("a", "mussarela", 0, 35)],
    compras,
  );
  assert.equal(r.linhas[0].comprado, 15);
  assert.equal(r.valorComprado, 475);
  assert.equal(r.cmv, 475);
});

test("compra de insumo que não foi contado não entra no total", () => {
  // Comprou tomate mas não contou tomate: entrar só a compra inflaria o CMV
  // sem ter a sobra do outro lado para descontar.
  const r = calcularCmv(
    [item("a", "mussarela", 10, 30)],
    [item("a", "mussarela", 10, 30)],
    [{ insumoId: "z", quantidade: 50, valor: 400 }],
  );
  assert.equal(r.valorComprado, 0);
  assert.equal(r.cmv, 0);
});

test("o total é a soma das linhas que aparecem na tela", () => {
  // Somar valores cheios e mostrar linhas arredondadas faz a conferência na
  // calculadora dar diferente do total — e quem confere para de confiar.
  const r = calcularCmv(
    [item("a", "queijo", 12.75, 38.9), item("b", "bacon", 3.5, 27.5)],
    [item("a", "queijo", 2.25, 38.9), item("b", "bacon", 1.1, 27.5)],
    [],
  );

  const somaDasLinhas =
    Math.round(r.linhas.reduce((s, l) => s + l.cmv, 0) * 100) / 100;
  assert.equal(r.cmv, somaDasLinhas);
});

test("percentual só existe com faturamento informado", () => {
  assert.equal(percentualDoCmv(3000, 10000), 30);
  assert.equal(percentualDoCmv(3000, 0), null);
  assert.equal(percentualDoCmv(3000, -1), null);
});
