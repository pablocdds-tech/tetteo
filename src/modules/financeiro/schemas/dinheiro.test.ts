import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calcularResultado,
  dividirEmParcelas,
  faixaDoVencimento,
  projetarSaldo,
  resumirFluxo,
  vencimentosMensais,
  type LancamentoParaFluxo,
} from "./dinheiro";

/**
 * Cada caso abaixo é uma forma de o número do caixa mentir — e o caixa é o
 * único número que, errado, quebra a empresa em vez de só irritar alguém.
 */

const HOJE = new Date(2026, 7, 4); // 4 de agosto de 2026

function lanc(parcial: Partial<LancamentoParaFluxo> = {}): LancamentoParaFluxo {
  return {
    id: Math.random().toString(36).slice(2),
    direcao: "PAGAR",
    status: "ABERTO",
    valor: 100,
    vencimento: HOJE,
    quitadoEm: null,
    valorQuitado: null,
    ...parcial,
  };
}

test("R$ 100 em três parcelas soma exatamente R$ 100", () => {
  // O ingênuo daria 33,33 × 3 = 99,99, e o centavo sumido vira divergência
  // com o boleto todo mês.
  const p = dividirEmParcelas(100, 3);
  assert.deepEqual(p, [33.34, 33.33, 33.33]);
  assert.equal(
    p.reduce((s, v) => s + v, 0),
    100,
  );
});

test("o resto vai nas PRIMEIRAS parcelas, uma a uma", () => {
  assert.deepEqual(dividirEmParcelas(10, 4), [2.5, 2.5, 2.5, 2.5]);
  assert.deepEqual(dividirEmParcelas(10, 3), [3.34, 3.33, 3.33]);
  assert.deepEqual(dividirEmParcelas(0.05, 3), [0.02, 0.02, 0.01]);
});

test("uma parcela só devolve o valor inteiro", () => {
  assert.deepEqual(dividirEmParcelas(1234.56, 1), [1234.56]);
});

test("valor que divide certo não ganha centavo sobrando", () => {
  const p = dividirEmParcelas(1200, 12);
  assert.equal(p.length, 12);
  assert.ok(p.every((v) => v === 100));
});

test("vencimento dia 31 cai no último dia de fevereiro, não em março", () => {
  // Pular para 3 de março atrasaria o aluguel — e nenhum contrato funciona
  // assim.
  const datas = vencimentosMensais(new Date(2026, 0, 31), 3);
  assert.equal(datas[0].getDate(), 31); // janeiro
  assert.equal(datas[1].getMonth(), 1);
  assert.equal(datas[1].getDate(), 28); // fevereiro de 2026
  assert.equal(datas[2].getDate(), 31); // março volta ao 31
});

test("as faixas separam o que já venceu do que vence hoje", () => {
  assert.equal(faixaDoVencimento(new Date(2026, 7, 3), HOJE), "vencido");
  assert.equal(faixaDoVencimento(new Date(2026, 7, 4), HOJE), "hoje");
  assert.equal(faixaDoVencimento(new Date(2026, 7, 10), HOJE), "semana");
  assert.equal(faixaDoVencimento(new Date(2026, 7, 20), HOJE), "depois");
});

test("hora do dia não muda a faixa — cobrança é por dia", () => {
  const tarde = new Date(2026, 7, 4, 23, 50);
  assert.equal(faixaDoVencimento(tarde, HOJE), "hoje");
});

test("quitado e cancelado saem da fila", () => {
  // Se somassem, o 'a pagar' nunca diminuiria e a tela nunca ficaria limpa.
  const r = resumirFluxo(
    [
      lanc({ valor: 100 }),
      lanc({ valor: 500, status: "QUITADO" }),
      lanc({ valor: 900, status: "CANCELADO" }),
    ],
    HOJE,
  );

  assert.equal(r.totalAPagar, 100);
});

