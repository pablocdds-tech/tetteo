import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { lerXmlFiscal } from "@/server/notas/xml";
import { notaAssistidaPronta } from "@/server/nota-assistida-contrato";
import {
  conferenciaFiscal,
  pendenciasDaConferenciaFiscal,
  responderLeituraFiscal,
  rascunhoDaLeituraFiscal,
  mensagemConferenciaFiscal,
  type ConferenciaFiscal,
} from "./leitura-fiscal";
import { propostaDaConferencia, confirmacaoVigente } from "./conferencia-nota";
import { mensagemItensFiscais } from "./mensagens-leitura-fiscal";
async function fixture(): Promise<ConferenciaFiscal> {
  const d = lerXmlFiscal(
    await readFile(
      path.join(process.cwd(), "tests/fixtures/notas/nfe-sintetica.xml"),
    ),
  );
  return {
    versao: "fiscal-2.0",
    metodo: "XML",
    original: d,
    conferida: structuredClone(d),
    extras: [],
    alertasConferidos: false,
  };
}
test("alertas e campos ilegíveis bloqueiam até conferência humana; null nunca vira estimativa", async () => {
  const c = await fixture();
  assert.ok(pendenciasDaConferenciaFiscal(c).length);
  c.conferida.itens[0].quantidade = null;
  assert.equal(c.original.itens[0].quantidade, 2);
  const r = responderLeituraFiscal(c, "CONFERI LEITURA").conferencia;
  assert.equal(r.conferida.itens[0].quantidade, null);
  assert.ok(pendenciasDaConferenciaFiscal(r).length);
  const corrigida = responderLeituraFiscal(
    r,
    "CORRIGIR ITEM 1 QUANTIDADE 2",
  ).conferencia;
  assert.deepEqual(pendenciasDaConferenciaFiscal(corrigida), []);
  assert.equal(corrigida.original.itens[0].quantidade, 2);
});
test("adaptador conserva valores brutos, rateia centavos e mantém contrato atual de lançamento", async () => {
  const c = responderLeituraFiscal(
    await fixture(),
    "CONFERI LEITURA",
  ).conferencia;
  const r = rascunhoDaLeituraFiscal(c, {
    operacaoId: "ficticia",
    arquivoId: "arquivo",
    recebidaEm: "2026-11-04",
  });
  assert.deepEqual(
    r.itens.map((i) => i.valorTotal),
    [9.33, 4.67],
  );
  assert.equal(r.itens[0].valorBruto, 10);
  r.itens.forEach((i, n) => {
    i.insumoId = `insumo-${n}`;
    i.fatorConversao = 1;
  });
  r.empresaId = "empresa";
  r.localId = "local";
  r.categoriaId = "categoria";
  r.pagamento = {
    situacao: "A_PAGAR",
    forma: "BOLETO",
    parcelas: [{ valor: 14, vencimento: "2026-11-10" }],
  };
  const d = notaAssistidaPronta.parse(propostaDaConferencia(r));
  assert.equal(d.valorTotal, 14);
  const agora = new Date("2026-11-04T15:00:00Z");
  assert.equal(
    confirmacaoVigente({
      texto: "OK",
      codigo: "ABC123",
      resumoEm: new Date(agora.getTime() - 2000),
      expiraEm: new Date(agora.getTime() + 1000),
      recebidoEm: new Date(agora.getTime() - 1000),
      agora,
      hash: "qualquer",
      proposta: d,
    }),
    false,
  );
  assert.ok(conferenciaFiscal(c));
});

test("rascunho apresenta os produtos e uma pergunta, sem despejar divergências técnicas", async () => {
  const c = await fixture();
  c.metodo = "GEMINI";
  c.conferida.cnpj_emitente = "00000000000000";
  c.conferida.chave_acesso = "0".repeat(44);
  c.conferida.acrescimos = null;
  c.extras = Array.from({ length: 15 }, (_, n) => ({
    campo: `item ${n}`,
    codigo: "LEITURAS_DIVERGENTES",
    mensagem: `Leituras diferentes em item ${n}: 16.99 / 18.99.`,
  }));
  const antes = structuredClone(c);
  const texto = mensagemConferenciaFiscal(c);
  assert.match(texto, /1\. ARROZ TIPO 1/);
  assert.match(texto, /2\. FEIJAO PRETO/);
  assert.match(texto, /Data: 04\/11\/2026/);
  assert.match(texto, /Acréscimo: \*pendente\*/);
  assert.match(texto, /2 produtos/);
  assert.match(texto, /14,00/);
  assert.match(texto, /CPF\/CNPJ do fornecedor/);
  assert.doesNotMatch(
    texto,
    /GEMINI|A conferir:|dígitos|16\.99|18\.99|CORRIGIR DATA|44 números|acréscimo\?/,
  );
  assert.deepEqual(c, antes); // A apresentação não remove validações ou evidências.
  assert.ok(pendenciasDaConferenciaFiscal(c).length > 15);
});

