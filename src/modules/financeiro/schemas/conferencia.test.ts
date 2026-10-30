import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calcularTaxa,
  conciliar,
  csvSeguro,
  periodoBancoSchema,
  periodoSchema,
  type Cobertura,
  type Contrato,
  type LinhaMotor,
} from "./conferencia";
import { interpretar, lerCsv, reaisEmCentavos } from "./importacao-conferencia";

const escopo = { organizacaoId: "org-demo", unidadeId: "loja-demo" };
const cobertura: Cobertura = Object.fromEntries(
  ["VENDA", "ADQUIRENTE", "BANCO"].map((f) => [
    f,
    { completa: true, de: "2026-10-19", ate: "2026-10-20", importacoes: [f] },
  ]),
) as Cobertura;
function fixture() {
  const comum = {
    ...escopo,
    provider: "DEMO",
    merchantRef: "est-demo",
    accountRef: "conta-demo",
    businessDay: "2026-10-19",
    method: "CREDIT",
    brand: "VISA",
    installments: 1,
    adjustmentCents: 0,
    nsu: "1001",
  };
  const linhas: LinhaMotor[] = [
    {
      ...comum,
      id: "v1",
      fonte: "VENDA",
      externalId: "v1",
      grossCents: 125000,
      status: "COMPLETED",
    },
    {
      ...comum,
      id: "a1",
      fonte: "ADQUIRENTE",
      grossCents: 125000,
      feeCents: 4375,
      netCents: 120625,
      status: "SETTLED",
      payoutRef: "lote-1",
      expectedSettlementDay: "2026-10-20",
    },
    {
      ...comum,
      id: "b1",
      fonte: "BANCO",
      businessDay: "2026-10-20",
      amountCents: 120625,
      direction: "CREDIT",
      status: "SETTLED",
      payoutRef: "lote-1",
    },
  ];
  const contratos: Contrato[] = [
    {
      id: "contrato-1",
      versao: 1,
      provedor: "DEMO",
      estabelecimento: "est-demo",
      bandeira: "VISA",
      metodo: "CREDIT",
      parcelasDe: 1,
      parcelasAte: 48,
      de: "2026-01-01",
      ate: null,
      taxaBps: 300,
      fixaCentavos: 0,
      toleranciaCentavos: 0,
    },
  ];
  return {
    ...escopo,
    linhas,
    contratos,
    cobertura: structuredClone(cobertura),
  };
}
test("somente a janela bancária expandida admite até 730 dias", () => {
  const de = "2024-01-01";
  const dia = (dias: number) =>
    new Date(Date.parse(de) + dias * 86400000).toISOString().slice(0, 10);
  assert.ok(periodoSchema.safeParse({ de, ate: dia(366) }).success);
  assert.equal(periodoSchema.safeParse({ de, ate: dia(367) }).success, false);
  assert.ok(periodoBancoSchema.safeParse({ de, ate: dia(730) }).success);
  for (const ate of [dia(731), "2023-12-31", "2024-02-30"])
    assert.equal(periodoBancoSchema.safeParse({ de, ate }).success, false);
});
test("R$ 1.250: taxa prevista 37,50, cobrada 43,75 e diferença 6,25 apesar do banco", () => {
  const r = conciliar(fixture());
  assert.equal(r.resultados[0].estado, "FEE_DIFFERENCE");
  assert.equal(r.resultados[0].taxaPrevistaCentavos, 3750);
  assert.equal(r.resultados[0].diferencaTaxaCentavos, 625);
  assert.equal(r.resultados[0].creditoAlocadoCentavos, 120625);
  assert.deepEqual(
    [
      r.totais.vendidoCentavos,
      r.totais.previstoCentavos,
      r.totais.liquidadoCentavos,
      r.totais.creditadoCentavos,
    ],
    [125000, 121250, 120625, 120625],
  );
});
test("execução determinística não altera fontes", () => {
  const f = fixture();
  const copia = structuredClone(f);
  assert.deepEqual(conciliar(f), conciliar(f));
  assert.deepEqual(f, copia);
});
test("crédito de lote sem venda permanece rastreável sem alocar receita", () => {
  const f = fixture();
  f.linhas = f.linhas.filter((l) => l.fonte !== "VENDA");
  const r = conciliar(f);
  assert.equal(r.lotes[0].bancoId, "b1");
  assert.equal(r.totais.creditadoCentavos, 120625);
  assert.equal(r.totais.vendidoCentavos, 0);
  assert.ok(r.resultados.some((v) => v.bancoIds.includes("b1")));
  assert.ok(r.resultados.every((v) => v.estado === "UNMATCHED"));
  assert.equal(
    r.resultados.reduce((s, v) => s + v.creditoAlocadoCentavos, 0),
    0,
  );
});
test("crédito nunca desaparece quando a venda sai antes da etapa bancária", () => {
  for (const mudanca of [
    { status: "CANCELLED" as const },
    { grossCents: 124999 },
    { terminalRef: "contraditorio" },
  ]) {
    const f = fixture();
    f.linhas[1].terminalRef = "terminal-original";
    Object.assign(f.linhas[0], mudanca);
    const r = conciliar(f);
    assert.ok(r.resultados.some((v) => v.bancoIds.includes("b1")));
    assert.equal(r.totais.creditadoCentavos, 120625);
    assert.equal(
      r.resultados.reduce((s, v) => s + v.creditoAlocadoCentavos, 0),
      0,
    );
  }
});
test("NSU em outra organização ou loja não entra no motor", () => {
  for (const campo of ["unidadeId", "organizacaoId"] as const) {
    const f = fixture();
    f.linhas[1][campo] = "outra";
    assert.throws(() => conciliar(f), /Escopo/);
  }
});
test("NSU duplicado em qualquer lado abre ambiguidade", () => {
  for (const i of [0, 1]) {
    const f = fixture();
    f.linhas.push({ ...f.linhas[i], id: "outra" });
    assert.equal(conciliar(f).resultados[0].estado, "AMBIGUOUS");
  }
});
test("mesmo NSU em outro dia não é chave forte", () => {
  const f = fixture();
  f.linhas[1].businessDay = "2026-10-18";
  assert.equal(conciliar(f).resultados[0].estado, "WAITING_ACQUIRER");
});
test("valor/data apenas sugerem; terminal contraditório não confirma", () => {
  const f = fixture();
  delete f.linhas[0].nsu;
  assert.equal(conciliar(f).resultados[0].estado, "POSSIBLE_MATCH");
  const g = fixture();
  g.linhas[0].terminalRef = "t1";
  g.linhas[1].terminalRef = "t2";
  assert.equal(conciliar(g).resultados[0].estado, "AMBIGUOUS");
});
test("referência do lote, data e conta bancária são obrigatórias", () => {
  for (const mudanca of [
    { accountRef: "outra-conta" },
    { direction: "DEBIT" as const },
    { businessDay: "2026-10-21" },
    { payoutRef: undefined },
  ]) {
    const f = fixture();
    Object.assign(f.linhas[2], mudanca);
    assert.equal(conciliar(f).resultados[0].estado, "WAITING_BANK");
  }
});
test("créditos iguais preservados abrem ambiguidade, sem deduplicação por valor", () => {
  const f = fixture();
  f.linhas.push({ ...f.linhas[2], id: "b2" });
  assert.equal(conciliar(f).resultados[0].estado, "AMBIGUOUS_BANK");
});
test("contrato ausente não vira taxa zero", () => {
  const f = fixture();
  f.contratos = [];
  const r = conciliar(f);
  assert.equal(r.resultados[0].estado, "FEE_UNKNOWN");
  assert.equal(r.totais.previstoCentavos, null);
});
test("vigência, bandeira e parcelas entram no contrato", () => {
  for (const mudanca of [
    { de: "2026-10-20" },
    { bandeira: "ELO" },
    { parcelasDe: 2 },
  ]) {
    const f = fixture();
    Object.assign(f.contratos[0], mudanca);
    assert.equal(conciliar(f).resultados[0].taxaPrevistaCentavos, null);
  }
});
test("tolerância preserva diferença e não esconde centavos", () => {
  const f = fixture();
  f.contratos[0].toleranciaCentavos = 625;
  const r = conciliar(f).resultados[0];
  assert.equal(r.estado, "RECONCILED");
  assert.equal(r.diferencaTaxaCentavos, 625);
  assert.ok(r.notas.some((n) => n.includes("tolerância")));
});
test("arquivo parcial impede fechar período mesmo quando valores batem", () => {
  const f = fixture();
  f.contratos[0].toleranciaCentavos = 625;
  f.cobertura.BANCO.completa = false;
  assert.equal(conciliar(f).resultados[0].estado, "SOURCE_PARTIAL");
});
test("chargeback não entra na liquidação nem vira receita bancária", () => {
  const f = fixture();
  f.linhas[1].status = "CHARGEBACK";
  const r = conciliar(f);
  assert.equal(r.resultados[0].estado, "CHARGEBACK");
  assert.equal(r.totais.liquidadoCentavos, 0);
});
test("lote de duas vendas usa crédito integral uma vez e distribui componentes", () => {
  const f = fixture();
  f.linhas.push(
    { ...f.linhas[0], id: "v2", externalId: "v2", nsu: "1002" },
    { ...f.linhas[1], id: "a2", nsu: "1002" },
  );
  f.linhas[2].amountCents = 241250;
  const r = conciliar(f);
  assert.equal(r.lotes.length, 1);
  assert.equal(r.lotes[0].liquidoCentavos, 241250);
  assert.equal(r.lotes[0].bancoId, "b1");
  assert.equal(r.totais.creditadoCentavos, 241250);
  assert.equal(r.resultados.filter((v) => !v.vendaId).length, 0);
  assert.equal(
    r.resultados
      .filter((v) => v.vendaId)
      .reduce((s, v) => s + v.creditoAlocadoCentavos, 0),
    241250,
  );
});
test("parcelas completas casam; parcela repetida ou faltante abre ambiguidade", () => {
  const f = fixture();
  f.linhas[0].installments = 2;
  Object.assign(f.linhas[1], {
    installments: 2,
    installmentNumber: 1,
    grossCents: 62500,
    feeCents: 2000,
    netCents: 60500,
  });
  f.linhas.push({
    ...f.linhas[1],
    id: "a2",
    installmentNumber: 2,
    feeCents: 2375,
    netCents: 60125,
  });
  assert.equal(conciliar(f).resultados[0].estado, "FEE_DIFFERENCE");
  f.linhas[3].installmentNumber = 1;
  assert.equal(conciliar(f).resultados[0].estado, "AMBIGUOUS");
});
test("arredondamento monetário usa inteiro e meio centavo para cima", () => {
  assert.equal(calcularTaxa(1, 5000, 0), 1);
  assert.equal(calcularTaxa(125000, 300, 0), 3750);
});
test("lote inclui componentes de vendas fora do período sem somá-las como vendas do período", () => {
  const f = fixture();
  const outro = {
    ...f.linhas[1],
    id: "fora-do-periodo",
    businessDay: "2026-10-18",
    nsu: "1002",
  };
  f.linhas[2].amountCents = 241250;
  const r = conciliar({ ...f, componentesLote: [outro] });
  assert.equal(r.lotes[0].liquidoCentavos, 241250);
  assert.equal(r.lotes[0].componentes.length, 2);
  assert.equal(r.resultados[0].creditoAlocadoCentavos, 120625);
  assert.equal(r.totais.vendidoCentavos, 125000);
  assert.equal(r.totais.liquidadoCentavos, 120625);
});
test("exportação neutraliza fórmulas com espaços, tabulações e aspas", () => {
  for (const v of ["=HYPERLINK(x)", " \t+cmd", "@x", "-1+2"])
    assert.ok(csvSeguro(v).startsWith("\"'"));
  assert.equal(csvSeguro('a"b'), '"a""b"');
});

