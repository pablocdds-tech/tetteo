import assert from "node:assert/strict";
import { test } from "node:test";
import { caiNaSituacao, lerSituacao } from "./filtros-contas";
import { numerosDoPainel, type ContaParaContar } from "./numeros";

test("os atalhos dos indicadores mostram exatamente as contas somadas", () => {
  const contas: ContaParaContar[] = [
    { direcao: "PAGAR", status: "ABERTO", valor: 120, atrasado: true },
    { direcao: "PAGAR", status: "ABERTO", valor: 80, atrasado: false },
    { direcao: "RECEBER", status: "ABERTO", valor: 300, atrasado: true },
    { direcao: "PAGAR", status: "QUITADO", valor: 500, atrasado: false },
    { direcao: "PAGAR", status: "CANCELADO", valor: 900, atrasado: true },
  ];
  const numeros = numerosDoPainel(contas);
  for (const [situacao, total] of [
    ["pagar-vencidas", numeros.vencidoAPagar],
    ["pagar-a-vencer", numeros.aPagarNoPeriodo],
  ] as const) {
    const filtradas = contas.filter((c) => caiNaSituacao(c, situacao));
    assert.equal(filtradas.length, 1);
    assert.equal(
      filtradas.reduce((soma, c) => soma + c.valor, 0),
      total,
    );
  }
});

test("situação da URL é limitada aos filtros conhecidos", () => {
  assert.equal(lerSituacao("pagar-vencidas"), "pagar-vencidas");
  assert.equal(lerSituacao(["quitadas", "abertas"]), "quitadas");
  assert.equal(lerSituacao("outra-unidade"), "todas");
  assert.equal(lerSituacao(undefined), "todas");
});
