import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { FinalizarEntrada } from "../types";
import { formatoLocalSaoPaulo } from "../schemas/agendamento";
import { processarAgendamentosVencidos } from "./agendamentos";
import { abrirCaixa, cancelarVenda, finalizarVenda } from "./pdv";
import { listarPedidos, moverPedido } from "./pedidos";
import { receberPedido } from "./recebimentos";

const alvo = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(alvo.hostname) ||
  !alvo.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

async function cenario() {
  const org = await db.organizacao.create({
    data: { nome: "Gestão fictícia", slug: `gestao-unificada-${randomUUID()}` },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "TESTE" },
  });
  const outra = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Outra fictícia", codigo: "OUTRA" },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador fictício",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const ctx: ContextoSessao = {
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      avatarUrl: null,
    },
    organizacao: org,
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade, outra],
    podeVerRedeInteira: true,
    permissoes: new Set(["*"]),
    ehDiretor: true,
  };
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local fictício" },
  });
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: org.id,
      nome: "Insumo fictício",
      unidadeMedida: "UN",
      custoMedio: 2,
    },
  });
  const ficha = await db.fichaTecnica.create({
    data: {
      organizacaoId: org.id,
      nome: "Produto fictício",
      precoVenda: 10,
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: unidade.id,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: 30,
    },
  });
  const caixaId = await abrirCaixa(ctx, {
    saldoInicialCentavos: 0,
    localEstoqueId: local.id,
  });
  const entrada = (
    extra: Partial<FinalizarEntrada> = {},
  ): FinalizarEntrada => ({
    chave: randomUUID(),
    caixaId,
    modalidade: "RETIRADA",
    observacao: "Pedido fictício",
    itens: [{ produtoId: ficha.id, quantidade: 1, opcoes: [], observacao: "" }],
    descontoCentavos: 0,
    taxaCentavos: 0,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }],
    ...extra,
  });
  const agenda = (horas: number) => ({
    paraLocal: formatoLocalSaoPaulo(new Date(Date.now() + horas * 3600000)),
    antecedenciaMinutos: 30,
  });
  const pedido = (vendaId: string) =>
    db.pdvPedido.findUniqueOrThrow({
      where: { vendaId },
      include: { eventos: true },
    });
  const saldo = async () =>
    Number(
      (
        await db.posicaoEstoque.findUniqueOrThrow({
          where: {
            localId_insumoId: { localId: local.id, insumoId: insumo.id },
          },
        })
      ).quantidade,
    );
  return {
    org,
    unidade,
    outra,
    usuario,
    ctx,
    caixaId,
    entrada,
    agenda,
    pedido,
    saldo,
  };
}

