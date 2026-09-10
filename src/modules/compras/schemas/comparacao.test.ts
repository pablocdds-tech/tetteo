import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  montarGrade,
  sugerirMenorCusto,
  type ItemParaComparar,
  type OfertaParaComparar,
  type PropostaParaComparar,
} from "./comparacao";

// Todos os números aqui são FICTÍCIOS.

const CENTRO = "centro";
const SUL = "sul";

const item = (
  id: string,
  porLoja: [string, bigint][],
  resto: Partial<ItemParaComparar> = {},
): ItemParaComparar => ({
  id,
  nome: id,
  unidade: "KG",
  modo: "COTAVEL",
  porLoja: porLoja.map(([unidadeId, quantidade]) => ({ unidadeId, quantidade })),
  ...resto,
});

const oferta = (
  itemId: string,
  precoEmbalagem: bigint | null,
  fator: bigint | null = 10_000n,
  resto: Partial<OfertaParaComparar> = {},
): OfertaParaComparar => ({
  itemId,
  itemDePropostaId: `oferta-${itemId}-${precoEmbalagem}`,
  situacao: "COTADO",
  fator,
  fatorMotivo: null,
  fracionavel: false,
  precoEmbalagem,
  precoZeroAutorizado: false,
  disponivel: null,
  descricaoEmbalagem: "Caixa",
  ...resto,
});

const proposta = (
  fornecedorId: string,
  frete: bigint | null,
  ofertas: OfertaParaComparar[],
  resto: Partial<PropostaParaComparar> = {},
): PropostaParaComparar => ({
  fornecedorId,
  nome: fornecedorId,
  versao: 1,
  frete,
  minimo: null,
  prazoDias: 2,
  itensSolicitados: ofertas.map((o) => o.itemId),
  ofertas,
  ...resto,
});

const celula = (grade: ReturnType<typeof montarGrade>, itemId: string, fornecedorId: string) =>
  grade.linhas.find((l) => l.item.id === itemId)!.celulas.find(
    (c) => c.fornecedorId === fornecedorId,
  )!;

