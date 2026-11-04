import assert from "node:assert/strict";
import { test } from "node:test";
import { digitoChaveFiscal } from "@/lib/documento-fiscal";
import {
  extracaoVazia,
  confiancas,
  confiancasDoItem,
  validarExtracaoFiscal,
  valoresLiquidos,
  extracaoFiscalSchema,
} from "./extracao";
const base = "3526111122233300018155001000000123112345678";
const nota = () => ({
  ...extracaoVazia(),
  cnpj_emitente: "11222333000181",
  razao_social: "Fornecedor fictício",
  data_emissao: "2026-11-04",
  numero: "123",
  serie: "1",
  chave_acesso: base + digitoChaveFiscal(base),
  itens: [
    {
      descricao: "Arroz",
      quantidade: 2,
      unidade: "PCT",
      valor_unitario: 5,
      valor_total: 10,
      codigo_ean: null,
      codigo_fornecedor: null,
      confianca: confiancasDoItem(1),
    },
    {
      descricao: "Feijão",
      quantidade: 1,
      unidade: "PCT",
      valor_unitario: 5,
      valor_total: 5,
      codigo_ean: null,
      codigo_fornecedor: null,
      confianca: confiancasDoItem(1),
    },
  ],
  descontos: 1,
  acrescimos: 0,
  total_nota: 14,
  confianca: confiancas(1),
});
test("totais incluem descontos e rateio conserva os centavos e a transcrição", () => {
  const d = nota();
  assert.deepEqual(validarExtracaoFiscal(d), []);
  assert.deepEqual(valoresLiquidos(d), [9.33, 4.67]);
  assert.equal(d.itens[0].valor_total, 10);
  assert.equal(
    valoresLiquidos(d).reduce((a, b) => a + Math.round(b * 100), 0),
    1400,
  );
});
test("quantidade errada, chave divergente e confiança baixa impedem proposta pronta", () => {
  const d = nota();
  d.itens[0].quantidade = 20;
  assert.ok(
    validarExtracaoFiscal(d).some((p) => p.codigo === "ITEM_DIVERGENTE"),
  );
  d.itens[0].quantidade = 2;
  d.numero = "999";
  assert.ok(
    validarExtracaoFiscal(d).some((p) => p.codigo === "CHAVE_DIVERGENTE"),
  );
  d.numero = "123";
  d.itens[0].confianca.quantidade = 0.5;
  assert.ok(
    validarExtracaoFiscal(d).some((p) => p.codigo === "BAIXA_CONFIANCA"),
  );
});
test("campos ilegíveis permanecem null e conteúdo fora do contrato é rejeitado", () => {
  const d = extracaoVazia();
  assert.equal(extracaoFiscalSchema.parse(d).total_nota, null);
  assert.ok(validarExtracaoFiscal(d).length > 0);
  assert.equal(
    extracaoFiscalSchema.safeParse({ ...d, confirmar: true }).success,
    false,
  );
});