test("gestão mistura modalidades e agendados sem confundir receber com iniciar e mantém privacidade e totais", async () => {
  const f = await cenario();
  const contato = await db.crmContact.create({
    data: {
      storeId: f.unidade.id,
      name: "Pessoa CRM reservada",
      phone: "5584999999999",
    },
  });
  const entrega = {
    destinatario: "Pessoa entrega reservada",
    telefone: "11900000000",
    endereco: {
      logradouro: "Rua gestão reservada",
      numero: "123",
      complemento: "",
      bairro: "Centro fictício",
      cidade: "Mossoró",
      uf: "RN" as const,
      cep: "",
      referencia: "",
    },
    freteCentavos: 500,
    prazoMinutos: 30,
    motivoFreteManual: "Frete fictício combinado",
  };
  await finalizarVenda(f.ctx, f.entrada());
  await finalizarVenda(
    f.ctx,
    f.entrada({
      modalidade: "ENTREGA",
      entrega,
      clienteId: contato.id,
      pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1500 }],
    }),
  );
  await finalizarVenda(f.ctx, f.entrada({ modalidade: "BALCAO" }));
  const agendadoId = await finalizarVenda(
    f.ctx,
    f.entrada({
      agendamento: f.agenda(2),
      pagamentoPendente: true,
      pagamentos: [],
    }),
  );
  await finalizarVenda(
    f.ctx,
    f.entrada({
      modalidade: "ENTREGA",
      entrega,
      agendamento: f.agenda(24),
      pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1500 }],
    }),
  );
  const entregueId = await finalizarVenda(
    f.ctx,
    f.entrada({ pagamentoPendente: true, pagamentos: [] }),
  );
  let entregue = await f.pedido(entregueId);
  await moverPedido(f.ctx, {
    pedidoId: entregue.id,
    versao: entregue.versao,
    destino: "AGUARDANDO_COLETA",
  });
  entregue = await f.pedido(entregueId);
  await moverPedido(f.ctx, {
    pedidoId: entregue.id,
    versao: entregue.versao,
    destino: "ENTREGUE",
  });
  await db.pdvPedido.update({
    where: { id: entregue.id },
    data: { entregueEm: new Date("2026-01-01T12:00:00Z") },
  });
  const canceladoId = await finalizarVenda(
    f.ctx,
    f.entrada({ modalidade: "BALCAO" }),
  );
  await cancelarVenda(f.ctx, {
    vendaId: canceladoId,
    versaoFinanceira: 1,
    motivo: "Cancelamento fictício",
  });
  const todos = await listarPedidos(f.ctx);
  assert.equal(todos.visao, "TODOS");
  assert.equal(todos.pedidos.length, 7);
  assert.deepEqual(todos.totais, {
    AGENDADO: 2,
    COZINHA: 3,
    AGUARDANDO_COLETA: 0,
    SAIU_ENTREGA: 0,
    ENTREGUE: 1,
    CANCELADO: 1,
  });
  assert.deepEqual(todos.totaisVisao, {
    TODOS: 7,
    EM_ANDAMENTO: 3,
    AGENDADOS: 2,
    RETIRADA: 3,
    ENTREGA: 2,
    BALCAO: 2,
  });
  assert.equal(todos.ativosTotal, 5);
  assert.equal(todos.finalizadosTotal, 2);
  assert.equal(todos.truncado, false);
  for (const [visao, quantidade] of [
    ["AGENDADOS", 2],
    ["RETIRADA", 3],
    ["ENTREGA", 2],
    ["BALCAO", 2],
    ["EM_ANDAMENTO", 3],
  ] as const) {
    const quadro = await listarPedidos(f.ctx, { visao });
    assert.equal(quadro.pedidos.length, quantidade);
    assert.deepEqual(quadro.totaisVisao, todos.totaisVisao);
    if (visao === "AGENDADOS" || visao === "RETIRADA")
      assert.ok(quadro.pedidos.some((p) => p.vendaId === agendadoId));
  }
  const agendado = await f.pedido(agendadoId);
  const saldoAntes = await f.saldo();
  await receberPedido(f.ctx, {
    vendaId: agendadoId,
    versaoFinanceira: 1,
    chave: randomUUID(),
    caixaId: f.caixaId,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }],
  });
  const aposReceber = await listarPedidos(f.ctx, { visao: "AGENDADOS" });
  assert.equal(
    aposReceber.pedidos.find((p) => p.vendaId === agendadoId)!.status,
    "AGENDADO",
  );
  assert.equal(await f.saldo(), saldoAntes);
  assert.equal(
    await processarAgendamentosVencidos(
      { organizacaoId: f.org.id, unidadeId: f.unidade.id },
      new Date(agendado.iniciarPreparoEm!.getTime() + 1000),
    ),
    1,
  );
  const iniciado = await listarPedidos(f.ctx);
  assert.equal(
    iniciado.pedidos.filter((p) => p.vendaId === agendadoId).length,
    1,
  );
  assert.equal(
    iniciado.pedidos.find((p) => p.vendaId === agendadoId)!.status,
    "COZINHA",
  );
  assert.equal(iniciado.totaisVisao.TODOS, 7);
  assert.equal(iniciado.totaisVisao.AGENDADOS, 1);
  assert.equal(iniciado.totaisVisao.EM_ANDAMENTO, 4);
  assert.equal(iniciado.totaisVisao.RETIRADA, 3);
  assert.equal(await f.saldo(), saldoAntes);
  const leitor = {
    ...f.ctx,
    ehDiretor: false,
    permissoes: new Set(["pdv.ver"]),
  };
  const restrito = await listarPedidos(leitor);
  assert.doesNotMatch(
    JSON.stringify(restrito),
    /Pessoa CRM reservada|Pessoa entrega reservada|11900000000|Rua gestão reservada|5584999999999/,
  );
  assert.ok(
    restrito.pedidos
      .filter((p) => p.venda.modalidade === "ENTREGA")
      .every((p) => p.entrega === null && p.venda.cliente === null),
  );
  const externo = await listarPedidos({ ...f.ctx, unidadeAtiva: f.outra });
  assert.equal(externo.pedidos.length, 0);
  assert.equal(externo.totaisVisao.TODOS, 0);
  await assert.rejects(
    () => listarPedidos({ ...leitor, permissoes: new Set() }),
    /permissão/,
  );
  await assert.rejects(() => listarPedidos(f.ctx, { visao: "ENTREGAS" }));
  await assert.rejects(() =>
    listarPedidos(f.ctx, { visao: "TODOS", unidadeId: f.outra.id }),
  );
});

