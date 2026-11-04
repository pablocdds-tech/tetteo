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
