import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import {
  abrirCaixa,
  finalizarVenda,
  cancelarVenda,
  movimentarCaixa,
  fecharCaixa,
} from "@/modules/pdv/services/pdv";
import { moverPedido } from "@/modules/pdv/services/pedidos";
import { receberPedido } from "@/modules/pdv/services/recebimentos";
import type { FinalizarEntrada } from "@/modules/pdv/types";
import {
  consultarRecebimentosPdv,
  salvarRecebimentosPdv,
  processarRecebimentosPdv,
} from "@/modules/financeiro/services/recebimentos-pdv";
import {
  salvarLancamentoIntegrado,
  salvarPlanoIntegrado,
  salvarPessoaIntegrada,
  salvarIntegracaoInter,
  processarExtratoInter,
  simularExtratoInter,
  consultarFinanceiro,
  detalheFinanceiro,
  resolverPendenciasInter,
  baixarIntegrado,
  estornarBaixaIntegrada,
} from "@/modules/financeiro/services/integrado";
import {
  fecharContagem,
  salvarQuantidades,
} from "@/modules/estoque/services/contagens";
import { lancarNota } from "@/modules/estoque/services/notas";
import { calcularCmvDoPeriodo } from "@/modules/estoque/services/cmv";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.includes("_test"),
  "Somente banco local exclusivo de testes.",
);
after(() => db.$disconnect());
async function fixture() {
  const tag = randomUUID();
  const org = await db.organizacao.create({
    data: { nome: "Integridade fictícia", slug: tag },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja A", codigo: "A" },
  });
  const usuario = await db.usuario.create({
    data: { nome: "Operador fictício", email: `${tag}@example.test` },
  });
  const ctx: ContextoSessao = {
    organizacao: org,
    usuario: { ...usuario, avatarUrl: null },
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade],
    permissoes: new Set(["*"]),
    ehDiretor: true,
    podeVerRedeInteira: true,
  };
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Cozinha fictícia" },
  });
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: org.id,
      nome: "Insumo fictício",
      unidadeMedida: "UN",
      custoMedio: "2",
    },
  });
  const ficha = await db.fichaTecnica.create({
    data: {
      organizacaoId: org.id,
      nome: "Produto fictício",
      tipo: "PRATO",
      precoVenda: "10",
      rendimento: "1",
      itens: {
        create: { insumoId: insumo.id, quantidade: "1", unidade: "UN" },
      },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: unidade.id,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: "10",
    },
  });
  const empresa = await db.empresaFinanceira.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      nome: "Empresa fictícia",
      razaoSocial: "Empresa fictícia",
      cnpj: "11222333000181",
      regime: "SIMPLES",
    },
  });
  const conta = await db.contaFinanceira.create({
    data: {
      unidadeId: unidade.id,
      empresaId: empresa.id,
      nome: "Banco fictício",
      saldoInicial: "1000",
    },
  });
  const plano = await salvarPlanoIntegrado(ctx, {
    nome: "Despesas teste",
    codigo: "1",
    tipo: "DESPESA",
  });
  const pessoa = await salvarPessoaIntegrada(ctx, {
    nome: "Fornecedor fictício",
    tipoDocumento: "cnpj",
    documento: "44555666000190",
    categoriaId: plano.id,
  });
  const lancamento = {
    chave: randomUUID(),
    empresaId: empresa.id,
    pessoaId: pessoa.id,
    categoriaId: plano.id,
    direcao: "PAGAR",
    descricao: "Obrigação fictícia",
    valor: "100",
    vencimento: "2026-11-01",
    competencia: "2026-10-01",
    tipoPagamento: "PIX",
    historico: "Pagamento",
  };
  const vender = async (opcoes: Partial<FinalizarEntrada> = {}) => {
    const caixaId = await abrirCaixa(ctx, {
      saldoInicialCentavos: 0,
      localEstoqueId: local.id,
    });
    const vendaId = await finalizarVenda(ctx, {
      chave: randomUUID(),
      caixaId,
      modalidade: "BALCAO",
      observacao: "",
      itens: [
        { produtoId: ficha.id, quantidade: 2, opcoes: [], observacao: "" },
      ],
      descontoCentavos: 0,
      taxaCentavos: 0,
      pagamentos: [{ forma: "PIX", valorCentavos: 2000 }],
      ...opcoes,
    });
    return { vendaId, caixaId };
  };
  const saldo = async () =>
    String(
      (
        await db.posicaoEstoque.findFirstOrThrow({
          where: { localId: local.id, insumoId: insumo.id },
        })
      ).quantidade,
    );
  return {
    ctx,
    org,
    unidade,
    usuario,
    local,
    insumo,
    ficha,
    empresa,
    conta,
    plano,
    pessoa,
    lancamento,
    vender,
    saldo,
  };
}
test("repetição concorrente do cadastro financeiro cria uma obrigação e recusa corpo divergente", async () => {
  const f = await fixture();
  const resultados = await Promise.all(
    Array.from({ length: 3 }, () =>
      salvarLancamentoIntegrado(f.ctx, f.lancamento),
    ),
  );
  assert.equal(new Set(resultados.map((r) => r.id)).size, 1);
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    1,
  );
  await assert.rejects(
    salvarLancamentoIntegrado(f.ctx, { ...f.lancamento, valor: "200" }),
    /chave/,
  );
});
test("sandbox só simula e o serviço de escrita recusa persistência operacional", async () => {
  const f = await fixture();
  const l = await salvarLancamentoIntegrado(f.ctx, f.lancamento);
  const i = await salvarIntegracaoInter(f.ctx, {
    empresaId: f.empresa.id,
    contaId: f.conta.id,
    envKey: `T${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`,
    ambiente: "sandbox",
  });
  const extrato = [
    {
      id: randomUUID(),
      data: "2026-11-01",
      direcao: "PAGAR" as const,
      valor: "100.00",
      tipo: "PIX",
      titulo: "Teste",
      descricao: "Fictício",
      documento: "44555666000190",
      nome: "Fornecedor fictício",
    },
  ];
  const r = await simularExtratoInter(f.ctx, i.id, extrato);
  assert.equal(r.correspondencias, 1);
  assert.equal(r.simulacao, true);
  await assert.rejects(processarExtratoInter(f.ctx, i.id, extrato), /Sandbox/);
  const detalhe = await detalheFinanceiro(f.ctx, l.id);
  assert.equal(detalhe.status, "ABERTO");
  assert.equal(detalhe.baixas.length, 0);
  assert.equal(
    await db.pendenciaInter.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  // Pendências históricas de sandbox também não podem atingir o razão real.
  const antiga = await db.pendenciaInter.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      integracaoId: i.id,
      interTransacaoId: randomUUID(),
      tipo: "sem_lancamento",
      data: new Date("2026-11-01"),
      direcao: "PAGAR",
      valor: "100",
      tipoTransacao: "PIX",
      titulo: "Simulação antiga",
      descricao: "Fictício",
      candidatosIds: [],
    },
  });
  await assert.rejects(
    resolverPendenciasInter(f.ctx, {
      ids: [antiga.id],
      acao: "vincular",
      lancamentoId: l.id,
    }),
    /Sandbox/,
  );
  await assert.rejects(
    resolverPendenciasInter(f.ctx, { ids: [antiga.id], acao: "reavaliar" }),
    /Sandbox/,
  );
  assert.equal((await consultarFinanceiro(f.ctx)).pendencias.length, 0);
  assert.equal((await detalheFinanceiro(f.ctx, l.id)).baixas.length, 0);
});
test("suprimento é idempotente mesmo após fechar o caixa e rejeita alteração do valor", async () => {
  const f = await fixture();
  const caixaId = await abrirCaixa(f.ctx, {
    saldoInicialCentavos: 0,
    localEstoqueId: f.local.id,
  });
  const d = {
    chave: randomUUID(),
    caixaId,
    tipo: "SUPRIMENTO",
    valorCentavos: 10000,
    motivo: "Aporte fictício",
  };
  await Promise.all([movimentarCaixa(f.ctx, d), movimentarCaixa(f.ctx, d)]);
  await fecharCaixa(f.ctx, {
    caixaId,
    valorContadoCentavos: 10000,
    observacao: "Teste",
  });
  await movimentarCaixa(f.ctx, d);
  assert.equal(await db.pdvMovimentoCaixa.count({ where: { caixaId } }), 1);
  await assert.rejects(
    movimentarCaixa(f.ctx, { ...d, valorCentavos: 20000 }),
    /Chave/,
  );
});
test("pedido preparado cancelado vira perda e não devolve matéria-prima", async () => {
  const f = await fixture(),
    v = await f.vender();
  const p = await db.pdvPedido.findFirstOrThrow({
    where: { vendaId: v.vendaId },
  });
  await moverPedido(f.ctx, {
    pedidoId: p.id,
    versao: p.versao,
    destino: "AGUARDANDO_COLETA",
  });
  await assert.rejects(
    cancelarVenda(f.ctx, {
      vendaId: v.vendaId,
      motivo: "Cliente desistiu",
      destinoEstoque: "DEVOLVER",
    }),
    /já preparado/,
  );
  const r = await cancelarVenda(f.ctx, {
    vendaId: v.vendaId,
    motivo: "Cliente desistiu",
  });
  assert.equal(r.estoqueDevolvido, false);
  assert.equal(await f.saldo(), "8");
  await cancelarVenda(f.ctx, {
    vendaId: v.vendaId,
    motivo: "Cliente desistiu",
  });
  assert.equal(
    await db.movimentoEstoque.count({
      where: { unidadeId: f.unidade.id, tipo: "PERDA" },
    }),
    1,
  );
});
test("cancelamento antes do uso devolve ingredientes somente por decisão explícita", async () => {
  const f = await fixture(),
    v = await f.vender();
  await cancelarVenda(f.ctx, {
    vendaId: v.vendaId,
    motivo: "Ainda não preparado",
    destinoEstoque: "DEVOLVER",
  });
  assert.equal(await f.saldo(), "10");
  assert.equal(
    await db.movimentoEstoque.count({
      where: { unidadeId: f.unidade.id, tipo: "PERDA" },
    }),
    0,
  );
});
test("duas requisições de fechamento geram um ajuste e uma auditoria", async () => {
  const f = await fixture();
  const c = await db.contagem.create({
    data: {
      unidadeId: f.unidade.id,
      localId: f.local.id,
      referencia: new Date(),
      itens: { create: { insumoId: f.insumo.id, quantidade: "5" } },
    },
  });
  await Promise.all([fecharContagem(f.ctx, c.id), fecharContagem(f.ctx, c.id)]);
  assert.equal(
    await db.movimentoEstoque.count({
      where: { contagemId: c.id, tipo: "AJUSTE" },
    }),
    1,
  );
  assert.equal(
    await db.auditoria.count({
      where: { entidade: "Contagem", entidadeId: c.id, acao: "ALTEROU" },
    }),
    1,
  );
  assert.equal(await f.saldo(), "5");
});
test("média compartilhada pondera o estoque das duas lojas da organização", async () => {
  const f = await fixture();
  const u = await db.unidade.create({
    data: { organizacaoId: f.org.id, nome: "Loja B", codigo: "B" },
  });
  const local = await db.localEstoque.create({
    data: { unidadeId: u.id, nome: "Depósito B" },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: u.id,
      localId: local.id,
      insumoId: f.insumo.id,
      quantidade: "100",
    },
  });
  const fornecedor = await db.fornecedor.create({
    data: { organizacaoId: f.org.id, nome: "Fornecedor de nota" },
  });
  const nota = await db.notaEntrada.create({
    data: {
      unidadeId: f.unidade.id,
      fornecedorId: fornecedor.id,
      localDestinoId: f.local.id,
      recebidaEm: new Date(),
      itens: {
        create: {
          insumoId: f.insumo.id,
          quantidadeNota: "10",
          quantidade: "10",
          valorUnitario: "20",
          valorTotal: "200",
        },
      },
    },
  });
  await lancarNota(f.ctx, nota.id);
  assert.equal(
    String(
      (await db.insumo.findUniqueOrThrow({ where: { id: f.insumo.id } }))
        .custoMedio,
    ),
    "3.5",
  );
});
test("edição e fechamento concorrentes preservam o mesmo número na folha e na posição", async () => {
  const f = await fixture();
  const c = await db.contagem.create({
    data: {
      unidadeId: f.unidade.id,
      localId: f.local.id,
      referencia: new Date(),
      itens: { create: { insumoId: f.insumo.id, quantidade: "5" } },
    },
  });
  await assert.rejects(
    fecharContagem(
      {
        ...f.ctx,
        organizacao: { id: randomUUID(), nome: "Outra organização" },
      },
      c.id,
    ),
    /permissão/,
  );
  const resultados = await Promise.allSettled([
    salvarQuantidades(f.ctx, c.id, [
      { insumoId: f.insumo.id, base: 5, valor: 7 },
    ]),
    fecharContagem(f.ctx, c.id),
  ]);
  assert.equal(resultados[1].status, "fulfilled");
  const item = await db.contagemItem.findFirstOrThrow({
    where: { contagemId: c.id },
  });
  assert.equal(await f.saldo(), String(item.quantidade));
  await assert.rejects(
    salvarQuantidades(f.ctx, c.id, [
      { insumoId: f.insumo.id, base: Number(item.quantidade), valor: 9 },
    ]),
    /fechada/,
  );
});
test("CMV rejeita locais diferentes e não trata transferência interna como consumo", async () => {
  const f = await fixture();
  const local = await db.localEstoque.create({
    data: { unidadeId: f.unidade.id, nome: "Depósito" },
  });
  const criar = (localId: string, q: string, data: string) =>
    db.contagem.create({
      data: {
        unidadeId: f.unidade.id,
        localId,
        referencia: new Date(data),
        status: "FECHADA",
        itens: {
          create: { insumoId: f.insumo.id, quantidade: q, custoUnitario: "2" },
        },
      },
    });
  const a = await criar(f.local.id, "10", "2026-10-01T00:00:00Z"),
    b = await criar(local.id, "5", "2026-10-02T00:00:00Z"),
    c = await criar(f.local.id, "5", "2026-10-02T00:00:00Z");
  await assert.rejects(calcularCmvDoPeriodo(f.ctx, a.id, b.id), /mesmo local/);
  await db.movimentoEstoque.create({
    data: {
      unidadeId: f.unidade.id,
      localId: f.local.id,
      localDestinoId: local.id,
      insumoId: f.insumo.id,
      tipo: "TRANSFERENCIA",
      quantidade: "5",
      custoUnitario: "2",
      ocorridoEm: new Date("2026-10-01T12:00:00Z"),
      registradoPorId: f.usuario.id,
    },
  });
  assert.equal((await calcularCmvDoPeriodo(f.ctx, a.id, c.id)).cmv, 0);
});
test("indicadores obedecem empresa e data da tabela; competência tem recorte próprio", async () => {
  const f = await fixture();
  await salvarLancamentoIntegrado(f.ctx, f.lancamento);
  const outra = await db.empresaFinanceira.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      nome: "Outra empresa",
      razaoSocial: "Outra empresa",
      cnpj: "19131243000197",
      regime: "SIMPLES",
    },
  });
  await salvarLancamentoIntegrado(f.ctx, {
    ...f.lancamento,
    chave: randomUUID(),
    empresaId: outra.id,
    valor: "200",
  });
  const r = await consultarFinanceiro(f.ctx, {
    empresaId: f.empresa.id,
    de: "2026-11-01",
    ate: "2026-11-30",
  });
  assert.equal(r.total, 1);
  assert.equal(r.grupos.length, 1);
  assert.equal(r.grupos[0].liquido, "100.00");
  const competencia = await consultarFinanceiro(f.ctx, {
    empresaId: f.empresa.id,
    de: "2026-11-01",
    ate: "2026-11-30",
    baseData: "competencia",
  });
  assert.equal(competencia.total, 0);
  assert.equal(competencia.grupos.length, 0);
});
test("fluxo usa pagamento no período mesmo com vencimento antigo e respeita a busca", async () => {
  const f = await fixture();
  const l = await salvarLancamentoIntegrado(f.ctx, {
    ...f.lancamento,
    vencimento: "2026-10-15",
  });
  const outra = await salvarLancamentoIntegrado(f.ctx, {
    ...f.lancamento,
    chave: randomUUID(),
    descricao: "Outra obrigação",
    vencimento: "2026-10-15",
  });
  for (const [lancamentoId, valor, dataPagamento] of [
    [l.id, "10", "2026-10-20"],
    [l.id, "40", "2026-11-02"],
    [outra.id, "25", "2026-11-02"],
  ])
    await baixarIntegrado(f.ctx, {
      lancamentoId,
      contaId: f.conta.id,
      valor,
      dataPagamento,
      tipoPagamento: "PIX",
      chave: randomUUID(),
    });
  const r = await consultarFinanceiro(f.ctx, {
    q: "Obrigação fictícia",
    de: "2026-11-01",
    ate: "2026-11-30",
    baseData: "pagamento",
  });
  assert.equal(r.fluxo.saidas, "40.00");
  assert.equal(r.fluxo.entradas, "0.00");
  assert.equal(
    r.contas[0].saldo,
    "925.00",
    "saldo da conta inclui outros lançamentos visíveis, independentemente do filtro do relatório",
  );
  assert.equal(
    (
      await consultarFinanceiro(f.ctx, {
        direcao: "RECEBER",
        baseData: "pagamento",
      })
    ).fluxo.saidas,
    "0.00",
  );
});

