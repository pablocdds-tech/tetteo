import assert from "node:assert/strict";
import { test } from "node:test";

import { numerosDoPainel, type ContaParaContar } from "./numeros";

function conta(dados: Partial<ContaParaContar> = {}): ContaParaContar {
  return {
    direcao: "PAGAR",
    status: "ABERTO",
    valor: 100,
    atrasado: false,
    ...dados,
  };
}

test("cancelado não entra em nenhuma soma", () => {
  const numeros = numerosDoPainel([
    conta({ status: "CANCELADO", valor: 999 }),
    conta({ status: "CANCELADO", valor: 999, atrasado: true }),
  ]);

  assert.equal(numeros.aPagarNoPeriodo, 0);
  assert.equal(numeros.vencidoAPagar, 0);
  assert.equal(numeros.contasVencidas, 0);
});

test("quitado saiu da fila e não conta como a pagar", () => {
  const numeros = numerosDoPainel([
    conta({ status: "QUITADO", valor: 500 }),
    conta({ status: "ABERTO", valor: 120 }),
  ]);

  assert.equal(numeros.aPagarNoPeriodo, 120);
  assert.equal(numeros.contasAPagar, 1);
});

test("vencido e a vencer não se sobrepõem", () => {
  const numeros = numerosDoPainel([
    conta({ valor: 300, atrasado: true }),
    conta({ valor: 200, atrasado: true }),
    conta({ valor: 150 }),
  ]);

  assert.equal(numeros.vencidoAPagar, 500);
  assert.equal(numeros.contasVencidas, 2);
  assert.equal(numeros.aPagarNoPeriodo, 150);
  assert.equal(numeros.contasAPagar, 1);
});

test("a receber conta vencido e a vencer juntos", () => {
  const numeros = numerosDoPainel([
    conta({ direcao: "RECEBER", valor: 80, atrasado: true }),
    conta({ direcao: "RECEBER", valor: 20 }),
    conta({ direcao: "PAGAR", valor: 999 }),
  ]);

  assert.equal(numeros.aReceberNoPeriodo, 100);
  assert.equal(numeros.contasAReceber, 2);
});

test("soma de centavos fecha no centavo", () => {
  const numeros = numerosDoPainel([
    conta({ valor: 33.33 }),
    conta({ valor: 33.33 }),
    conta({ valor: 33.34 }),
  ]);

  assert.equal(numeros.aPagarNoPeriodo, 100);
});

test("lista vazia devolve zeros, não indefinido", () => {
  const numeros = numerosDoPainel([]);

  assert.deepEqual(numeros, {
    vencidoAPagar: 0,
    contasVencidas: 0,
    aPagarNoPeriodo: 0,
    contasAPagar: 0,
    aReceberNoPeriodo: 0,
    contasAReceber: 0,
  });
});
