import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { db } from "@/server/db";
import { contextoDeFundo } from "@/core/sessao/nucleo";
import { encryptVirtualCredential } from "@/server/ia/credencial-atendimento";
import { lerXmlFiscal } from "@/server/notas/xml";
import { camposEditaveis } from "../schemas/rascunho-fiscal";
import { conferenciaFiscal } from "../schemas/leitura-fiscal";
import {
  receberRascunhoFiscal,
  salvarRascunhoFiscal,
  obterRascunhoFiscal,
  listarRascunhosFiscais,
} from "./rascunhos-fiscais";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.includes("_test"),
);
after(() => db.$disconnect());
const fixtureBytes = (nome = "nfe-sintetica.xml") =>
  readFile(`tests/fixtures/notas/${nome}`);

async function fixture() {
  const org = await db.organizacao.create({
    data: { nome: "Rascunhos sintéticos", slug: randomUUID() },
  });
  const unidade = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Unidade fictícia",
      codigo: randomUUID(),
    },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Pessoa fictícia",
      email: `${randomUUID()}@example.test`,
      status: "ATIVO",
    },
  });
  const papel = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Conferente",
      permissoes: {
        create: ["assistente.ver", "estoque.ver", "estoque.lancar"].map(
          (chave) => ({ chave }),
        ),
      },
    },
  });
  await db.acesso.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      usuarioId: usuario.id,
      papelId: papel.id,
    },
  });
  const ctx = await contextoDeFundo(usuario.id, unidade.id);
  assert.ok(ctx);
  return {
    ctx,
    unidade,
    org,
    usuario,
    papel,
    receber: async (bytes?: Uint8Array, operacaoId = randomUUID()) =>
      receberRascunhoFiscal(ctx, {
        unidadeId: unidade.id,
        operacaoId,
        bytes: bytes ?? (await fixtureBytes()),
      }),
    modelo: async () =>
      db.avModelConfiguration.create({
        data: {
          organizationId: org.id,
          storeId: unidade.id,
          model: "gemini-ficticio",
          encryptedKey: encryptVirtualCredential(
            { organizationId: org.id, storeId: unidade.id },
            "chave-sintetica",
          ),
          enabled: true,
          ratesConfirmed: true,
          testState: "PASSED",
          testedRevision: 1,
          testedAt: new Date(),
          updatedById: usuario.id,
          inputMicrosPerMillion: 0,
          outputMicrosPerMillion: 0,
        },
      }),
  };
}

test("XML completo pode ser reaberto e salvo sem criar compra, estoque, financeiro ou mensagens", async () => {
  const f = await fixture();
  const r = await f.receber();
  assert.equal(r.dados.itens.length, 2);
  assert.deepEqual(r.pendencias, []);
  const e = camposEditaveis(r.dados);
  e.itens[0].quantidade = null;
  e.cnpj_emitente = null;
  const salvo = await salvarRascunhoFiscal(f.ctx, {
    id: r.id,
    revisao: r.revisao,
    unidadeId: f.unidade.id,
    dados: e,
  });
  assert.equal(salvo.revisao, 1);
  assert.ok(salvo.pendencias.length > 0);
  const aberto = await obterRascunhoFiscal(f.ctx, f.unidade.id, r.id);
  assert.equal(aberto.dados.itens[0].quantidade, null);
  const nota = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: r.id },
  });
  assert.equal(
    conferenciaFiscal(nota.leitura)?.original.itens[0].quantidade,
    2,
  );
  assert.equal(nota.codigo, null);
  assert.equal(nota.rascunho, null);
  assert.equal(nota.resultado, null);
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.movimentoEstoque.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.pedido.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.mensagemNotaWhatsapp.count({ where: { notaId: r.id } }),
    0,
  );
  await assert.rejects(
    salvarRascunhoFiscal(f.ctx, {
      id: r.id,
      revisao: 0,
      unidadeId: f.unidade.id,
      dados: e,
    }),
    /outra aba/,
  );
});

test("rascunhos não podem ser lidos ou alterados por outra unidade, organização, autor ou permissão revogada", async () => {
  const a = await fixture(),
    b = await fixture();
  const r = await a.receber();
  await assert.rejects(
    obterRascunhoFiscal(b.ctx, b.unidade.id, r.id),
    /não encontrado/,
  );
  await assert.rejects(
    salvarRascunhoFiscal(b.ctx, {
      id: r.id,
      revisao: 0,
      unidadeId: b.unidade.id,
      dados: camposEditaveis(r.dados),
    }),
    /não encontrado/,
  );
  assert.equal((await listarRascunhosFiscais(b.ctx, b.unidade.id)).length, 0);
  await assert.rejects(
    obterRascunhoFiscal(a.ctx, b.unidade.id, r.id),
    /permissão/,
  );
  const outro = await db.usuario.create({
    data: {
      nome: "Outro autor",
      email: `${randomUUID()}@example.test`,
      status: "ATIVO",
    },
  });
  await db.acesso.create({
    data: {
      organizacaoId: a.org.id,
      unidadeId: a.unidade.id,
      usuarioId: outro.id,
      papelId: a.papel.id,
    },
  });
  const ctxOutro = await contextoDeFundo(outro.id, a.unidade.id);
  assert.ok(ctxOutro);
  await assert.rejects(
    obterRascunhoFiscal(ctxOutro, a.unidade.id, r.id),
    /não encontrado/,
  );
  const outraUnidade = await db.unidade.create({
    data: { organizacaoId: a.org.id, nome: "Outra loja", codigo: randomUUID() },
  });
  await db.acesso.create({
    data: {
      organizacaoId: a.org.id,
      unidadeId: outraUnidade.id,
      usuarioId: a.usuario.id,
      papelId: a.papel.id,
    },
  });
  const ctxOutra = await contextoDeFundo(a.usuario.id, outraUnidade.id);
  assert.ok(ctxOutra);
  await assert.rejects(
    obterRascunhoFiscal(ctxOutra, outraUnidade.id, r.id),
    /não encontrado/,
  );
  await db.papelPermissao.deleteMany({
    where: { papelId: a.papel.id, chave: "estoque.lancar" },
  });
  await assert.rejects(
    obterRascunhoFiscal(a.ctx, a.unidade.id, r.id),
    /permissão/,
  );
});