async function configurarPdv(
  f: Awaited<ReturnType<typeof fixture>>,
  opcoes: { cartao?: boolean; baixarDinheiro?: boolean } = {},
) {
  const plano = await salvarPlanoIntegrado(f.ctx, {
    nome: "Vendas fictícias",
    codigo: "2",
    tipo: "RECEITA",
  });
  const d = await consultarRecebimentosPdv(f.ctx);
  const regras = d.regras.map((r) => ({
    ...r,
    ativa: opcoes.cartao || r.forma !== "CREDITO",
    empresaId: f.empresa.id,
    contaId: f.conta.id,
    categoriaId: plano.id,
    taxaBps: r.forma === "CREDITO" ? 300 : 0,
    prazoDias: r.forma === "CREDITO" ? 30 : 0,
    baixarNoRecebimento: r.forma === "DINHEIRO" && !!opcoes.baixarDinheiro,
  }));
  await salvarRecebimentosPdv(f.ctx, { regras });
  return { regras, plano };
}

test("configuração do PDV aceita rascunho, exige valores explícitos e impede referências cruzadas", async () => {
  const f = await fixture(),
    outro = await fixture();
  const dados = await consultarRecebimentosPdv(f.ctx);
  assert.ok(
    dados.regras.every(
      (r) => !r.ativa && r.taxaBps === null && r.prazoDias === null,
    ),
  );
  await salvarRecebimentosPdv(f.ctx, { regras: dados.regras });
  const atual = await consultarRecebimentosPdv(f.ctx);
  await assert.rejects(
    salvarRecebimentosPdv(f.ctx, {
      regras: atual.regras.map((r) => ({ ...r, ativa: r.forma === "PIX" })),
    }),
    /complete/,
  );
  await assert.rejects(
    salvarRecebimentosPdv(f.ctx, {
      regras: atual.regras.map((r) => ({ ...r, empresaId: outro.empresa.id })),
    }),
    /Empresa indisponível/,
  );
  await assert.rejects(
    salvarRecebimentosPdv(f.ctx, {
      regras: atual.regras.map((r) => ({
        ...r,
        empresaId: f.empresa.id,
        contaId: outro.conta.id,
      })),
    }),
    /Conta indisponível/,
  );
  await assert.rejects(
    salvarRecebimentosPdv(f.ctx, { regras: dados.regras }),
    /mudou/,
  );
  const operador = {
    ...f.ctx,
    ehDiretor: false,
    permissoes: new Set([
      "financeiro.ver",
      "financeiro.lancar",
      "financeiro.quitar",
    ]),
  };
  await assert.rejects(consultarRecebimentosPdv(operador), /diretor/);
  await assert.rejects(processarRecebimentosPdv(operador), /diretor/);
  await assert.rejects(
    db.configuracaoRecebimentoPdv.updateMany({
      where: { unidadeId: f.unidade.id, forma: "CREDITO" },
      data: { baixarNoRecebimento: true },
    }),
  );
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
});

