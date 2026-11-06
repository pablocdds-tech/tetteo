import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { lerXmlFiscal } from "@/server/notas/xml";
import { extracaoVazia } from "@/server/notas/extracao";
import {
  aplicarEdicaoFiscal,
  camposEditaveis,
  pendenciasDoRascunho,
  salvarRascunhoFiscalSchema,
} from "./rascunho-fiscal";

const completa = async () =>
  lerXmlFiscal(await readFile("tests/fixtures/notas/nfe-sintetica.xml"));

test("rascunho completo conserva os dados extraídos sem pendências de campos válidos", async () => {
  const d = await completa();
  assert.deepEqual(pendenciasDoRascunho(d), []);
  assert.deepEqual(aplicarEdicaoFiscal(d, camposEditaveis(d)), d);
});

test("rascunho parcial é editável e salvável sem CNPJ, número, quantidades ou ajustes", async () => {
  const d = await completa();
  d.cnpj_emitente = null;
  d.numero = null;
  d.chave_acesso = null;
  d.itens[0].quantidade = null;
  d.descontos = null;
  d.acrescimos = null;
  const copia = structuredClone(d);
  const e = camposEditaveis(d);
  assert.ok(
    salvarRascunhoFiscalSchema.safeParse({
      id: "rascunho",
      unidadeId: "unidade",
      revisao: 0,
      dados: e,
    }).success,
  );
  const p = pendenciasDoRascunho(d);
  assert.ok(p.some((p) => p.campo === "itens.0.quantidade"));
  assert.ok(p.some((p) => p.campo === "descontos"));
  assert.ok(
    !p.some((p) => p.campo === "itens.1.descricao" || p.campo === "serie"),
  );
  e.itens[0].quantidade = 2;
  const corrigida = aplicarEdicaoFiscal(d, e);
  assert.equal(corrigida.itens[0].quantidade, 2);
  assert.equal(corrigida.itens[0].confianca.quantidade, 1);
  assert.equal(corrigida.acrescimos, null);
  assert.deepEqual(d, copia);
});

test("campos vazios permanecem null e rascunho vazio não inventa produtos ou valores", () => {
  const d = extracaoVazia();
  const e = camposEditaveis(d);
  e.razao_social = "";
  const r = aplicarEdicaoFiscal(d, e);
  assert.equal(r.razao_social, null);
  assert.equal(r.total_nota, null);
  assert.deepEqual(r.itens, []);
  assert.equal(r.descontos, null);
});

test("CPF inválido destaca o CPF informado, sem marcar um CNPJ ausente como erro", async () => {
  const d = await completa();
  d.cnpj_emitente = null;
  d.cpf_emitente = "00000000000";
  const p = pendenciasDoRascunho(d);
  assert.ok(p.some((p) => p.campo === "cpf_emitente"));
  assert.ok(!p.some((p) => p.campo === "cnpj_emitente"));
});

test("edição não permite adulterar escopo, confiança, alertas ou confirmação", async () => {
  const d = await completa();
  for (const campo of [
    "organizacaoId",
    "usuarioId",
    "confianca",
    "alertas",
    "codigo",
    "resultado",
  ])
    assert.throws(() =>
      aplicarEdicaoFiscal(d, { ...camposEditaveis(d), [campo]: "adulterado" }),
    );
  const e = camposEditaveis(d);
  e.itens[0].valor_total = -5;
  assert.throws(() => aplicarEdicaoFiscal(d, e));
});
