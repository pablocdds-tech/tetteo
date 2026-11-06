import assert from "node:assert/strict";
import { test } from "node:test";
import {
  casarProdutoFiscal,
  casarFornecedorFiscal,
  type VinculoFiscal,
} from "./casamento";
const produtos = [
  { id: "a", nome: "Arroz tipo 1", unidadeMedida: "KG" },
  { id: "b", nome: "Arroz integral", unidadeMedida: "KG" },
];
const vinculos: VinculoFiscal[] = [
  {
    insumoId: "a",
    fornecedor: "11222333000181",
    descricao: "arroz",
    unidadeNota: "PCT",
    fator: 5,
    codigoFornecedor: "ABC",
    ean: "7894900011517",
  },
];
test("código do fornecedor e EAN só vinculam quando são únicos e concordantes", () => {
  const item = {
    descricao: "Arroz",
    unidade: "PCT",
    codigoFornecedor: "ABC",
    ean: "7894900011517",
  };
  assert.equal(
    casarProdutoFiscal(item, "11222333000181", produtos, vinculos).vinculo
      ?.insumoId,
    "a",
  );
  assert.equal(
    casarProdutoFiscal(
      { ...item, codigoFornecedor: null },
      "outro",
      produtos,
      vinculos,
    ).metodo,
    "EAN",
  );
  const ambiguos = [...vinculos, { ...vinculos[0], insumoId: "b" }];
  assert.equal(
    casarProdutoFiscal(item, "11222333000181", produtos, ambiguos).vinculo,
    null,
  );
  assert.equal(
    casarProdutoFiscal(
      { ...item, codigoFornecedor: null, ean: null },
      "outro",
      produtos,
      vinculos,
    ).vinculo,
    null,
  );
});
test("fornecedor prioriza documento válido e não troca identidade por nome", () => {
  const cadastrados = [
    {
      id: "a",
      nome: "Fornecedor",
      documento: "11.222.333/0001-81",
      ativo: true,
    },
  ];
  assert.equal(
    casarFornecedorFiscal("11222333000181", "Nome diferente", cadastrados).id,
    "a",
  );
  assert.equal(
    casarFornecedorFiscal("11111111111111", "Fornecedor", cadastrados).estado,
    "INVALIDO",
  );
  assert.equal(
    casarFornecedorFiscal(undefined, "Fornecedor", cadastrados).estado,
    "SEM_DOCUMENTO",
  );
  assert.equal(
    casarFornecedorFiscal("11444777000161", "Fornecedor", cadastrados).estado,
    "DIVERGENTE",
  );
});
test("troca de embalagem e código reutilizado com outro EAN exigem conferência", () => {
  const item = {
    descricao: "ARROZ FARDO 10KG",
    unidade: "PCT",
    codigoFornecedor: "ABC",
    ean: "7894900011517",
  };
  assert.equal(
    casarProdutoFiscal(item, "11222333000181", produtos, vinculos)
      .confirmarConversao,
    true,
  );
  assert.equal(
    casarProdutoFiscal(
      { ...item, ean: "7891000315507" },
      "11222333000181",
      produtos,
      vinculos,
    ).vinculo,
    null,
  );
  assert.equal(
    casarProdutoFiscal(
      { ...item, unidade: "CX" },
      "11222333000181",
      produtos,
      vinculos,
    ).vinculo,
    null,
  );
});
test("descrição exata já confirmada conserva conversão somente no mesmo fornecedor e unidade", () => {
  const item = { descricao: "Arroz", unidade: "PCT" };
  const r = casarProdutoFiscal(item, "11222333000181", produtos, vinculos);
  assert.equal(r.metodo, "DESCRICAO_CONFIRMADA");
  assert.equal(r.vinculo?.fator, 5);
  assert.equal(r.confirmarConversao, false);
  assert.equal(
    casarProdutoFiscal(
      { ...item, descricao: "Arroz 10kg" },
      "11222333000181",
      produtos,
      vinculos,
    ).vinculo,
    null,
  );
  assert.equal(
    casarProdutoFiscal(item, "outro", produtos, vinculos).vinculo,
    null,
  );
  assert.equal(
    casarProdutoFiscal(item, "11222333000181", produtos, [
      ...vinculos,
      { ...vinculos[0], fator: 10 },
    ]).vinculo,
    null,
  );
});