const config = {
  fonte: "BANCO" as const,
  contaRef: "conta-demo",
  de: "2026-10-19",
  ate: "2026-10-20",
  separador: ";" as const,
  moeda: "BRL" as const,
  formatoData: "ISO" as const,
};
const banco = {
  provider: "DEMO",
  merchantRef: "est-demo",
  businessDay: "2026-10-20",
  amountCents: 100,
  direction: "DEBIT",
};
test("duas tarifas legítimas iguais continuam duas", () => {
  const r = interpretar(
    Buffer.from(JSON.stringify([banco, banco])),
    "extrato.json",
    config,
    "America/Sao_Paulo",
  );
  assert.equal(r.aceitas, 2);
  assert.equal(r.linhas.length, 2);
  assert.notEqual(r.linhas[0].numero, r.linhas[1].numero);
});
test("parser põe inválidos em quarentena e reporta motivo", () => {
  const r = interpretar(
    Buffer.from(JSON.stringify([banco, { ...banco, amountCents: 1.5 }])),
    "extrato.json",
    config,
    "America/Sao_Paulo",
  );
  assert.equal(r.aceitas, 1);
  assert.equal(r.rejeitadas, 1);
  assert.ok(r.linhas[1].erros.length);
});
test("parser preserva horário original e calcula dia na loja", () => {
  const r = interpretar(
    Buffer.from(
      JSON.stringify([
        {
          ...banco,
          businessDay: undefined,
          occurredAt: "2026-10-20T01:00:00Z",
        },
      ]),
    ),
    "extrato.json",
    config,
    "America/Sao_Paulo",
  );
  assert.equal(r.linhas[0].normalizado?.businessDay, "2026-10-19");
  assert.equal(r.linhas[0].normalizado?.occurredAt, "2026-10-20T01:00:00Z");
});
test("conta contraditória, data impossível e cabeçalho duplicado são recusados", () => {
  for (const mudanca of [
    { accountRef: "outra" },
    { businessDay: "2026-02-31" },
  ]) {
    const r = interpretar(
      Buffer.from(JSON.stringify([{ ...banco, ...mudanca }])),
      "b.json",
      config,
      "America/Sao_Paulo",
    );
    assert.equal(r.rejeitadas, 1);
  }
  assert.throws(
    () =>
      interpretar(
        Buffer.from("dia;businessDay\na;b"),
        "b.csv",
        config,
        "America/Sao_Paulo",
      ),
    /mesmo campo/,
  );
});
test("CSV lê vírgula decimal, aspas, quebras e linha vazia", () => {
  assert.deepEqual(lerCsv('a;b\n"linha\nsegunda";"a""b"', ";"), [
    ["a", "b"],
    ["linha\nsegunda", 'a"b'],
  ]);
  assert.equal(reaisEmCentavos("R$ 1.250,00"), 125000);
  assert.throws(() => reaisEmCentavos("1.25"));
  assert.throws(() => lerCsv('a;"sem fechar', ";"));
});
test("centavos em decimal e CSV sem linhas não são aceitos", () => {
  assert.throws(() =>
    interpretar(
      Buffer.from("provider;merchantRef"),
      "b.csv",
      config,
      "America/Sao_Paulo",
    ),
  );
  const r = interpretar(
    Buffer.from(
      "provider;merchantRef;dia;valor_centavos;direcao\nDEMO;est-demo;2026-10-20;1.50;DEBIT\n",
    ),
    "b.csv",
    config,
    "America/Sao_Paulo",
  );
  assert.equal(r.rejeitadas, 1);
});
