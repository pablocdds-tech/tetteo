import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import type { TransacaoBancaria } from "@/lib/extrato-bancario";
import {
  baixarIntegrado,
  consultarFinanceiro,
  criarTransferenciaIntegrada,
  detalheFinanceiro,
  estornarBaixaIntegrada,
  processarExtratoInter,
  resolverPendenciasInter,
  salvarIntegracaoInter,
  salvarLancamentoIntegrado,
  salvarPessoaIntegrada,
  salvarPlanoIntegrado,
  transacaoFinanceira,
} from "./integrado";

after(() => db.$disconnect());
async function fixture() {
  const sufixo = randomUUID();
  const org = await db.organizacao.create({
    data: { nome: "Financeiro teste", slug: `fin-${sufixo}` },
  });
  const unidade = await db.unidade.create({
    data: { nome: "Loja teste", codigo: sufixo, organizacaoId: org.id },
  });
  const usuario = await db.usuario.create({
    data: { nome: "Diretor teste", email: `${sufixo}@example.test` },
  });
  const ctx: ContextoSessao = {
    organizacao: org,
    usuario: { ...usuario, avatarUrl: null },
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade],
    podeVerRedeInteira: true,
    permissoes: new Set(["*"]),
    ehDiretor: true,
  };
  const empresa = await db.empresaFinanceira.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      nome: "Empresa teste",
      razaoSocial: "Empresa teste",
      cnpj: "11222333000181",
      regime: "SIMPLES",
    },
  });
  const conta = await db.contaFinanceira.create({
    data: {
      unidadeId: unidade.id,
      empresaId: empresa.id,
      nome: "Inter teste",
      saldoInicial: "1000.00",
    },
  });
  const plano = await salvarPlanoIntegrado(ctx, {
    nome: "Insumos",
    codigo: "1",
    tipo: "DESPESA",
    entraDre: true,
  });
  const pessoa = await salvarPessoaIntegrada(ctx, {
    nome: "Fornecedor A",
    tipoDocumento: "cnpj",
    documento: "44555666000190",
    categoriaId: plano.id,
  });
  const integracao = await salvarIntegracaoInter(ctx, {
    empresaId: empresa.id,
    contaId: conta.id,
    envKey: `T${sufixo.replaceAll("-", "").slice(0, 20).toUpperCase()}`,
    ambiente: "sandbox",
  });
  const lancar = (extra: Record<string, unknown> = {}) =>
    salvarLancamentoIntegrado(ctx, {
      empresaId: empresa.id,
      pessoaId: pessoa.id,
      categoriaId: plano.id,
      direcao: "PAGAR",
      descricao: "Fornecedor teste",
      valor: "500.00",
      vencimento: "2026-11-10",
      competencia: "2026-11-01",
      tipoPagamento: "PIX",
      historico: "Pagamento",
      ...extra,
    });
  const transacao = (
    extra: Partial<TransacaoBancaria> = {},
  ): TransacaoBancaria => ({
    id: randomUUID(),
    data: "2026-11-10",
    direcao: "PAGAR",
    valor: "500.00",
    tipo: "PIX",
    descricao: "Pagamento teste",
    titulo: "PIX",
    documento: "44555666000190",
    nome: "Fornecedor A",
    ...extra,
  });
  const operador = {
    ...ctx,
    ehDiretor: false,
    permissoes: new Set([
      "financeiro.ver",
      "financeiro.lancar",
      "financeiro.quitar",
    ]),
  };
  return {
    ctx,
    operador,
    empresa,
    conta,
    plano,
    pessoa,
    integracao,
    lancar,
    transacao,
  };
}
test("Inter baixa uma vez; repetição e syncs concorrentes não duplicam", async () => {
  const f = await fixture(),
    l = await f.lancar(),
    t = f.transacao();
  await Promise.all([
    processarExtratoInter(f.ctx, f.integracao.id, [t]),
    processarExtratoInter(f.ctx, f.integracao.id, [t]),
  ]);
  const detalhe = await detalheFinanceiro(f.ctx, l.id);
  assert.equal(detalhe.status, "QUITADO");
  assert.equal(detalhe.baixas.length, 1);
  assert.equal(detalhe.baixas[0].origem, "inter");
  assert.equal(
    (await processarExtratoInter(f.ctx, f.integracao.id, [t])).jaConciliadas,
    1,
  );
});
test("documento e vencimento desempataram sem alterar o outro lançamento", async () => {
  const f = await fixture();
  const a = await f.lancar(),
    b = await f.lancar({ vencimento: "2026-11-15" });
  assert.equal(
    (await processarExtratoInter(f.ctx, f.integracao.id, [f.transacao()]))
      .baixadasAutomatico,
    1,
  );
  assert.equal((await detalheFinanceiro(f.ctx, a.id)).status, "QUITADO");
  assert.equal((await detalheFinanceiro(f.ctx, b.id)).status, "ABERTO");
});
test("ambiguidade fica pendente e vinculação exige lançamento da mesma empresa", async () => {
  const f = await fixture(),
    a = await f.lancar();
  await f.lancar();
  const r = await processarExtratoInter(f.ctx, f.integracao.id, [
    f.transacao(),
  ]);
  assert.equal(r.manuaisAmbiguas, 1);
  const d = await consultarFinanceiro(f.ctx);
  assert.equal(d.pendencias.length, 1);
  await resolverPendenciasInter(f.operador, {
    ids: [d.pendencias[0].id],
    acao: "vincular",
    lancamentoId: a.id,
  });
  assert.equal((await detalheFinanceiro(f.ctx, a.id)).status, "QUITADO");
});
test("sem lançamento não cria obrigação; reavaliar resolve após cadastro", async () => {
  const f = await fixture();
  await processarExtratoInter(f.ctx, f.integracao.id, [f.transacao()]);
  assert.equal((await consultarFinanceiro(f.ctx)).total, 0);
  const a = await f.lancar();
  const d = await consultarFinanceiro(f.ctx);
  assert.equal(
    (
      await resolverPendenciasInter(f.ctx, {
        ids: d.pendencias.map((x) => x.id),
        acao: "reavaliar",
      })
    ).resolvidas,
    1,
  );
  assert.equal((await detalheFinanceiro(f.ctx, a.id)).status, "QUITADO");
});
test("baixas parciais mantêm saldo e rejeitam excesso concorrente", async () => {
  const f = await fixture(),
    a = await f.lancar();
  const baixa = {
    lancamentoId: a.id,
    contaId: f.conta.id,
    valor: "300.00",
    dataPagamento: "2026-11-10",
    tipoPagamento: "PIX",
    chave: randomUUID(),
  };
  const r = await Promise.allSettled([
    baixarIntegrado(f.operador, baixa),
    baixarIntegrado(f.operador, { ...baixa, chave: randomUUID() }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const d = await detalheFinanceiro(f.ctx, a.id);
  assert.equal(d.saldo, "200.00");
  assert.equal(d.status, "ABERTO");
  await baixarIntegrado(f.operador, {
    ...baixa,
    valor: "200.00",
    chave: randomUUID(),
  });
  assert.equal((await detalheFinanceiro(f.ctx, a.id)).status, "QUITADO");
});
test("lançamento restrito é invisível na lista, busca, detalhe e baixa do operador", async () => {
  const f = await fixture(),
    a = await f.lancar({ restritoMaster: true });
  assert.equal(
    (await consultarFinanceiro(f.operador, { q: "Fornecedor" })).total,
    0,
  );
  await assert.rejects(detalheFinanceiro(f.operador, a.id));
  await assert.rejects(
    baixarIntegrado(f.operador, {
      lancamentoId: a.id,
      contaId: f.conta.id,
      valor: "500.00",
      dataPagamento: "2026-11-10",
      tipoPagamento: "PIX",
      chave: randomUUID(),
    }),
  );
  await assert.rejects(
    f.lancar.call(null, { restritoMaster: true }).then(() =>
      salvarLancamentoIntegrado(f.operador, {
        empresaId: f.empresa.id,
        pessoaId: f.pessoa.id,
        categoriaId: f.plano.id,
        direcao: "PAGAR",
        descricao: "Tentativa",
        valor: "1.00",
        vencimento: "2026-11-10",
        competencia: "2026-11-01",
        tipoPagamento: "PIX",
        historico: "Pagamento",
        restritoMaster: true,
      }),
    ),
  );
  await assert.rejects(processarExtratoInter(f.operador, f.integracao.id, []));
});
test("outra unidade ou organização não pode acessar nem usar referências financeiras", async () => {
  const f = await fixture(),
    outro = await fixture(),
    a = await f.lancar();
  await assert.rejects(detalheFinanceiro(outro.ctx, a.id));
  await assert.rejects(
    salvarLancamentoIntegrado(outro.ctx, {
      empresaId: f.empresa.id,
      categoriaId: f.plano.id,
      direcao: "PAGAR",
      descricao: "Inválido",
      valor: "1",
      vencimento: "2026-11-10",
      competencia: "2026-11-01",
      tipoPagamento: "PIX",
      historico: "Pagamento",
    }),
  );
  await assert.rejects(
    consultarFinanceiro({ ...f.ctx, organizacao: outro.ctx.organizacao }),
  );
});
test("estorno preserva id Inter e exige diretor; transferência não cria lançamento", async () => {
  const f = await fixture(),
    a = await f.lancar(),
    t = f.transacao();
  await processarExtratoInter(f.ctx, f.integracao.id, [t]);
  const d = await detalheFinanceiro(f.ctx, a.id);
  await assert.rejects(estornarBaixaIntegrada(f.operador, d.baixas[0].id));
  await estornarBaixaIntegrada(f.ctx, d.baixas[0].id);
  assert.equal((await detalheFinanceiro(f.ctx, a.id)).status, "ABERTO");
  assert.equal(
    (await processarExtratoInter(f.ctx, f.integracao.id, [t])).jaConciliadas,
    1,
  );
  const destino = await db.contaFinanceira.create({
    data: {
      unidadeId: f.ctx.unidadeAtiva!.id,
      empresaId: f.empresa.id,
      nome: "Caixa",
    },
  });
  await criarTransferenciaIntegrada(f.ctx, {
    origemId: f.conta.id,
    destinoId: destino.id,
    data: "2026-11-10",
    valor: "100.00",
    descricao: "Suprimento",
    chave: randomUUID(),
  });
  assert.equal((await consultarFinanceiro(f.ctx)).total, 1);
});
test("RLS impede leitura e escrita fora do escopo com papel PostgreSQL sem bypass", async () => {
  const f = await fixture();
  await db.$executeRawUnsafe(
    "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='financeiro_rls_test') THEN CREATE ROLE financeiro_rls_test NOLOGIN; END IF; END $$",
  );
  await db.$executeRawUnsafe(
    "GRANT SELECT,INSERT ON pessoa_financeira TO financeiro_rls_test",
  );
  await transacaoFinanceira(f.ctx, "financeiro.ver", async (tx, u) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE financeiro_rls_test");
    assert.equal(
      await tx.pessoaFinanceira.count({ where: { unidadeId: u } }),
      1,
    );
    assert.equal(
      await tx.pessoaFinanceira.count({ where: { unidadeId: { not: u } } }),
      0,
    );
  });
  await assert.rejects(
    transacaoFinanceira(f.ctx, "financeiro.ver", async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE financeiro_rls_test");
      await tx.pessoaFinanceira.create({
        data: {
          organizacaoId: f.ctx.organizacao.id,
          unidadeId: "outra",
          nome: "Proibida",
        },
      });
    }),
  );
});

test("lançamento fora da DRE permanece no fluxo, plano pode excluí-lo e o painel oculta restritos", async () => {
  const f = await fixture();
  const a = await f.lancar({ composeDre: false });
  await baixarIntegrado(f.operador, {
    lancamentoId: a.id,
    contaId: f.conta.id,
    valor: "100.00",
    dataPagamento: "2026-11-10",
    tipoPagamento: "PIX",
    chave: randomUUID(),
  });
  await f.lancar({ restritoMaster: true, descricao: "Segredo do diretor" });
  const dados = await consultarFinanceiro(f.operador, {
    de: "2026-11-01",
    ate: "2026-11-30",
  });
  assert.equal(dados.fluxo.saidas, "100.00");
  assert.equal(dados.grupos.filter((g) => g.composeDre).length, 0);
  const { listarLancamentos } = await import("./lancamentos");
  const linhas = await listarLancamentos(f.operador);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].valor, 400);
});

test("sandbox e produção da mesma empresa mantêm integrações distintas", async () => {
  const f = await fixture();
  const producao = await salvarIntegracaoInter(f.ctx, {
    empresaId: f.empresa.id,
    contaId: f.conta.id,
    envKey: `P${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
    ambiente: "producao",
  });
  assert.notEqual(producao.id, f.integracao.id);
  assert.equal((await consultarFinanceiro(f.ctx)).integracoes.length, 2);
  await assert.rejects(
    salvarIntegracaoInter(f.ctx, {
      empresaId: f.empresa.id,
      contaId: f.conta.id,
      envKey: `P${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
      ambiente: "producao",
    }),
  );
});