test("pagamento misto com troco integra atomicamente, preserva taxa/prazo e repetições não duplicam", async () => {
  const f = await fixture();
  await configurarPdv(f, { baixarDinheiro: true });
  const pagamentos = [
    { forma: "DINHEIRO" as const, valorCentavos: 1000 },
    { forma: "PIX" as const, valorCentavos: 500 },
    { forma: "CREDITO" as const, valorCentavos: 1000 },
  ];
  const v = await f.vender({ pagamentos });
  assert.equal((await processarRecebimentosPdv(f.ctx)).aguardando, 1);
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    0,
    "uma forma sem configuração desfaz o lote inteiro da venda",
  );
  const cfg = await consultarRecebimentosPdv(f.ctx);
  await salvarRecebimentosPdv(f.ctx, {
    regras: cfg.regras.map((r) => ({ ...r, ativa: true })),
  });
  await db.pdvVenda.update({
    where: { id: v.vendaId },
    data: {
      criadaEm: new Date("2026-10-31T16:00:00Z"),
      recebidoEm: new Date("2026-11-01T02:00:00Z"),
    },
  });
  await Promise.all([
    processarRecebimentosPdv(f.ctx),
    processarRecebimentosPdv(f.ctx),
  ]);
  await processarRecebimentosPdv(f.ctx);
  const lancamentos = await db.lancamento.findMany({
    where: { unidadeId: f.unidade.id },
    include: { baixas: true },
  });
  assert.equal(lancamentos.length, 3);
  assert.equal(
    lancamentos.reduce((s, l) => s + Number(l.valor), 0),
    20,
  );
  const dinheiro = lancamentos.find((l) => l.tipoPagamento === "DINHEIRO")!,
    cartao = lancamentos.find((l) => l.tipoPagamento === "CREDITO")!;
  assert.equal(String(dinheiro.valor), "5", "troco fica fora da receita");
  assert.equal(dinheiro.status, "QUITADO");
  assert.equal(dinheiro.baixas.length, 1);
  assert.equal(dinheiro.baixas[0].origem, "pdv");
  assert.equal(cartao.status, "ABERTO");
  assert.equal(String(cartao.desconto), "0.3");
  assert.equal(cartao.competencia!.toISOString().slice(0, 10), "2026-10-31");
  assert.equal(cartao.vencimento.toISOString().slice(0, 10), "2026-11-30");
  assert.equal(cartao.baixas.length, 0);
  await salvarRecebimentosPdv(f.ctx, {
    regras: (await consultarRecebimentosPdv(f.ctx)).regras.map((r) => ({
      ...r,
      taxaBps: r.forma === "CREDITO" ? 500 : r.taxaBps,
    })),
  });
  await processarRecebimentosPdv(f.ctx);
  assert.equal(
    String(
      (await db.lancamento.findUniqueOrThrow({ where: { id: cartao.id } }))
        .desconto,
    ),
    "0.3",
  );
  await cancelarVenda(f.ctx, {
    vendaId: v.vendaId,
    motivo: "Cliente desistiu",
  });
  const cancelamento = await processarRecebimentosPdv(f.ctx);
  assert.equal(cancelamento.aguardando, 1);
  assert.equal(
    (await db.lancamento.findUniqueOrThrow({ where: { id: dinheiro.id } }))
      .status,
    "QUITADO",
    "baixa não desaparece sem confirmação da devolução",
  );
  await estornarBaixaIntegrada(f.ctx, dinheiro.baixas[0].id);
  await processarRecebimentosPdv(f.ctx);
  assert.equal(
    await db.lancamento.count({
      where: { unidadeId: f.unidade.id, status: "CANCELADO" },
    }),
    3,
  );
  assert.equal((await consultarRecebimentosPdv(f.ctx)).pendentes, 0);
});

