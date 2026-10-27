import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  esquemaDocumentoImpressao,
  esquemaSolicitarImpressao,
  montarDocumentoImpressao,
} from "./impressao";

const venda = {
  id: randomUUID(),
  cliente: "Nome congelado da venda",
  modalidade: "RETIRADA",
  observacao: "Sem guardanapos",
  status: "CONCLUIDA",
  operador: "Operador da venda",
  criadaEm: new Date("2026-10-27T12:00:00Z"),
  motivoCancelamento: null,
  itens: [
    {
      produtoId: "antigo",
      nome: "Nome histórico do produto",
      quantidade: 2,
      observacao: "Sem cebola",
      opcoes: ["antiga"],
      precoUnitarioCentavos: 4800,
      totalCentavos: 9600,
      complementos: [
        { grupo: "Sabores", nome: "Calabresa histórica", precoCentavos: 4800 },
      ],
    },
  ],
  pagamentos: [{ forma: "DINHEIRO", valorCentavos: 10000 }],
  subtotalCentavos: 9600,
  descontoCentavos: 100,
  taxaCentavos: 200,
  totalCentavos: 9700,
  trocoCentavos: 300,
};
const contexto = {
  unidade: "Unidade teste",
  tipo: "COMPROVANTE" as const,
  podeVerCliente: true,
  pedido: { id: randomUUID(), numero: 13, status: "COZINHA" },
  agora: new Date("2026-10-27T13:00:00Z"),
};

test("impressão aceita apenas identificação e versão, sem conteúdo ou valores fornecidos pelo navegador", () => {
  assert.equal(
    esquemaDocumentoImpressao.safeParse({ vendaId: venda.id, tipo: "COZINHA" })
      .success,
    true,
  );
  for (const valor of ["../outra-venda", "", "123"])
    assert.equal(
      esquemaDocumentoImpressao.safeParse({
        vendaId: valor,
        tipo: "COMPROVANTE",
      }).success,
      false,
    );
  assert.equal(
    esquemaDocumentoImpressao.safeParse({ vendaId: venda.id, tipo: "FISCAL" })
      .success,
    false,
  );
  assert.equal(
    esquemaSolicitarImpressao.safeParse({
      vendaId: venda.id,
      tipo: "COMPROVANTE",
      chave: randomUUID(),
      totalCentavos: 1,
    }).success,
    false,
  );
  assert.equal(
    esquemaSolicitarImpressao.safeParse({
      vendaId: venda.id,
      tipo: "COMPROVANTE",
      chave: randomUUID(),
      cliente: "Outro",
    }).success,
    false,
  );
});

test("comprovante preserva nomes, preços, complementos e pagamento do snapshot sem buscar catálogo atual", () => {
  const documento = montarDocumentoImpressao(venda, contexto);
  assert.equal(documento.tipo, "COMPROVANTE");
  if (documento.tipo !== "COMPROVANTE") throw new Error("Tipo inesperado");
  assert.equal(documento.itens[0].nome, "Nome histórico do produto");
  assert.equal(documento.itens[0].complementos[0].nome, "Calabresa histórica");
  assert.equal(documento.itens[0].precoUnitarioCentavos, 4800);
  assert.equal(documento.totalCentavos, 9700);
  assert.equal(documento.trocoCentavos, 300);
  assert.equal(documento.pagamentos[0].valorCentavos, 10000);
  assert.equal(documento.cliente, venda.cliente);
  assert.equal(documento.geradoEm, contexto.agora.toISOString());
});

test("via cozinha não transporta preços, totais, pagamento ou dados brutos do cliente", () => {
  const documento = montarDocumentoImpressao(
    { ...venda, clienteId: "nao-expor", telefone: "nao-expor" },
    { ...contexto, tipo: "COZINHA", podeVerCliente: false },
  );
  assert.equal(documento.tipo, "COZINHA");
  assert.deepEqual(documento.itens[0], {
    nome: venda.itens[0].nome,
    quantidade: 2,
    observacao: "Sem cebola",
    complementos: [{ grupo: "Sabores", nome: "Calabresa histórica" }],
  });
  assert.doesNotMatch(
    JSON.stringify(documento),
    /Centavos|pagamentos|cliente|telefone|produtoId|opcoes/,
  );
  assert.equal(documento.observacao, "Sem guardanapos");
});

test("sem crm.ver o nome congelado também é omitido do comprovante", () => {
  const documento = montarDocumentoImpressao(venda, {
    ...contexto,
    podeVerCliente: false,
  });
  assert.equal("cliente" in documento, false);
});

test("cancelamento continua destacado nos dados e a via aceita venda histórica sem pedido operacional", () => {
  const documento = montarDocumentoImpressao(
    { ...venda, status: "CANCELADA", motivoCancelamento: "Cliente desistiu" },
    { ...contexto, tipo: "COZINHA", pedido: null },
  );
  assert.equal(documento.statusVenda, "CANCELADA");
  assert.equal(documento.motivoCancelamento, "Cliente desistiu");
  assert.equal(documento.pedido, null);
  assert.throws(() =>
    montarDocumentoImpressao({ ...venda, itens: [] }, contexto),
  );
});
