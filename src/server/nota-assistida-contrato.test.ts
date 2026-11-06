import assert from "node:assert/strict";
import { test } from "node:test";
import { notaAssistidaPronta } from "./nota-assistida-contrato";

function proposta() {
  return {
    operacaoId: "operacao-ficticia",
    numero: "123",
    fornecedor: {
      nome: "Fornecedor fictício",
      documento: "11.222.333/0001-81",
    },
    emitidaEm: "2026-11-04",
    recebidaEm: "2026-11-04",
    localId: "local",
    empresaId: "empresa",
    categoriaId: "categoria",
    valorTotal: 0.3,
    itens: [
      {
        descricao: "Item A",
        insumoId: "a",
        quantidade: 1,
        fatorConversao: 1,
        valorTotal: 0.1,
      },
      {
        descricao: "Item B",
        insumoId: "b",
        quantidade: 1,
        fatorConversao: 1,
        valorTotal: 0.2,
      },
    ],
    pagamento: {
      situacao: "A_PAGAR",
      forma: "BOLETO",
      parcelas: [{ vencimento: "2026-11-20", valor: 0.3 }],
    },
  };
}

test("centavos conferem sem erro de ponto flutuante e documento é normalizado", () => {
  const dados = notaAssistidaPronta.parse(proposta());
  assert.equal(dados.fornecedor.documento, "11222333000181");
});

test("total da nota e parcelas precisam conferir antes de qualquer lançamento", () => {
  const nota = proposta();
  assert.equal(
    notaAssistidaPronta.safeParse({ ...nota, valorTotal: 0.31 }).success,
    false,
  );
  assert.equal(
    notaAssistidaPronta.safeParse({
      ...nota,
      pagamento: {
        ...nota.pagamento,
        parcelas: [{ vencimento: "2026-11-20", valor: 0.29 }],
      },
    }).success,
    false,
  );
  assert.equal(
    notaAssistidaPronta.safeParse({ ...nota, valorTotal: 1e25 }).success,
    false,
  );
});

test("paga exige conta e data explícitas e a pagar não aceita data de pagamento", () => {
  const nota = proposta();
  const paga = { ...nota, pagamento: { ...nota.pagamento, situacao: "PAGA" } };
  assert.equal(notaAssistidaPronta.safeParse(paga).success, false);
  assert.equal(
    notaAssistidaPronta.safeParse({
      ...paga,
      pagamento: {
        ...paga.pagamento,
        contaId: "caixa",
        dataPagamento: "2026-11-04",
      },
    }).success,
    true,
  );
  assert.equal(
    notaAssistidaPronta.safeParse({
      ...nota,
      pagamento: { ...nota.pagamento, dataPagamento: "2026-11-04" },
    }).success,
    false,
  );
});

test("datas impossíveis, precisão indevida e unidade ambígua são recusadas", () => {
  const nota = proposta();
  for (const emitidaEm of ["2026-02-30", "04/11/2026", "2026-11-04T00:00:00Z"])
    assert.equal(
      notaAssistidaPronta.safeParse({ ...nota, emitidaEm }).success,
      false,
    );
  assert.equal(
    notaAssistidaPronta.safeParse({
      ...nota,
      itens: [{ ...nota.itens[0], valorTotal: 0.301 }],
    }).success,
    false,
  );
  assert.equal(
    notaAssistidaPronta.safeParse({
      ...nota,
      itens: [
        { ...nota.itens[0], novoInsumo: { nome: "Novo", unidadeMedida: "UN" } },
      ],
    }).success,
    false,
  );
  assert.equal(
    notaAssistidaPronta.safeParse({
      ...nota,
      itens: [
        {
          ...nota.itens[0],
          insumoId: undefined,
          novoInsumo: { nome: "Novo", unidadeMedida: "CX" },
        },
      ],
    }).success,
    false,
  );
});

test("documento sem número e sem chave fica pendente para evitar duplicação", () => {
  const nota = { ...proposta(), numero: undefined };
  assert.equal(notaAssistidaPronta.safeParse(nota).success, false);
  assert.equal(
    notaAssistidaPronta.safeParse({ ...nota, chaveAcesso: "1".repeat(44) })
      .success,
    false,
  );
});
