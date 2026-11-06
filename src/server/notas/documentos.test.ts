import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { tipoDocumentoNota, LeituraNotaRecusada } from "./documento";
import { lerXmlFiscal } from "./xml";
import { extrairPdfFiscal } from "./pdf";
import { lerTextoFiscal } from "./texto";
import { validarExtracaoFiscal } from "./extracao";
const fixture = (nome: string) =>
  readFile(path.join(process.cwd(), "tests/fixtures/notas", nome));
test("XML fiscal é lido sem IA, conserva preços e descontos e rejeita entidades externas", async () => {
  const xml = await fixture("nfe-sintetica.xml"),
    d = lerXmlFiscal(xml);
  assert.equal(tipoDocumentoNota(xml), "application/xml");
  assert.equal(d.itens.length, 2);
  assert.equal(d.total_nota, 14);
  assert.equal(d.descontos, 1);
  assert.equal(d.itens[0].valor_unitario, 5);
  assert.equal(d.parcelas?.[0].vencimento, "2026-11-10");
  assert.deepEqual(validarExtracaoFiscal(d), []);
  const ajusteInvalido = lerXmlFiscal(
    Buffer.from(
      xml.toString().replace("<vDesc>1.00</vDesc>", "<vDesc>ilegivel</vDesc>"),
    ),
  );
  assert.equal(ajusteInvalido.descontos, null);
  assert.ok(validarExtracaoFiscal(ajusteInvalido).length);
  for (const malicioso of [
    '<!DOCTYPE nfe [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml.toString(),
    xml.toString().replace("<cStat>100</cStat>", "<cStat>101</cStat>"),
    "<NFe>".repeat(60) + "</NFe>".repeat(60),
  ])
    assert.throws(
      () => lerXmlFiscal(Buffer.from(malicioso)),
      LeituraNotaRecusada,
    );
});
test("PDF com texto é extraído e tabelas desconhecidas não recebem itens inventados", async () => {
  const pdf = await fixture("nfe-texto-sintetica.pdf"),
    r = await extrairPdfFiscal(pdf);
  assert.equal(tipoDocumentoNota(pdf), "application/pdf");
  assert.equal(r.totalPaginas, 1);
  assert.equal(r.paginas.length, 0);
  const d = lerTextoFiscal(r.texto);
  assert.equal(d.cnpj_emitente, "11222333000181");
  assert.equal(d.itens.length, 2);
  assert.equal(d.total_nota, 14);
  assert.deepEqual(validarExtracaoFiscal(d), []);
  const parcial = lerTextoFiscal(
    "Documento sem tabela conhecida\nCNPJ: 11.222.333/0001-81",
  );
  assert.equal(parcial.itens.length, 0);
  assert.equal(parcial.total_nota, null);
  const ambiguo = lerTextoFiscal(
    "EMITENTE: FORNECEDOR FICTICIO\nCNPJ: 11.222.333/0001-81\nDESTINATARIO\nCNPJ: 11.444.777/0001-61",
  );
  assert.equal(ambiguo.cnpj_emitente, null);
  assert.ok(ambiguo.alertas.some((a) => a.includes("mais de um CNPJ")));
});
test("PDF digitalizado é renderizado sem enviar arquivo a terceiros", async () => {
  const r = await extrairPdfFiscal(
    await fixture("nfe-digitalizada-sintetica.pdf"),
  );
  assert.equal(r.paginas.length, 1);
  assert.equal(tipoDocumentoNota(r.paginas[0]), "image/png");
});
