import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizarPem, normalizarTransacao } from "./normalizar";
const bruto = {
  idTransacao: "pix-1",
  dataTransacao: "2026-11-10",
  dataInclusao: "2026-11-11",
  tipoOperacao: "D",
  tipoTransacao: "PIX",
  valor: "500.00",
  descricao: "Pagamento",
  detalhes: {
    nomePagador: "Minha empresa",
    cpfCnpjPagador: "11222333000181",
    nomeRecebedor: "Fornecedor",
    cpfCnpjRecebedor: "44555666000190",
  },
};
test("contrato oficial usa dataTransacao e contraparte do lado correto", () => {
  const t = normalizarTransacao(bruto, "conta1", "11222333000181");
  assert.equal(t.data, "2026-11-10");
  assert.equal(t.documento, "44555666000190");
  assert.equal(t.nome, "Fornecedor");
  const credito = normalizarTransacao(
    { ...bruto, tipoOperacao: "C" },
    "conta1",
    "44555666000190",
  );
  assert.equal(credito.documento, "11222333000181");
  assert.equal(credito.direcao, "RECEBER");
});
test("descarta documento e nome da própria empresa", () => {
  const t = normalizarTransacao(bruto, "conta1", "44555666000190");
  assert.equal(t.documento, null);
  assert.equal(t.nome, null);
});
test("pagamento de boleto usa cpfCnpj e nomeDestinatario do contrato oficial", () => {
  const t = normalizarTransacao(
    {
      ...bruto,
      tipoTransacao: "PAGAMENTO",
      detalhes: { cpfCnpj: "44555666000190", nomeDestinatario: "Fornecedor" },
    },
    "c",
    "11222333000181",
  );
  assert.equal(t.documento, "44555666000190");
  assert.equal(t.nome, "Fornecedor");
});
test("IDs são estáveis, separados por conta e preservam idTransacao", () => {
  assert.equal(
    normalizarTransacao(bruto, "a", "").id,
    normalizarTransacao(
      { ...bruto, descricao: "Complemento alterado" },
      "a",
      "",
    ).id,
  );
  assert.notEqual(
    normalizarTransacao(bruto, "a", "").id,
    normalizarTransacao(bruto, "b", "").id,
  );
  assert.equal(
    normalizarTransacao({ ...bruto, idTransacao: undefined }, "a", "").id,
    normalizarTransacao({ ...bruto, idTransacao: undefined }, "a", "").id,
  );
});
test("formato desconhecido é recusado em vez de adivinhar a direção", () => {
  assert.throws(() =>
    normalizarTransacao({ ...bruto, tipoOperacao: "X" }, "c", ""),
  );
  assert.throws(() =>
    normalizarTransacao({ ...bruto, valor: "-500" }, "c", ""),
  );
  assert.throws(() =>
    normalizarTransacao({ ...bruto, dataTransacao: "2026-02-30" }, "c", ""),
  );
});
test("PEM normaliza aspas e quebras literais e recusa conteúdo inválido", () => {
  assert.equal(
    normalizarPem(
      '"-----BEGIN CERTIFICATE-----\\nYWJj\\n-----END CERTIFICATE-----"',
      "CERTIFICATE",
    ),
    "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----",
  );
  assert.throws(() => normalizarPem("certificado inválido", "CERTIFICATE"));
});