test("venda pendente publica somente ao receber; cancelamento antes da integração não cria receita", async () => {
  const f = await fixture();
  await configurarPdv(f, { cartao: true });
  const v = await f.vender({ pagamentoPendente: true, pagamentos: [] });
  assert.equal((await consultarRecebimentosPdv(f.ctx)).pendentes, 0);
  await fecharCaixa(f.ctx, {
    caixaId: v.caixaId,
    valorContadoCentavos: 0,
    observacao: "Fim do turno fictício",
  });
  const caixaNovo = await abrirCaixa(f.ctx, {
    saldoInicialCentavos: 0,
    localEstoqueId: f.local.id,
  });
  const receber = {
    vendaId: v.vendaId,
    versaoFinanceira: 1,
    caixaId: caixaNovo,
    chave: randomUUID(),
    pagamentos: [{ forma: "PIX", valorCentavos: 2000 }],
  };
  await receberPedido(f.ctx, receber);
  await receberPedido(f.ctx, receber);
  assert.equal((await consultarRecebimentosPdv(f.ctx)).pendentes, 1);
  await cancelarVenda(f.ctx, {
    vendaId: v.vendaId,
    versaoFinanceira: 2,
    motivo: "Cliente desistiu",
  });
  await processarRecebimentosPdv(f.ctx);
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal((await consultarRecebimentosPdv(f.ctx)).pendentes, 0);
});