describe("a grade", () => {
  test("item de fornecedor fixo não entra na disputa", () => {
    const grade = montarGrade(
      [item("molho", [[CENTRO, 10_000n]]), item("mussarela", [[CENTRO, 10_000n]], { modo: "DIRECIONADO" })],
      [proposta("A", 0n, [oferta("molho", 3000n), oferta("mussarela", 1n)])],
    );
    assert.deepEqual(grade.linhas.map((l) => l.item.id), ["molho"]);
  });

  test("sem resposta, indisponível e zero são três estados — e nenhum vence", () => {
    const itens = [item("molho", [[CENTRO, 10_000n]])];
    const grade = montarGrade(itens, [
      proposta("A", 0n, [], { itensSolicitados: ["molho"] }),
      proposta("B", 0n, [oferta("molho", null, null, { situacao: "INDISPONIVEL" })]),
      proposta("C", 0n, [oferta("molho", 0n)]),
      proposta("D", 0n, [oferta("molho", 3100n)]),
    ]);
    assert.equal(celula(grade, "molho", "A").estado, "sem-resposta");
    assert.equal(celula(grade, "molho", "B").estado, "indisponivel");
    assert.equal(celula(grade, "molho", "C").estado, "zero-sem-autorizacao");
    assert.equal(celula(grade, "molho", "C").menorCusto, false);
    assert.equal(celula(grade, "molho", "D").menorCusto, true);
  });

  test("zero autorizado entra na disputa", () => {
    const grade = montarGrade(
      [item("molho", [[CENTRO, 10_000n]])],
      [proposta("A", 0n, [oferta("molho", 0n, 10_000n, { precoZeroAutorizado: true })])],
    );
    assert.equal(celula(grade, "molho", "A").comparavel, true);
  });

  test("fator desconhecido ou incompatível: conferir, fora da disputa", () => {
    const grade = montarGrade(
      [item("molho", [[CENTRO, 10_000n]])],
      [
        proposta("A", 0n, [oferta("molho", 3000n, null, { fatorMotivo: "litro não vira quilo" })]),
        proposta("B", 0n, [oferta("molho", 3300n)]),
      ],
    );
    const a = celula(grade, "molho", "A");
    assert.equal(a.estado, "conferir-fator");
    assert.equal(a.comparavel, false);
    assert.equal(a.fatorMotivo, "litro não vira quilo");
    assert.equal(celula(grade, "molho", "B").menorCusto, true);
  });

  test("20 kg em caixa de 12 × 900 g: 2 caixas, sobram 1,6 kg que custam R$ 14,13", () => {
    const grade = montarGrade(
      [item("molho", [[CENTRO, 20_000n]])],
      [proposta("A", 0n, [oferta("molho", 9540n, 108_000n)])],
    );
    const c = celula(grade, "molho", "A");
    assert.equal(c.embalagens, 2n);
    assert.equal(c.comprado, 21_600n);
    assert.equal(c.adicional, 1_600n);
    assert.equal(c.custo, 19_080n);
    assert.equal(c.custoAdicional, 1_413n);
    assert.equal(c.precoPorUnidade, 8_833_333n);
  });

  test("embalagem inteira é contada POR LOJA", () => {
    // 6 kg no Centro e 6 kg no Sul, caixa de 10 kg: uma caixa para cada, não
    // uma caixa e pouco para as duas.
    const grade = montarGrade(
      [item("molho", [[CENTRO, 6_000n], [SUL, 6_000n]])],
      [proposta("A", 0n, [oferta("molho", 30000n, 100_000n)])],
    );
    const c = celula(grade, "molho", "A");
    assert.equal(c.embalagens, 2n);
    assert.equal(c.custo, 60_000n);
  });

  test("disponibilidade menor que a necessidade não disputa sozinha", () => {
    const grade = montarGrade(
      [item("molho", [[CENTRO, 20_000n]])],
      [proposta("A", 0n, [oferta("molho", 3000n, 10_000n, { disponivel: 5_000n })])],
    );
    assert.equal(celula(grade, "molho", "A").estado, "disponibilidade-insuficiente");
  });

  test("granel: cada linha arredondada uma vez, e o total bate ao centavo", () => {
    const grade = montarGrade(
      [item("queijo", [[CENTRO, 6_537n]]), item("oregano", [[CENTRO, 3_333n]])],
      [
        proposta("A", 1234n, [
          oferta("queijo", 3190n, 10_000n, { fracionavel: true }),
          oferta("oregano", 1001n, 10_000n, { fracionavel: true }),
        ]),
      ],
    );
    assert.equal(celula(grade, "queijo", "A").custo, 20_853n); // 208,5303 → 208,53
    assert.equal(celula(grade, "oregano", "A").custo, 3_336n); // 33,36333 → 33,36
    const a = grade.fornecedores[0];
    assert.equal(a.subtotal, 24_189n);
    assert.equal(a.total, 24_189n + 1_234n);
  });

  test("frete não informado deixa o total desconhecido — não zero", () => {
    const grade = montarGrade(
      [item("molho", [[CENTRO, 10_000n]])],
      [proposta("A", null, [oferta("molho", 3000n)])],
    );
    assert.equal(grade.fornecedores[0].freteInformado, false);
    assert.equal(grade.fornecedores[0].total, null);
  });
});