test("gestão filtra modalidade antes do limite de 500 e conta integralmente sem duplicar cartões", async () => {
  const f = await cenario();
  const retiradaId = await finalizarVenda(f.ctx, f.entrada());
  const retirada = await f.pedido(retiradaId);
  const modelo = await db.pdvVenda.findUniqueOrThrow({
    where: { id: retiradaId },
  });
  const antigas = new Date(Date.now() - 86400000);
  const ids = Array.from({ length: 501 }, () => randomUUID());
  await db.pdvVenda.createMany({
    data: ids.map((id) => ({
      id,
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      caixaId: f.caixaId,
      chave: randomUUID(),
      payloadHash: "fixture-gestao",
      usuarioId: f.usuario.id,
      operador: f.usuario.nome,
      status: "PENDENTE",
      modalidade: "ENTREGA",
      subtotalCentavos: 1000,
      descontoCentavos: 0,
      taxaCentavos: 0,
      totalCentavos: 1000,
      trocoCentavos: 0,
      itens: [],
      pagamentos: [],
      consumo: [],
      criadaEm: antigas,
    })),
  });
  await db.pdvPedido.createMany({
    data: ids.map((vendaId, i) => ({
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      vendaId,
      numero: retirada.numero + i + 1,
      status: "COZINHA",
      criadoEm: antigas,
    })),
  });
  const todos = await listarPedidos(f.ctx);
  assert.equal(todos.pedidos.length, 500);
  assert.equal(todos.ativosTotal, 502);
  assert.equal(todos.ativosExibidos, 500);
  assert.equal(todos.truncado, true);
  assert.equal(todos.totaisVisao.TODOS, 502);
  assert.equal(todos.totaisVisao.ENTREGA, 501);
  assert.equal(todos.totaisVisao.RETIRADA, 1);
  assert.ok(
    !todos.pedidos.some((p) => p.vendaId === retiradaId),
    "retirada recente está além dos primeiros 500 misturados",
  );
  const soRetirada = await listarPedidos(f.ctx, { visao: "RETIRADA" });
  assert.equal(soRetirada.pedidos.length, 1);
  assert.equal(soRetirada.pedidos[0].vendaId, retiradaId);
  assert.equal(soRetirada.truncado, false);
  assert.equal(soRetirada.totais.COZINHA, 1);
  assert.deepEqual(soRetirada.totaisVisao, todos.totaisVisao);
  assert.equal(
    new Set(todos.pedidos.map((p) => p.vendaId)).size,
    todos.pedidos.length,
  );
  assert.equal(
    (await db.pdvVenda.findUniqueOrThrow({ where: { id: retiradaId } }))
      .totalCentavos,
    modelo.totalCentavos,
  );
  assert.equal(await f.saldo(), 29);
});