test("o resumo separa os dois lados e conta os vencidos", () => {
  const r = resumirFluxo(
    [
      lanc({ valor: 300, vencimento: new Date(2026, 7, 1) }),
      lanc({ valor: 200, vencimento: HOJE }),
      lanc({
        valor: 150,
        direcao: "RECEBER",
        vencimento: new Date(2026, 7, 6),
      }),
      lanc({ valor: 80, vencimento: new Date(2026, 8, 1) }),
    ],
    HOJE,
  );

  assert.equal(r.aPagar.vencido, 300);
  assert.equal(r.aPagar.hoje, 200);
  assert.equal(r.aPagar.depois, 80);
  assert.equal(r.aReceber.semana, 150);
  assert.equal(r.totalAPagar, 580);
  assert.equal(r.saldoDoPeriodo, -430);
  assert.equal(r.contasVencidas, 1);
});

test("o saldo projetado começa no saldo real e caminha", () => {
  const dias = projetarSaldo(
    1000,
    [
      lanc({ valor: 300, vencimento: new Date(2026, 7, 5) }),
      lanc({
        valor: 500,
        direcao: "RECEBER",
        vencimento: new Date(2026, 7, 6),
      }),
    ],
    HOJE,
    4,
  );

  assert.equal(dias[0].saldo, 1000); // dia 4, sem movimento
  assert.equal(dias[1].saldo, 700); // dia 5, pagou 300
  assert.equal(dias[2].saldo, 1200); // dia 6, recebeu 500
  assert.equal(dias[3].saldo, 1200);
});

test("conta vencida entra no primeiro dia, não na data original", () => {
  // Deixá-la no passado faria o saldo de hoje parecer melhor do que é — e essa
  // é a mentira que leva alguém a comprar achando que tem dinheiro.
  const dias = projetarSaldo(
    1000,
    [lanc({ valor: 400, vencimento: new Date(2026, 6, 20) })],
    HOJE,
    3,
  );

  assert.equal(dias[0].saidas, 400);
  assert.equal(dias[0].saldo, 600);
});

test("o que vence depois da janela não entra na projeção", () => {
  const dias = projetarSaldo(
    1000,
    [lanc({ valor: 400, vencimento: new Date(2026, 9, 1) })],
    HOJE,
    5,
  );

  assert.equal(dias[4].saldo, 1000);
});

test("o resultado usa o valor QUITADO, não o combinado", () => {
  // Desconto por antecipação e juro por atraso são dinheiro real.
  const r = calcularResultado([
    {
      direcao: "PAGAR",
      valor: 1000,
      valorQuitado: 950,
      categoria: { nome: "Mercadoria", grupo: null },
    },
  ]);

  assert.equal(r.totalDespesas, 950);
});

test("o percentual é sobre a RECEITA — é assim que se lê custo", () => {
  const r = calcularResultado([
    {
      direcao: "RECEBER",
      valor: 10000,
      valorQuitado: null,
      categoria: { nome: "Salão", grupo: "Vendas" },
    },
    {
      direcao: "PAGAR",
      valor: 2800,
      valorQuitado: null,
      categoria: { nome: "Folha", grupo: "Pessoal" },
    },
  ]);

  assert.equal(r.despesas[0].percentual, 28);
  assert.equal(r.sobra, 7200);
  assert.equal(r.margem, 72);
});

test("lançamento sem categoria é separado, não jogado numa gaveta qualquer", () => {
  const r = calcularResultado([
    {
      direcao: "PAGAR",
      valor: 500,
      valorQuitado: null,
      categoria: null,
    },
  ]);

  assert.equal(r.semCategoria, 500);
  assert.equal(r.totalDespesas, 0);
});

test("sem receita não existe margem — e não se inventa uma", () => {
  const r = calcularResultado([
    {
      direcao: "PAGAR",
      valor: 500,
      valorQuitado: null,
      categoria: { nome: "Aluguel", grupo: null },
    },
  ]);

  assert.equal(r.margem, null);
  assert.equal(r.despesas[0].percentual, null);
});

test("a mesma categoria soma em uma linha só", () => {
  const r = calcularResultado([
    {
      direcao: "PAGAR",
      valor: 100,
      valorQuitado: null,
      categoria: { nome: "Energia", grupo: "Ocupação" },
    },
    {
      direcao: "PAGAR",
      valor: 250,
      valorQuitado: null,
      categoria: { nome: "Energia", grupo: "Ocupação" },
    },
  ]);

  assert.equal(r.despesas.length, 1);
  assert.equal(r.despesas[0].valor, 350);
});