test("fila financeira mantém unidades isoladas e recebimento posterior cria uma obrigação sem baixar Pix por omissão", async () => {
  const f = await fixture(),
    outro = await fixture();
  await configurarPdv(f, { cartao: true });
  const v = await f.vender({ pagamentoPendente: true, pagamentos: [] });
  await receberPedido(f.ctx, {
    vendaId: v.vendaId,
    versaoFinanceira: 1,
    caixaId: v.caixaId,
    chave: randomUUID(),
    pagamentos: [{ forma: "PIX", valorCentavos: 2000 }],
  });
  await db.pdvVenda.update({
    where: { id: v.vendaId },
    data: {
      criadaEm: new Date("2026-10-01T15:00:00Z"),
      recebidoEm: new Date("2026-11-01T15:00:00Z"),
    },
  });
  await processarRecebimentosPdv(outro.ctx);
  assert.equal((await consultarRecebimentosPdv(f.ctx)).pendentes, 1);
  await processarRecebimentosPdv(f.ctx);
  const l = await db.lancamento.findFirstOrThrow({
    where: { unidadeId: f.unidade.id },
  });
  assert.equal(l.status, "ABERTO");
  assert.equal(String(l.valor), "20");
  assert.equal(l.contaId, f.conta.id);
  assert.equal(
    l.competencia!.toISOString().slice(0, 10),
    "2026-10-01",
    "recebimento posterior não muda a competência da venda",
  );
  assert.equal(l.vencimento.toISOString().slice(0, 10), "2026-11-01");
  assert.equal(
    await db.baixaFinanceira.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  await cancelarVenda(f.ctx, {
    vendaId: v.vendaId,
    motivo: "Desistência fictícia",
  });
  await processarRecebimentosPdv(f.ctx);
  assert.equal(
    (await db.lancamento.findUniqueOrThrow({ where: { id: l.id } })).status,
    "CANCELADO",
  );
});

test("PostgreSQL restringe a configuração de recebimentos à organização e unidade da transação", async () => {
  const f = await fixture(),
    outro = await fixture();
  await configurarPdv(f);
  await configurarPdv(outro);
  await db.$executeRawUnsafe(
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='recebimentos_pdv_rls_test') THEN CREATE ROLE recebimentos_pdv_rls_test NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$",
  );
  await db.$executeRawUnsafe(
    "GRANT USAGE ON SCHEMA public TO recebimentos_pdv_rls_test",
  );
  await db.$executeRawUnsafe(
    "GRANT SELECT,INSERT,UPDATE ON configuracao_recebimento_pdv TO recebimentos_pdv_rls_test",
  );
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE recebimentos_pdv_rls_test");
    await tx.$queryRaw`SELECT set_config('tetteo.financeiro_organizacao',${f.org.id},true),set_config('tetteo.financeiro_unidade',${f.unidade.id},true)`;
    const visiveis = await tx.configuracaoRecebimentoPdv.findMany();
    assert.equal(visiveis.length, 4);
    assert.ok(visiveis.every((r) => r.unidadeId === f.unidade.id));
    assert.equal(
      (
        await tx.configuracaoRecebimentoPdv.updateMany({
          where: { unidadeId: outro.unidade.id },
          data: { ativa: false },
        })
      ).count,
      0,
    );
  });
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE recebimentos_pdv_rls_test");
      await tx.$queryRaw`SELECT set_config('tetteo.financeiro_organizacao',${f.org.id},true),set_config('tetteo.financeiro_unidade',${f.unidade.id},true)`;
      await tx.configuracaoRecebimentoPdv.create({
        data: {
          unidadeId: randomUUID(),
          organizacaoId: outro.org.id,
          forma: "PIX",
        },
      });
    }),
  );
});
