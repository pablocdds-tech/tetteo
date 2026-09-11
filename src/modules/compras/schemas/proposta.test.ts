import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validarResposta, type RespostaBruta } from "./proposta";

const item = (
  id: string,
  resto: Partial<RespostaBruta["itens"][number]> = {},
): RespostaBruta["itens"][number] => ({
  itemDaSolicitacaoId: id,
  situacao: "COTADO",
  nomeEmbalagem: "Caixa",
  pecas: "12",
  conteudo: "900",
  unidadeConteudo: "G",
  fracionavel: false,
  precoEmbalagem: "95,40",
  disponivel: "",
  observacao: "",
  ...resto,
});

const resposta = (
  itens: RespostaBruta["itens"],
  resto: Partial<RespostaBruta> = {},
) => ({
  frete: "",
  pedidoMinimo: "",
  prazoEntregaDias: "",
  validaAte: "",
  observacao: "",
  itens,
  ...resto,
});

describe("resposta do fornecedor", () => {
  test("lê a embalagem pelas partes e o preço em centavos", () => {
    const r = validarResposta(resposta([item("a")]), { permitirZero: false });
    assert.ok(r.ok);
    const [oferta] = r.resposta.ofertas;
    assert.equal(oferta.pecas, 12);
    assert.equal(oferta.conteudo, 9_000_000n);
    assert.equal(oferta.unidadeConteudo, "G");
    assert.equal(oferta.precoEmbalagem, 9540n);
  });

  test("sem resposta não é gravado; indisponível é", () => {
    const r = validarResposta(
      resposta([
        item("a", { situacao: "SEM_RESPOSTA" }),
        item("b", { situacao: "INDISPONIVEL", precoEmbalagem: "" }),
      ]),
      { permitirZero: false },
    );
    assert.ok(r.ok);
    assert.deepEqual(
      r.resposta.ofertas.map((o) => [o.itemDaSolicitacaoId, o.situacao]),
      [["b", "INDISPONIVEL"]],
    );
    assert.equal(r.resposta.ofertas[0].precoEmbalagem, null);
  });

  test("preço zero pelo link é recusado", () => {
    const r = validarResposta(resposta([item("a", { precoEmbalagem: "0" })]), {
      permitirZero: false,
    });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.erros["preco:a"] : "", /zero não é aceito/);
  });

  test("preço zero pelo comprador, com autorização, passa", () => {
    const r = validarResposta(resposta([item("a", { precoEmbalagem: "0" })]), {
      permitirZero: true,
    });
    assert.ok(r.ok);
    assert.equal(r.resposta.ofertas[0].precoEmbalagem, 0n);
  });

  test("cotado sem preço pede o preço", () => {
    const r = validarResposta(resposta([item("a", { precoEmbalagem: "" })]), {
      permitirZero: false,
    });
    assert.match(!r.ok ? r.erros["preco:a"] : "", /Informe o preço/);
  });

  test("frete vazio é 'não informado'; frete zero é frete zero", () => {
    const vazio = validarResposta(resposta([item("a")]), {
      permitirZero: false,
    });
    assert.ok(vazio.ok && vazio.resposta.frete === null);
    const zero = validarResposta(resposta([item("a")], { frete: "0" }), {
      permitirZero: false,
    });
    assert.ok(zero.ok && zero.resposta.frete === 0n);
  });

  test("conteúdo sem unidade é recusado", () => {
    const r = validarResposta(
      resposta([item("a", { conteudo: "900", unidadeConteudo: "" })]),
      { permitirZero: false },
    );
    assert.match(!r.ok ? r.erros["conteudo:a"] : "", /unidade do conteúdo/);
  });

  test("item repetido é recusado", () => {
    const r = validarResposta(resposta([item("a"), item("a")]), {
      permitirZero: false,
    });
    assert.equal(r.ok, false);
  });

  test("preço ambíguo é recusado com explicação", () => {
    const r = validarResposta(
      resposta([item("a", { precoEmbalagem: "1.200" })]),
      {
        permitirZero: false,
      },
    );
    assert.match(!r.ok ? r.erros["preco:a"] : "", /vírgula/);
  });

  test("formato estranho não passa", () => {
    const r = validarResposta({ itens: "tudo" }, { permitirZero: false });
    assert.equal(r.ok, false);
  });
});