test("responder só o documento corrige a pergunta atual e mantém as outras pendências", async () => {
  const c = await fixture();
  c.conferida.cnpj_emitente = "00000000000000";
  c.conferida.chave_acesso = "0".repeat(44);
  const r = responderLeituraFiscal(c, "11.222.333/0001-81");
  assert.equal(r.reconhecido, true);
  assert.equal(r.conferencia.conferida.cnpj_emitente, "11222333000181");
  assert.equal(r.conferencia.original.cnpj_emitente, c.original.cnpj_emitente);
  assert.equal(r.conferencia.conferida.chave_acesso, "0".repeat(44));
  assert.match(mensagemConferenciaFiscal(r.conferencia), /44 números/);
  assert.ok(pendenciasDaConferenciaFiscal(r.conferencia).length);
});

test("responder zero ao acréscimo não apaga o desconto lido", async () => {
  const c = await fixture();
  c.conferida.acrescimos = null;
  assert.match(mensagemConferenciaFiscal(c), /valor do acréscimo/);
  const r = responderLeituraFiscal(c, "0");
  assert.equal(r.reconhecido, true);
  assert.equal(r.conferencia.conferida.acrescimos, 0);
  assert.equal(r.conferencia.conferida.descontos, 1);
  assert.equal(r.conferencia.original.acrescimos, 0);
  assert.equal(r.conferencia.alertasConferidos, false);
});

test("código de barras ilegível pode ficar ausente sem inventar identificador", async () => {
  const c = await fixture();
  c.conferida.itens[1].codigo_ean = "12345678";
  const r = responderLeituraFiscal(c, "SEM CÓDIGO");
  assert.equal(r.reconhecido, true);
  assert.equal(r.conferencia.conferida.itens[1].codigo_ean, null);
  assert.deepEqual(r.conferencia.conferida.itens[0], c.conferida.itens[0]);
});

test("resposta numérica vai somente para a quantidade que foi perguntada", async () => {
  const c = await fixture();
  c.conferida.itens[0].quantidade = null;
  const r = responderLeituraFiscal(c, "2");
  assert.equal(r.conferencia.conferida.itens[0].quantidade, 2);
  assert.equal(r.conferencia.conferida.total_nota, 14);
  assert.equal(r.conferencia.original.itens[0].quantidade, 2);
});

test("ITENS continua disponível e o rascunho inclui automaticamente todos os produtos", async () => {
  const c = await fixture();
  const detalhes = mensagemItensFiscais(c.conferida);
  assert.match(detalhes, /1\. \*ARROZ TIPO 1\*/);
  assert.match(detalhes, /2 PCT × R\$\s5,00 = R\$\s10,00/);
  assert.match(detalhes, /Desconto: R\$\s1,00/);
  assert.doesNotMatch(detalhes, /A conferir:|GEMINI|LEITURAS_DIVERGENTES/);
  c.conferida.itens = Array.from({ length: 100 }, () =>
    structuredClone(c.conferida.itens[0]),
  );
  assert.match(mensagemConferenciaFiscal(c), /100\. ARROZ TIPO 1/);
  assert.doesNotMatch(
    mensagemConferenciaFiscal(c),
    /produtos respondendo \*ITENS\*/,
  );
});

test("CONFERI abre a próxima etapa apenas após resolver campos inválidos; OK não vira aceite fiscal", async () => {
  const c = await fixture();
  c.conferida.cnpj_emitente = "00000000000000";
  assert.equal(responderLeituraFiscal(c, "CONFERI").reconhecido, false);
  assert.equal(responderLeituraFiscal(c, "OK").reconhecido, false);
  assert.equal(responderLeituraFiscal(c, "OK ABC123").reconhecido, false);
  const valida = await fixture();
  const r = responderLeituraFiscal(valida, "CONFERI");
  assert.equal(r.reconhecido, true);
  assert.equal(r.conferencia.alertasConferidos, true);
  assert.deepEqual(pendenciasDaConferenciaFiscal(r.conferencia), []);
});

test("comandos e sim/não nunca viram nome de produto ou fornecedor", async () => {
  const c = await fixture();
  c.conferida.itens[0].descricao = null;
  for (const texto of [
    "CONFERI",
    "SIM",
    "NÃO",
    "PAGAMENTO DEPOIS",
    "SEM CÓDIGO",
    "AJUDA",
    "BUSCAR ARROZ",
    "ITENS",
  ]) {
    const r = responderLeituraFiscal(c, texto);
    assert.equal(r.reconhecido, false);
    assert.equal(r.conferencia.conferida.itens[0].descricao, null);
  }
});
