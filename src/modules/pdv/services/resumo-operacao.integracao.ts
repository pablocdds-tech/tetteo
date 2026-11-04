import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import { consultarResumoOperacao } from "./resumo-operacao";

const alvo = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(alvo.hostname) ||
  !alvo.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");

after(async () => db.$disconnect());

test("resumo operacional isola unidades e organizações, distingue faturamento e não inicia agendados", async () => {
  const prefixo = `resumo-operacao-test-${randomUUID()}`;
  const organizacao = await db.organizacao.create({
    data: { nome: "Resumo operacional fictício", slug: prefixo },
  });
  const outraOrganizacao = await db.organizacao.create({
    data: { nome: "Outra organização fictícia", slug: `${prefixo}-outra` },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: organizacao.id, nome: "Loja fictícia", codigo: "A" },
  });
  const outraUnidade = await db.unidade.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Outra loja fictícia",
      codigo: "B",
    },
  });
  const unidadeExterna = await db.unidade.create({
    data: {
      organizacaoId: outraOrganizacao.id,
      nome: "Loja externa fictícia",
      codigo: "C",
    },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador fictício",
      email: `${prefixo}@example.invalid`,
      status: "ATIVO",
    },
  });
  const contexto: ContextoSessao = {
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      avatarUrl: null,
    },
    organizacao: { id: organizacao.id, nome: organizacao.nome },
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade, outraUnidade],
    podeVerRedeInteira: true,
    permissoes: new Set(["pdv.ver"]),
    ehDiretor: false,
  };
  const agora = new Date("2026-11-04T18:00:00Z");
  let numero = 0;

  async function abrirCaixa(loja: typeof unidade) {
    const local = await db.localEstoque.create({
      data: { unidadeId: loja.id, nome: "Estoque fictício do resumo" },
    });
    return db.pdvCaixa.create({
      data: {
        organizacaoId: loja.organizacaoId,
        unidadeId: loja.id,
        localEstoqueId: local.id,
        abertoPorId: usuario.id,
        operador: usuario.nome,
        saldoInicialCentavos: 0,
      },
    });
  }

  const caixa = await abrirCaixa(unidade);
  const caixaOutro = await abrirCaixa(outraUnidade);
  const caixaExterno = await abrirCaixa(unidadeExterna);

  async function criarVenda(
    loja: typeof unidade,
    caixaId: string,
    criadaEm: string,
    valor: number,
    status = "CONCLUIDA",
    etapa = "ENTREGUE",
  ) {
    const venda = await db.pdvVenda.create({
      data: {
        organizacaoId: loja.organizacaoId,
        unidadeId: loja.id,
        caixaId,
        chave: randomUUID(),
        payloadHash: "resumo-ficticio",
        usuarioId: usuario.id,
        operador: usuario.nome,
        cliente: "Cliente fictício que não deve sair no resumo",
        modalidade: "BALCAO",
        subtotalCentavos: valor,
        descontoCentavos: 0,
        taxaCentavos: 0,
        totalCentavos: valor,
        trocoCentavos: 0,
        itens: [],
        pagamentos:
          status === "PENDENTE" ? [] : [{ forma: "PIX", valorCentavos: valor }],
        consumo: [],
        status,
        criadaEm: new Date(criadaEm),
      },
    });
    const pedido = await db.pdvPedido.create({
      data: {
        organizacaoId: loja.organizacaoId,
        unidadeId: loja.id,
        vendaId: venda.id,
        numero: ++numero,
        status: etapa,
        criadoEm: new Date(criadaEm),
        entregueEm: etapa === "ENTREGUE" ? new Date(criadaEm) : null,
        canceladoEm: etapa === "CANCELADO" ? new Date(criadaEm) : null,
      },
    });
    return { venda, pedido };
  }

  await criarVenda(unidade, caixa.id, "2026-11-04T03:00:00Z", 2000);
  await criarVenda(unidade, caixa.id, "2026-10-29T03:00:00Z", 1000);
  await criarVenda(
    unidade,
    caixa.id,
    "2026-11-04T12:00:00Z",
    9000,
    "PENDENTE",
    "AGUARDANDO_COLETA",
  );
  await criarVenda(
    unidade,
    caixa.id,
    "2026-11-04T12:00:00Z",
    8000,
    "CANCELADA",
    "CANCELADO",
  );
  await criarVenda(unidade, caixa.id, "2026-10-29T02:59:59.999Z", 7000);
  await criarVenda(unidade, caixa.id, "2026-11-04T18:00:00.001Z", 6000);

  // Pedidos antigos continuam ao vivo, mas não entram no recorte de sete dias.
  const ativos: string[] = [];
  for (let n = 0; n < 6; n++) {
    const registro = await criarVenda(
      unidade,
      caixa.id,
      `2026-10-20T12:0${n}:00Z`,
      100,
      "CONCLUIDA",
      "COZINHA",
    );
    ativos.push(registro.pedido.id);
  }
  await criarVenda(
    outraUnidade,
    caixaOutro.id,
    "2026-11-04T12:00:00Z",
    555_000,
    "CONCLUIDA",
    "COZINHA",
  );
  await criarVenda(
    unidadeExterna,
    caixaExterno.id,
    "2026-11-04T12:00:00Z",
    999_000,
    "CONCLUIDA",
    "COZINHA",
  );

  const vendaAgendada = await db.pdvVenda.create({
    data: {
      organizacaoId: organizacao.id,
      unidadeId: unidade.id,
      caixaId: caixa.id,
      chave: randomUUID(),
      payloadHash: "agendado-ficticio",
      usuarioId: usuario.id,
      operador: usuario.nome,
      modalidade: "BALCAO",
      subtotalCentavos: 100,
      descontoCentavos: 0,
      taxaCentavos: 0,
      totalCentavos: 100,
      trocoCentavos: 0,
      itens: [],
      pagamentos: [],
      consumo: [],
      status: "PENDENTE",
      criadaEm: new Date("2026-10-20T12:00:00Z"),
    },
  });
  // Este teste roda com o servidor de desenvolvimento parado, pois seu worker
  // avança agendamentos independentemente das leituras feitas pelo painel.
  const preparo = new Date(Date.now() - 60 * 60_000);
  const agendado = await db.pdvPedido.create({
    data: {
      organizacaoId: organizacao.id,
      unidadeId: unidade.id,
      vendaId: vendaAgendada.id,
      numero: ++numero,
      status: "AGENDADO",
      criadoEm: vendaAgendada.criadaEm,
      iniciarPreparoEm: preparo,
      agendadoPara: new Date(preparo.getTime() + 30 * 60_000),
      antecedenciaMinutos: 30,
      eventos: {
        create: {
          para: "AGENDADO",
          versao: 1,
          operador: usuario.nome,
          usuarioId: usuario.id,
        },
      },
    },
  });

  const resumo = await consultarResumoOperacao(contexto, agora);
  assert.equal(resumo.faturamentoHoje, 2000);
  assert.equal(resumo.faturamentoSemana, 3000);
  assert.equal(resumo.vendasHoje, 1);
  assert.equal(resumo.vendasSemana, 2);
  assert.equal(resumo.pedidosSemana, 3);
  assert.equal(resumo.aoVivo, 7);
  assert.equal(resumo.recentes.length, 5);
  assert.ok(resumo.recentes.every((p) => ativos.includes(p.id)));
  assert.deepEqual(Object.keys(resumo.recentes[0]).sort(), [
    "id",
    "minutos",
    "numero",
    "status",
  ]);

  const resumoOutraUnidade = await consultarResumoOperacao(
    { ...contexto, unidadeAtiva: outraUnidade },
    agora,
  );
  assert.equal(resumoOutraUnidade.faturamentoHoje, 555_000);
  assert.equal(resumoOutraUnidade.pedidosSemana, 1);
  assert.equal(resumoOutraUnidade.aoVivo, 1);

  await assert.rejects(
    () =>
      consultarResumoOperacao({ ...contexto, permissoes: new Set() }, agora),
    SemPermissao,
  );
  await assert.rejects(
    () => consultarResumoOperacao({ ...contexto, unidadeAtiva: null }, agora),
    ExigeUnidade,
  );
  await assert.rejects(
    () =>
      consultarResumoOperacao(
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
      consultarResumoOperacao(
        {
          ...contexto,
          unidadeAtiva: unidadeExterna,
          unidadesVisiveis: [unidadeExterna],
        },
        agora,
      ),
    SemPermissao,
  );

  const depois = await db.pdvPedido.findUniqueOrThrow({
    where: { id: agendado.id },
    include: { eventos: true },
  });
  assert.equal(depois.status, "AGENDADO");
  assert.equal(depois.versao, agendado.versao);
  assert.equal(depois.preparoIniciadoEm, null);
  assert.equal(depois.atualizadoEm.getTime(), agendado.atualizadoEm.getTime());
  assert.equal(depois.eventos.length, 1);
});
