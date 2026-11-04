import assert from "node:assert/strict";
import { test } from "node:test";

import { notaAssistidaPronta } from "@/server/nota-assistida-contrato";
import {
  confirmacaoVigente,
  dataConferencia,
  hashPropostaNota,
  prepararConferencia,
  propostaDaConferencia,
  responderConferencia,
  resumoConferencia,
  type CatalogoNota,
  type RascunhoNota,
} from "./conferencia-nota";

const catalogo: CatalogoNota = {
  unidade: "Centro",
  empresas: [{ nome: "Empresa", valor: "empresa" }],
  categorias: [{ nome: "Mercadoria", valor: "categoria" }],
  locais: [{ nome: "Depósito", valor: "local" }],
  contas: [{ nome: "Caixa", valor: "conta", empresaId: "empresa" }],
  insumos: [{ id: "queijo", nome: "Mussarela", unidadeMedida: "KG" }],
  podeCriarInsumo: true,
};
function rascunho(): RascunhoNota {
  return {
    operacaoId: "nota",
    fornecedor: { nome: "Fornecedor" },
    numero: "123",
    emitidaEm: "2026-11-04",
    recebidaEm: "2026-11-04",
    valorTotal: 40,
    itens: [
      { descricao: "Mussarela", quantidade: 2, unidade: "KG", valorTotal: 40 },
    ],
    pagamento: {},
  };
}
function pronta() {
  const r = rascunho();
  r.pagamento = {
    situacao: "A_PAGAR",
    forma: "BOLETO",
    parcelas: [{ vencimento: "2026-12-04", valor: 40 }],
  };
  assert.equal(prepararConferencia(r, catalogo), null);
  return r;
}
test("não presume quitação nem vencimento pela presença de nota", () => {
  const r = rascunho();
  const p = prepararConferencia(r, catalogo)!;
  assert.equal(p.campo, "situacao");
  responderConferencia(r, p, "2", catalogo);
  assert.equal(prepararConferencia(r, catalogo)!.campo, "forma");
});
test("faz conversão conhecida de gramas e pede conteúdo de caixa desconhecida", () => {
  const r = rascunho();
  r.itens[0].unidade = "G";
  r.itens[0].quantidade = 2000;
  prepararConferencia(r, catalogo);
  assert.equal(r.itens[0].fatorConversao, 0.001);
  delete r.itens[0].fatorConversao;
  r.itens[0].unidade = "CX";
  assert.equal(prepararConferencia(r, catalogo)!.campo, "fator");
});
test("exige número fiscal quando a foto não trouxe identificador", () => {
  const r = rascunho();
  delete r.numero;
  assert.equal(prepararConferencia(r, catalogo)!.campo, "numero");
});
test("correção de total invalida parcelas antigas e exige valores conferidos", () => {
  const r = pronta();
  responderConferencia(r, null, "CORRIGIR TOTAL 35,00", catalogo);
  assert.equal(r.valorTotal, 35);
  assert.equal(r.pagamento.parcelas, undefined);
  assert.equal(prepararConferencia(r, catalogo)!.campo, "parcelas");
});
test("não libera proposta cujos itens e parcelas não fecham com o total", () => {
  const r = pronta();
  r.itens[0].valorTotal = 39;
  assert.equal(prepararConferencia(r, catalogo)!.campo, "conferencia");
});
test("trocar item permite desfazer até correspondência exata", () => {
  const r = pronta();
  responderConferencia(r, null, "TROCAR ITEM 1", catalogo);
  assert.equal(prepararConferencia(r, catalogo)!.campo, "insumo");
});
test("escolhas são as opções da pergunta persistida, não posições novas do catálogo", () => {
  const r = rascunho();
  r.itens[0].descricao = "Queijo embalado";
  const p = prepararConferencia(r, catalogo)!;
  assert.equal(p.campo, "insumo");
  responderConferencia(r, p, "1", catalogo);
  assert.equal(p.campo, "unidadeNova");
  responderConferencia(r, p, "1", catalogo);
  assert.equal(r.itens[0].novoInsumo?.unidadeMedida, "KG");
});
test("revogação do cadastro de itens novos impede proposta pendente", () => {
  const r = pronta();
  delete r.itens[0].insumoId;
  r.itens[0].novoInsumo = { nome: "Outra mussarela", unidadeMedida: "KG" };
  const p = prepararConferencia(r, { ...catalogo, podeCriarInsumo: false });
  assert.equal(r.itens[0].novoInsumo, undefined);
  // O nome original ainda corresponde ao cadastro existente, sem criar outro.
  assert.equal(p, null);
  assert.equal(r.itens[0].insumoId, "queijo");
});
test("paga exige conta da mesma empresa e data explícita", () => {
  const r = pronta();
  r.pagamento = { situacao: "PAGA", forma: "PIX" };
  assert.equal(prepararConferencia(r, catalogo)!.campo, "dataPagamento");
  assert.equal(r.pagamento.contaId, "conta");
  responderConferencia(
    r,
    { campo: "dataPagamento", texto: "" },
    "04/11/2026",
    catalogo,
  );
  assert.equal(prepararConferencia(r, catalogo), null);
  assert.deepEqual(r.pagamento.parcelas, [
    { vencimento: "2026-11-04", valor: 40 },
  ]);
});
test("datas inválidas e parcela incompleta não são aceitas", () => {
  assert.equal(dataConferencia("31/02/2026"), null);
  assert.equal(dataConferencia("04/11/2026"), "2026-11-04");
  const r = rascunho();
  const p = { campo: "parcelas", texto: "" };
  assert.ok(responderConferencia(r, p, "10/11/2026 20; inventar", catalogo));
  assert.equal(r.pagamento.parcelas, undefined);
});
test("código vincula o conteúdo conferido, validade e mensagem posterior ao resumo", () => {
  const proposta = notaAssistidaPronta.parse(propostaDaConferencia(pronta()));
  const d = {
    texto: "CONFIRMAR ABC123",
    codigo: "ABC123",
    resumoEm: new Date("2026-11-04T10:00:00Z"),
    expiraEm: new Date("2026-11-04T10:30:00Z"),
    recebidoEm: new Date("2026-11-04T10:01:00Z"),
    agora: new Date("2026-11-04T10:02:00Z"),
    hash: hashPropostaNota(proposta),
    proposta,
  };
  assert.equal(confirmacaoVigente(d), true);
  assert.equal(confirmacaoVigente({ ...d, texto: "confirmo" }), false);
  assert.equal(confirmacaoVigente({ ...d, recebidoEm: d.resumoEm }), false);
  assert.equal(confirmacaoVigente({ ...d, agora: d.expiraEm }), false);
  assert.equal(
    confirmacaoVigente({ ...d, proposta: { ...proposta, numero: "124" } }),
    false,
  );
});
test("resumo mostra itens, unidade, total, local e todas as parcelas", () => {
  const r = pronta();
  const s = resumoConferencia(r, catalogo);
  for (const trecho of [
    "Mussarela",
    "Centro",
    "Depósito",
    "40,00",
    "04/12/2026",
  ])
    assert.ok(s.includes(trecho));
});

test("confirmação mostra nome do cadastro que receberá o item da nota", () => {
  const r = pronta();
  const c = {
    ...catalogo,
    insumos: [{ id: "queijo", nome: "Muçarela ralada", unidadeMedida: "KG" }],
  };
  assert.ok(resumoConferencia(r, c).includes("KG de Muçarela ralada"));
});