test("envio repetido não cria outro rascunho; chave reutilizada com outros bytes é recusada", async () => {
  const f = await fixture(),
    operacao = randomUUID();
  const bytes = await fixtureBytes();
  const a = await f.receber(bytes, operacao),
    b = await f.receber(bytes, operacao);
  assert.equal(a.id, b.id);
  await assert.rejects(
    f.receber(await fixtureBytes("cupom-nitido.png"), operacao),
    /outro documento/,
  );
});

test("foto completa usa uma geração simulada e envios concorrentes não repetem leitura", async (t) => {
  const f = await fixture();
  await f.modelo();
  const dados = lerXmlFiscal(await fixtureBytes());
  let geracoes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 1000 });
    geracoes++;
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(dados) }] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 100,
        totalTokenCount: 1100,
      },
    });
  });
  const foto = await fixtureBytes("cupom-nitido.png"),
    operacao = randomUUID();
  const respostas = await Promise.allSettled([
    f.receber(foto, operacao),
    f.receber(foto, operacao),
  ]);
  const sucesso = respostas.find((r) => r.status === "fulfilled");
  assert.ok(sucesso && sucesso.status === "fulfilled");
  assert.deepEqual(sucesso.value.pendencias, []);
  assert.deepEqual(sucesso.value.dados, dados);
  assert.equal(geracoes, 1);
  assert.equal(
    await db.notaFiscalWhatsapp.count({
      where: { organizacaoId: f.org.id, instanciaId: "WEB" },
    }),
    1,
  );
});

test("Gemini simulado preserva campos completos e parciais na mesma extração e usa a configuração existente", async (t) => {
  const f = await fixture();
  await f.modelo();
  const dados = lerXmlFiscal(await fixtureBytes());
  dados.cnpj_emitente = null;
  dados.numero = null;
  dados.chave_acesso = null;
  dados.itens[0].quantidade = null;
  dados.acrescimos = null;
  let geracoes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.match(url, /models\/gemini-ficticio:/);
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 1000 });
    geracoes++;
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(dados) }] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 100,
        totalTokenCount: 1100,
      },
    });
  });
  const operacao = randomUUID(),
    foto = await fixtureBytes("cupom-nitido.png");
  const r = await f.receber(foto, operacao);
  assert.equal(r.dados.razao_social, dados.razao_social);
  assert.equal(r.dados.itens[1].valor_total, 5);
  assert.equal(r.dados.itens[0].quantidade, null);
  assert.equal(r.dados.acrescimos, null);
  assert.ok(r.pendencias.some((p) => p.campo === "itens.0.quantidade"));
  assert.ok(geracoes > 0 && geracoes <= 2);
  const antes = geracoes;
  await f.receber(foto, operacao);
  assert.equal(geracoes, antes);
});

test("JSON inválido, indisponibilidade do provedor e imagem ilegível deixam um rascunho manual salvável", async (t) => {
  for (const caso of ["json", "provedor", "imagem"]) {
    const f = await fixture();
    await f.modelo();
    let geracoes = 0;
    const mock = t.mock.method(globalThis, "fetch", async (url: string) => {
      if (url.endsWith(":countTokens"))
        return Response.json({ totalTokens: 1000 });
      geracoes++;
      return caso === "provedor"
        ? new Response("segredo-sintetico payload-privado", { status: 503 })
        : new Response("{json-incompleto");
    });
    const r = await f.receber(
      await fixtureBytes(
        caso === "imagem" ? "imagem-sem-detalhes.png" : "cupom-nitido.png",
      ),
    );
    assert.equal(r.dados.total_nota, null);
    assert.deepEqual(r.dados.itens, []);
    assert.ok(r.avisos.length > 0);
    assert.doesNotMatch(JSON.stringify(r), /segredo-sintetico|payload-privado/);
    if (caso === "imagem") assert.equal(geracoes, 0);
    if (caso === "provedor") assert.equal(geracoes, 1);
    const salvo = await salvarRascunhoFiscal(f.ctx, {
      id: r.id,
      revisao: r.revisao,
      unidadeId: f.unidade.id,
      dados: camposEditaveis(r.dados),
    });
    assert.equal(salvo.revisao, 1);
    mock.mock.restore();
  }
});
