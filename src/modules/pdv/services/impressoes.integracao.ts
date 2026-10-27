import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { obterDocumentoImpressao, solicitarImpressao } from "./impressoes";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("impressão isola unidade e cliente, audita solicitações idempotentes e distingue reimpressão", async () => {
  const org = await db.organizacao.create({
    data: { nome: "Impressão fictícia", slug: `print-test-${randomUUID()}` },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Unidade fictícia", codigo: "PRINT" },
  });
  const outra = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Outra unidade fictícia",
      codigo: "OUTRA",
    },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador de impressão fictício",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local fictício" },
  });
  const caixa = await db.pdvCaixa.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      localEstoqueId: local.id,
      abertoPorId: usuario.id,
      operador: usuario.nome,
      saldoInicialCentavos: 0,
    },
  });
  const venda = await db.pdvVenda.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      caixaId: caixa.id,
      chave: randomUUID(),
      payloadHash: "snapshot-ficticio",
      usuarioId: usuario.id,
      operador: "Nome histórico do operador",
      cliente: "Nome histórico protegido",
      modalidade: "BALCAO",
      status: "CONCLUIDA",
      subtotalCentavos: 1000,
      descontoCentavos: 0,
      taxaCentavos: 0,
      totalCentavos: 1000,
      trocoCentavos: 0,
      itens: [
        {
          produtoId: "ficticio",
          quantidade: 1,
          opcoes: [],
          observacao: "Sem gelo",
          nome: "Produto histórico",
          precoUnitarioCentavos: 1000,
          totalCentavos: 1000,
          complementos: [],
        },
      ],
      pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
      consumo: [],
    },
  });
  const ctx: ContextoSessao = {
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      avatarUrl: null,
    },
    organizacao: { id: org.id, nome: org.nome },
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade, outra],
    podeVerRedeInteira: true,
    permissoes: new Set(["pdv.ver"]),
    ehDiretor: false,
  };
  const entrada = { vendaId: venda.id, tipo: "COMPROVANTE" as const };
  const consulta = await obterDocumentoImpressao(ctx, entrada);
  assert.equal("cliente" in consulta, false);
  assert.equal(consulta.itens[0].nome, "Produto histórico");
  assert.equal(consulta.operador, "Nome histórico do operador");
  assert.equal(
    await db.auditoria.count({
      where: { organizacaoId: org.id, entidade: "PdvImpressao" },
    }),
    0,
    "Abrir prévia não solicita impressão",
  );
  await assert.rejects(
    () => obterDocumentoImpressao({ ...ctx, unidadeAtiva: outra }, entrada),
    /indisponível/,
  );
  await assert.rejects(
    () =>
      solicitarImpressao(
        { ...ctx, permissoes: new Set() },
        { ...entrada, chave: randomUUID() },
      ),
    /permissão/,
  );
  const chave = randomUUID();
  const [primeira, repetida] = await Promise.all([
    solicitarImpressao(ctx, { ...entrada, chave }),
    solicitarImpressao(ctx, { ...entrada, chave }),
  ]);
  assert.deepEqual(primeira.solicitacao, repetida.solicitacao);
  assert.equal(primeira.solicitacao.reimpressao, false);
  assert.equal(
    await db.auditoria.count({
      where: { organizacaoId: org.id, entidade: "PdvImpressao" },
    }),
    1,
  );
  const nova = await solicitarImpressao(ctx, {
    ...entrada,
    chave: randomUUID(),
  });
  assert.equal(nova.solicitacao.reimpressao, true);
  const cozinha = await solicitarImpressao(ctx, {
    ...entrada,
    tipo: "COZINHA",
    chave: randomUUID(),
  });
  assert.equal(cozinha.solicitacao.reimpressao, false);
  assert.equal("pagamentos" in cozinha.documento, false);
  assert.equal("totalCentavos" in cozinha.documento, false);
  await assert.rejects(
    () => solicitarImpressao(ctx, { ...entrada, tipo: "COZINHA", chave }),
    /outro documento/,
  );
  const comCrm = await obterDocumentoImpressao(
    { ...ctx, permissoes: new Set(["pdv.ver", "crm.ver"]) },
    entrada,
  );
  assert.equal(comCrm.cliente, "Nome histórico protegido");
  const registros = await db.auditoria.findMany({
    where: { organizacaoId: org.id, entidade: "PdvImpressao" },
  });
  assert.equal(registros.length, 3);
  assert.ok(
    registros.every(
      (registro) =>
        registro.acao === "ACESSOU" && registro.entidadeId === venda.id,
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(registros.map((registro) => registro.valoresDepois)),
    /Nome histórico protegido|pagamentos|Centavos/,
  );
});
