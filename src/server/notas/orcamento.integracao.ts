import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { db } from "@/server/db";
import { encryptVirtualCredential } from "@/server/ia/credencial-atendimento";
import { lerFiscalComGemini } from "./orcamento";
import { lerXmlFiscal } from "./xml";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.includes("_test"),
);
after(() => db.$disconnect());
const imagem = {
  bytes: Buffer.from([255, 216, 255, 0]),
  tipo: "image/jpeg",
  variante: "original",
};
async function fixture() {
  const o = await db.organizacao.create({
    data: { nome: "Orçamento sintético", slug: randomUUID() },
  });
  const u = await db.unidade.create({
    data: { organizacaoId: o.id, nome: "Teste", codigo: randomUUID() },
  });
  const scope = { organizationId: o.id, storeId: u.id };
  await db.avModelConfiguration.create({
    data: {
      ...scope,
      model: "gemini-ficticio",
      encryptedKey: encryptVirtualCredential(scope, "chave-ficticia"),
      enabled: true,
      ratesConfirmed: true,
      testState: "PASSED",
      testedRevision: 1,
      testedAt: new Date(),
      updatedById: "teste",
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
    },
  });
  const n = await db.notaFiscalWhatsapp.create({
    data: {
      organizacaoId: o.id,
      unidadeId: u.id,
      instanciaId: "sintetica",
      usuarioId: "sintetico",
      vinculoId: "sintetico",
      mensagemId: randomUUID(),
    },
  });
  const dados = lerXmlFiscal(
    await readFile("tests/fixtures/notas/nfe-sintetica.xml"),
  );
  const sucesso = (d = dados) =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(d) }] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 500,
        candidatesTokenCount: 100,
        totalTokenCount: 700,
      },
    });
  return {
    scope: { ...scope, solicitacaoId: n.id },
    dados,
    sucesso,
    atual: () =>
      db.notaFiscalWhatsapp.findUniqueOrThrow({ where: { id: n.id } }),
  };
}
test("Free Tier reserva cada tentativa; segunda usa recortes e divergência continua pendente", async (t) => {
  const f = await fixture();
  let geracoes = 0,
    recortes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 800 });
    geracoes++;
    assert.equal((await f.atual()).tentativasLeitura, geracoes);
    if (geracoes === 1) {
      const d = structuredClone(f.dados);
      d.itens[0].quantidade = 20;
      return f.sucesso(d);
    }
    return f.sucesso();
  });
  const r = await lerFiscalComGemini(
    f.scope,
    [imagem],
    async () => {
      recortes++;
      return [{ ...imagem, variante: "cabecalho" }];
    },
    async () => {},
  );
  assert.equal(r.dados.itens[0].quantidade, 2);
  assert.ok(r.extras.some((p) => p.codigo === "LEITURAS_DIVERGENTES"));
  assert.equal(geracoes, 2);
  assert.equal(recortes, 1);
  assert.equal((await f.atual()).custoMicros, 0);
  await assert.rejects(
    lerFiscalComGemini(
      f.scope,
      [imagem],
      async () => [imagem],
      async () => {},
    ),
  );
  assert.equal(geracoes, 2);
});
test("concorrência não repete geração mesmo com tarifa zero", async (t) => {
  const f = await fixture();
  let geracoes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 800 });
    geracoes++;
    return f.sucesso();
  });
  const r = await Promise.allSettled(
    [1, 2].map(() =>
      lerFiscalComGemini(
        f.scope,
        [imagem],
        async () => [imagem],
        async () => {},
      ),
    ),
  );
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(geracoes, 1);
});
test("cota e falha de rede não causam segunda geração nem liberam replay", async (t) => {
  const f = await fixture();
  let geracoes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith(":countTokens"))
      return Response.json({ totalTokens: 800 });
    geracoes++;
    throw Error("corpo privado");
  });
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      lerFiscalComGemini(
        f.scope,
        [imagem],
        async () => {
          throw Error("não deve recortar");
        },
        async () => {},
      ),
    );
  assert.equal(geracoes, 1);
  assert.equal((await f.atual()).tentativasLeitura, 1);
});
