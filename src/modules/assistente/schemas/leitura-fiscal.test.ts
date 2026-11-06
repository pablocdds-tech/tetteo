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
  type ConferenciaFiscal,
} from "./leitura-fiscal";
import { propostaDaConferencia, confirmacaoVigente } from "./conferencia-nota";
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
