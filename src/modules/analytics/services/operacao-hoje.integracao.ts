import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import { consultarOperacaoSaiposHoje } from "./operacao-hoje";

const alvo = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(alvo.hostname) ||
  !alvo.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");

after(async () => db.$disconnect());

test("Saipos hoje usa turno Brasília, isola o escopo e apenas lê o que já foi importado", async () => {
  const prefixo = `saipos-hoje-test-${randomUUID()}`;
  const organizacao = await db.organizacao.create({
    data: { nome: "Saipos hoje fictício", slug: prefixo },
  });
  const outraOrganizacao = await db.organizacao.create({
    data: { nome: "Organização externa fictícia", slug: `${prefixo}-externa` },
  });
  const unidade = await db.unidade.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Loja fictícia A",
      codigo: "A",
    },
  });
  const outraUnidade = await db.unidade.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Loja fictícia B",
      codigo: "B",
    },
  });
  const unidadeExterna = await db.unidade.create({
    data: {
      organizacaoId: outraOrganizacao.id,
      nome: "Loja fictícia externa",
      codigo: "C",
    },
  });
  const semVinculo = await db.unidade.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Sem vínculo fictício",
      codigo: "D",
    },
  });
  const agora = new Date("2026-11-05T02:30:00Z"); // Ainda 04/11 em Brasília.
  const sucesso = new Date("2026-11-05T02:00:00Z");
  const solicitada = new Date("2026-11-05T02:15:00Z");
  const contexto: ContextoSessao = {
    usuario: {
      id: "operador-ficticio-nao-persistido",
      nome: "Operador fictício",
      email: "ficticio@example.invalid",
      avatarUrl: null,
    },
    organizacao: { id: organizacao.id, nome: organizacao.nome },
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade, outraUnidade, semVinculo],
    podeVerRedeInteira: true,
    permissoes: new Set(["analytics.ver"]),
    ehDiretor: false,
  };
  const lojaInicial = randomInt(1_000_000, 2_000_000_000);
  for (const [indice, loja] of [
    unidade,
    outraUnidade,
    unidadeExterna,
  ].entries())
    await db.saiposVinculo.create({
      data: {
        organizacaoId: loja.organizacaoId,
        unidadeId: loja.id,
        lojaSaiposId: lojaInicial + indice,
        coberturaDesde: "2026-10-01",
        cursor: "2026-11-04T23:00:00",
        ultimaTentativaEm: sucesso,
        ultimoSucessoEm: sucesso,
        solicitadaEm: solicitada,
        ultimaQuantidade: 999,
      },
    });

  let numero = 0;
  async function criarVenda(
    loja: typeof unidade,
    totalCentavos: number,
    criadaNoSaiposEm: string,
    dataTurno = "2026-11-04",
    cancelada = false,
    excluida = false,
  ) {
    return db.saiposVenda.create({
      data: {
        organizacaoId: loja.organizacaoId,
        unidadeId: loja.id,
        vendaExternaId: String(++numero),
        dataTurno,
        totalCentavos,
        cancelada,
        criadaNoSaiposEm: new Date(criadaNoSaiposEm),
        alteradaNoSaiposEm: sucesso,
        origem: "Canal fictício",
        modalidade: 2,
        // Prova de que snapshots de itens/histórico não atravessam a consulta.
        itensSaipos: [{ observacao: "Não deve sair no painel" }],
        historicoSaipos: [{ consumidor: "Conteúdo fictício não selecionado" }],
        excluidoEm: excluida ? sucesso : null,
      },
    });
  }
  await criarVenda(unidade, 2000, "2026-11-04T03:00:00Z");
  for (let minuto = 0; minuto < 6; minuto++)
    await criarVenda(unidade, 100, `2026-11-05T02:0${minuto}:00Z`);
  const cancelada = await criarVenda(
    unidade,
    90_000,
    "2026-11-05T02:10:00Z",
    "2026-11-04",
    true,
  );
  await criarVenda(unidade, 80_000, "2026-11-04T03:10:00Z", "2026-11-03");
  await criarVenda(unidade, 70_000, "2026-11-05T02:20:00Z", "2026-11-05");
  await criarVenda(unidade, 60_000, "2026-11-05T02:30:00.001Z");
  await criarVenda(
    unidade,
    50_000,
    "2026-11-05T02:21:00Z",
    "2026-11-04",
    false,
    true,
  );
  await criarVenda(outraUnidade, 555_000, "2026-11-05T02:20:00Z");
  await criarVenda(unidadeExterna, 999_000, "2026-11-05T02:20:00Z");

  const vinculoAntes = await db.saiposVinculo.findUniqueOrThrow({
    where: { unidadeId: unidade.id },
  });
  const vendasAntes = await db.saiposVenda.findMany({
    where: { unidadeId: unidade.id },
    orderBy: { id: "asc" },
  });
  const resumo = await consultarOperacaoSaiposHoje(contexto, agora);
  assert.equal(resumo.hoje, "2026-11-04");
  assert.equal(resumo.consultadoEm, agora.toISOString());
  assert.equal(resumo.centavos, 2600);
  assert.equal(resumo.quantidade, 7);
  assert.equal(resumo.canceladas, 1);
  assert.equal(resumo.recentes.length, 5);
  assert.equal(resumo.recentes[0].id, cancelada.id);
  assert.equal(resumo.recentes[0].cancelada, true);
  assert.deepEqual(Object.keys(resumo.recentes[0]).sort(), [
    "cancelada",
    "criadaNoSaiposEm",
    "id",
    "modalidade",
    "origem",
    "totalCentavos",
    "vendaExternaId",
  ]);
  assert.equal(resumo.vinculo?.ultimoSucessoEm, sucesso.toISOString());
  assert.equal(resumo.vinculo?.solicitadaEm, solicitada.toISOString());
  const resumoOutra = await consultarOperacaoSaiposHoje(
    { ...contexto, unidadeAtiva: outraUnidade },
    agora,
  );
  assert.equal(resumoOutra.centavos, 555_000);
  assert.equal(resumoOutra.quantidade, 1);
  const vazio = await consultarOperacaoSaiposHoje(
    { ...contexto, unidadeAtiva: semVinculo },
    agora,
  );
  assert.equal(vazio.vinculo, null);
  assert.equal(vazio.quantidade, 0);
  assert.deepEqual(vazio.recentes, []);

  await assert.rejects(
    () =>
      consultarOperacaoSaiposHoje(
        { ...contexto, permissoes: new Set() },
        agora,
      ),
    SemPermissao,
  );
  await assert.rejects(
    () =>
      consultarOperacaoSaiposHoje({ ...contexto, unidadeAtiva: null }, agora),
    ExigeUnidade,
  );
  await assert.rejects(
    () =>
      consultarOperacaoSaiposHoje(
        {
          ...contexto,
          unidadeAtiva: outraUnidade,
          unidadesVisiveis: [unidade],
        },
        agora,
      ),
    SemPermissao,
  );
  await assert.rejects(
    () =>
      consultarOperacaoSaiposHoje(
        {
          ...contexto,
          unidadeAtiva: unidadeExterna,
          unidadesVisiveis: [unidadeExterna],
        },
        agora,
      ),
    SemPermissao,
  );
  assert.deepEqual(
    await db.saiposVinculo.findUniqueOrThrow({
      where: { unidadeId: unidade.id },
    }),
    vinculoAntes,
  );
  assert.deepEqual(
    await db.saiposVenda.findMany({
      where: { unidadeId: unidade.id },
      orderBy: { id: "asc" },
    }),
    vendasAntes,
  );
  await db.unidade.update({
    where: { id: outraUnidade.id },
    data: { ativa: false },
  });
  await assert.rejects(
    () =>
      consultarOperacaoSaiposHoje(
        { ...contexto, unidadeAtiva: outraUnidade },
        agora,
      ),
    SemPermissao,
  );
  await db.organizacao.update({
    where: { id: organizacao.id },
    data: { ativa: false },
  });
  await assert.rejects(
    () => consultarOperacaoSaiposHoje(contexto, agora),
    SemPermissao,
  );
});
