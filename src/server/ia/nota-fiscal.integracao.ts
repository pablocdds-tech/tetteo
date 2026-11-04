import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { db } from "@/server/db";

import { encryptVirtualCredential } from "./credencial-atendimento";
import { lerNotaFiscalFoto } from "./nota-fiscal";

const destino = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["127.0.0.1", "localhost"].includes(destino.hostname) ||
  !destino.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
after(async () => db.$disconnect());

const foto = {
  bytes: Buffer.from([0xff, 0xd8, 0xff, 0, 1]),
  tipo: "image/jpeg",
};
const leitura = {
  fornecedor: { nome: "Fornecedor fictício" },
  total: 20.5,
  itens: [
    { descricao: "Farinha", quantidade: 1, unidade: "PCT", valorTotal: 20.5 },
  ],
  alertas: [],
};
const sucesso = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(leitura) }] },
      },
    ],
    usageMetadata: {
      promptTokenCount: 500,
      candidatesTokenCount: 80,
      totalTokenCount: 600,
    },
  });
async function fixture() {
  const organizacao = await db.organizacao.create({
    data: { nome: "Leitura fictícia", slug: randomUUID() },
  });
  const unidade = await db.unidade.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Unidade fictícia",
      codigo: "NOTA",
    },
  });
  const scope = { organizationId: organizacao.id, storeId: unidade.id };
  const configuracao = await db.avModelConfiguration.create({
    data: {
      ...scope,
      model: "gemini-ficticio",
      encryptedKey: encryptVirtualCredential(scope, "credencial-ficticia"),
      enabled: true,
      ratesConfirmed: true,
      testState: "PASSED",
      testedRevision: 1,
      testedAt: new Date(),
      updatedById: "fixture:notes",
      inputMicrosPerMillion: 1_000_000,
      outputMicrosPerMillion: 2_000_000,
    },
  });
  const nota = await db.notaFiscalWhatsapp.create({
    data: {
      organizacaoId: organizacao.id,
      unidadeId: unidade.id,
      instanciaId: "fixture",
      vinculoId: "fixture",
      usuarioId: "fixture",
      mensagemId: randomUUID(),
    },
  });
  return { scope: { ...scope, solicitacaoId: nota.id }, nota, configuracao };
}

test("reserva antes da geração e duas execuções concorrentes não pagam a mesma leitura duas vezes", async (t) => {
  const f = await fixture();
  let geracoes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 700 });
    geracoes++;
    const nota = await db.notaFiscalWhatsapp.findUniqueOrThrow({
      where: { id: f.nota.id },
    });
    assert.ok(nota.custoMicros > 0);
    return sucesso();
  });
  const resultados = await Promise.allSettled([
    lerNotaFiscalFoto(f.scope, foto),
    lerNotaFiscalFoto(f.scope, foto),
  ]);
  assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(geracoes, 1);
  const nota = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: f.nota.id },
  });
  assert.equal(nota.custoMicros, 700);
  assert.equal(nota.tokens, 600);
});

test("falha do provedor conserva a reserva e uma nova tentativa não repete geração paga", async (t) => {
  const f = await fixture();
  let geracoes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 700 });
    geracoes++;
    throw new Error("segredo-do-provedor");
  });
  await assert.rejects(
    lerNotaFiscalFoto(f.scope, foto),
    /NOTA_MODELO_INDISPONIVEL/,
  );
  await assert.rejects(lerNotaFiscalFoto(f.scope, foto), /já foi tentada/);
  assert.equal(geracoes, 1);
  const nota = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: f.nota.id },
  });
  assert.equal(nota.custoMicros, 17_084);
  assert.ok(nota.leituraTentadaEm);
});

test("tarifa zero confirmada permite leitura e o marcador impede repetir mesmo com custo zero", async (t) => {
  const f = await fixture();
  await db.avModelConfiguration.update({
    where: { id: f.configuracao.id },
    data: { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 },
  });
  let geracoes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 700 });
    geracoes++;
    return sucesso();
  });
  await lerNotaFiscalFoto(f.scope, foto);
  await assert.rejects(lerNotaFiscalFoto(f.scope, foto), /já foi tentada/);
  assert.equal(geracoes, 1);
  const nota = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: f.nota.id },
  });
  assert.equal(nota.custoMicros, 0);
  assert.ok(nota.leituraTentadaEm);
});

test("troca da revisão após contagem impede geração e orçamento de notas anteriores é compartilhado", async (t) => {
  const f = await fixture();
  let geracoes = 0;
  const mock = t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens")) {
      await db.avModelConfiguration.update({
        where: { id: f.configuracao.id },
        data: {
          revision: { increment: 1 },
          enabled: false,
          testState: "PENDING",
          testedRevision: null,
          testedAt: null,
        },
      });
      return Response.json({ totalTokens: 700 });
    }
    geracoes++;
    return sucesso();
  });
  await assert.rejects(lerNotaFiscalFoto(f.scope, foto), /configuração.*mudou/);
  assert.equal(geracoes, 0);
  mock.mock.restore();

  const outra = await fixture();
  await db.avChannelAccount.create({
    data: {
      organizationId: outra.scope.organizationId,
      storeId: outra.scope.storeId,
      name: "Orçamento fictício",
      dailyBudgetMicros: 20_000,
    },
  });
  await db.notaFiscalWhatsapp.create({
    data: {
      organizacaoId: outra.nota.organizacaoId,
      unidadeId: outra.nota.unidadeId,
      instanciaId: outra.nota.instanciaId,
      vinculoId: outra.nota.vinculoId,
      usuarioId: outra.nota.usuarioId,
      mensagemId: randomUUID(),
      custoMicros: 5000,
      leituraTentadaEm: null,
    },
  });
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 700 });
    geracoes++;
    return sucesso();
  });
  await assert.rejects(lerNotaFiscalFoto(outra.scope, foto), /limite de custo/);
  assert.equal(geracoes, 0);
});

test("solicitação de outra unidade é recusada antes de geração", async (t) => {
  const a = await fixture();
  const b = await fixture();
  let geracoes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 700 });
    geracoes++;
    return sucesso();
  });
  await assert.rejects(
    lerNotaFiscalFoto({ ...a.scope, solicitacaoId: b.nota.id }, foto),
  );
  assert.equal(geracoes, 0);
});
