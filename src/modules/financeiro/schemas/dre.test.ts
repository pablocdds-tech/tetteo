import assert from "node:assert/strict";
import { test } from "node:test";

import { montarDre, type GrupoDre, type MovimentoDre } from "./dre";

/**
 * O DRE é o número que decide se a casa fecha ou continua. Cada caso abaixo é
 * uma forma de ele mentir — e a primeira é a que quase todo sistema comete.
 */

function m(
  valor: number,
  nome: string,
  grupoDre: GrupoDre | null,
): MovimentoDre {
  return { valor, categoria: { nome, grupoDre } };
}

/** Um mês típico: R$ 100 mil de venda, CMV de R$ 30 mil. */
const MES: MovimentoDre[] = [
  m(80000, "Vendas no salão", "RECEITA"),
  m(20000, "Delivery", "RECEITA"),
  m(9000, "Taxas de cartão e apps", "DEDUCAO"),
  m(6000, "Impostos", "DEDUCAO"),
  m(28000, "Folha e encargos", "PESSOAL"),
  m(8000, "Aluguel", "OCUPACAO"),
  m(3000, "Energia, água e gás", "OCUPACAO"),
  m(2000, "Manutenção", "OPERACIONAL"),
];

test("a compra de mercadoria NÃO vira despesa — o CMV responde por ela", () => {
  // Somar as duas contaria o queijo duas vezes: comprado em julho, consumido
  // em agosto. É o erro que faz o lucro sumir de um mês e sobrar no seguinte.
  const comCompra = [...MES, m(35000, "Mercadoria", "MERCADORIA")];

  const semCompra = montarDre(MES, 30000);
  const comprou = montarDre(comCompra, 30000);

  assert.equal(comprou.resultado, semCompra.resultado);
  assert.equal(comprou.comprasIgnoradas, 35000);
  assert.equal(comprou.cmv, 30000);
});

test("a ordem da conta fecha do topo até o resultado", () => {
  const d = montarDre(MES, 30000);

  assert.equal(d.receitaBruta, 100000);
  assert.equal(d.deducoes, 15000);
  assert.equal(d.receitaLiquida, 85000);
  assert.equal(d.cmv, 30000);
  assert.equal(d.lucroBruto, 55000);
  assert.equal(d.totalDespesas, 41000);
  assert.equal(d.resultadoOperacional, 14000);
  assert.equal(d.resultado, 14000);
});

test("os percentuais são sobre a RECEITA BRUTA — é assim que o mercado lê", () => {
  const d = montarDre(MES, 30000);

  assert.equal(d.percentuais.cmv, 30);
  assert.equal(d.despesas.find((b) => b.grupo === "PESSOAL")?.percentual, 28);
  assert.equal(d.percentuais.resultado, 14);
});

test("investimento sai do caixa e não do lucro", () => {
  // Comprar um forno é trocar dinheiro por bem. Contá-lo como despesa faria o
  // mês da compra parecer um desastre.
  const d = montarDre([...MES, m(15000, "Forno novo", "INVESTIMENTO")], 30000);

  assert.equal(d.resultado, 14000);
  assert.equal(d.investimentos, 15000);
});

test("as financeiras entram depois do resultado operacional", () => {
  const d = montarDre([...MES, m(1200, "Juros", "FINANCEIRA")], 30000);

  assert.equal(d.resultadoOperacional, 14000);
  assert.equal(d.financeiras, 1200);
  assert.equal(d.resultado, 12800);
});

test("lançamento sem classificação é apontado, não escondido numa gaveta", () => {
  const d = montarDre([...MES, m(5000, "Sei lá", null)], 30000);

  assert.equal(d.semClassificacao, 5000);
  assert.equal(d.resultado, 14000);
});

test("mesma categoria em vários lançamentos vira uma linha", () => {
  const d = montarDre(
    [
      m(50000, "Vendas no salão", "RECEITA"),
      m(30000, "Vendas no salão", "RECEITA"),
    ],
    0,
  );

  assert.equal(d.blocoReceita.linhas.length, 1);
  assert.equal(d.blocoReceita.linhas[0].valor, 80000);
});

test("as linhas saem da maior para a menor", () => {
  const d = montarDre(MES, 30000);
  const ocupacao = d.despesas.find((b) => b.grupo === "OCUPACAO")!;

  assert.equal(ocupacao.linhas[0].categoria, "Aluguel");
  assert.equal(ocupacao.linhas[1].categoria, "Energia, água e gás");
});

test("mês sem receita não inventa percentual — e ainda mostra o prejuízo", () => {
  const d = montarDre([m(8000, "Aluguel", "OCUPACAO")], 0);

  assert.equal(d.percentuais.resultado, null);
  assert.equal(d.resultado, -8000);
});

test("CMV maior que a receita líquida dá lucro bruto negativo, sem disfarce", () => {
  const d = montarDre([m(10000, "Delivery", "RECEITA")], 12000);

  assert.equal(d.lucroBruto, -2000);
  assert.equal(d.percentuais.cmv, 120);
});