describe("a sugestão de menor custo total", () => {
  test("o frete troca o vencedor", () => {
    // A é mais barato no item (R$ 600 × R$ 620), mas cobra R$ 80 de frete.
    const itens = [item("molho", [[CENTRO, 20_000n]])];
    const propostas = [
      proposta("A", 8000n, [oferta("molho", 30000n, 100_000n)]),
      proposta("B", 2000n, [oferta("molho", 31000n, 100_000n)]),
    ];
    const grade = montarGrade(itens, propostas);
    assert.equal(celula(grade, "molho", "A").menorCusto, true);

    const r = sugerirMenorCusto(grade, propostas);
    assert.ok(r.ok);
    assert.deepEqual(r.sugestao.fornecedores, ["B"]);
    assert.equal(r.sugestao.total, 62_000n + 2_000n);
  });

  test("concentrar num fornecedor pode vencer o 'mais barato de cada item'", () => {
    const itens = [item("molho", [[CENTRO, 10_000n]]), item("farinha", [[CENTRO, 10_000n]])];
    const propostas = [
      // A: molho mais barato; B: farinha mais barata; C: os dois, um pouco
      // mais caros, mas um frete só.
      proposta("A", 3000n, [oferta("molho", 1000n)]),
      proposta("B", 3000n, [oferta("farinha", 500n)]),
      proposta("C", 1000n, [oferta("molho", 1050n), oferta("farinha", 550n)]),
    ];
    const r = sugerirMenorCusto(montarGrade(itens, propostas), propostas);
    assert.ok(r.ok);
    // A+B = 10.000 + 5.000 + 3.000 + 3.000 = 21.000; C = 10.500 + 5.500 + 1.000 = 17.000
    assert.deepEqual(r.sugestao.fornecedores, ["C"]);
    assert.equal(r.sugestao.total, 17_000n);
  });

  test("mínimo não atendido tira a combinação", () => {
    const itens = [item("molho", [[CENTRO, 10_000n]])];
    const propostas = [
      proposta("A", 0n, [oferta("molho", 2900n)], { minimo: 50_000n }),
      proposta("B", 0n, [oferta("molho", 3100n)]),
    ];
    const r = sugerirMenorCusto(montarGrade(itens, propostas), propostas);
    assert.ok(r.ok);
    assert.deepEqual(r.sugestao.fornecedores, ["B"]);
  });

  test("ninguém atinge o mínimo: a sugestão diz, em vez de sugerir o impossível", () => {
    const itens = [item("molho", [[CENTRO, 10_000n]])];
    const propostas = [proposta("A", 0n, [oferta("molho", 2900n)], { minimo: 50_000n })];
    const r = sugerirMenorCusto(montarGrade(itens, propostas), propostas);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.motivo : "", /mínimos/);
  });

  test("fornecedor sem frete fica de fora, com o motivo", () => {
    const itens = [item("molho", [[CENTRO, 10_000n]])];
    const propostas = [
      proposta("A", null, [oferta("molho", 100n)]),
      proposta("B", 0n, [oferta("molho", 3100n)]),
    ];
    const r = sugerirMenorCusto(montarGrade(itens, propostas), propostas);
    assert.ok(r.ok);
    assert.deepEqual(r.sugestao.fornecedores, ["B"]);
    assert.deepEqual(r.sugestao.fora.map((f) => f.fornecedorId), ["A"]);
  });

  test("duas lojas: o frete é cobrado por entrega", () => {
    const itens = [item("molho", [[CENTRO, 10_000n], [SUL, 10_000n]])];
    const propostas = [proposta("A", 3000n, [oferta("molho", 30000n, 100_000n)])];
    const grade = montarGrade(itens, propostas);
    assert.equal(grade.fornecedores[0].lojasAtendidas, 2);
    assert.equal(grade.fornecedores[0].freteTotal, 6000n);
    const r = sugerirMenorCusto(grade, propostas);
    assert.ok(r.ok && r.sugestao.frete === 6000n);
  });

  test("item sem oferta comparável aparece como 'sem opção'", () => {
    const itens = [item("molho", [[CENTRO, 10_000n]]), item("oleo", [[CENTRO, 6_000n]])];
    const propostas = [proposta("A", 0n, [oferta("molho", 3000n), oferta("oleo", 900n, null)])];
    const r = sugerirMenorCusto(montarGrade(itens, propostas), propostas);
    assert.ok(r.ok);
    assert.deepEqual(r.sugestao.semOpcao, ["oleo"]);
  });
});
