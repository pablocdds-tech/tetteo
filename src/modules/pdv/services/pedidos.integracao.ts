import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { FinalizarEntrada } from "../types";
import { abrirCaixa, cancelarVenda, fecharCaixa, finalizarVenda } from "./pdv";
import { listarPedidos, moverPedido } from "./pedidos";
import { diaPedidos } from "../schemas/pedido";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("pedidos controlam produção, versão, isolamento e cancelamento sem duplicar estoque ou pagamento", async () => {
  const prefixo = `pedidos-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "Pedidos fictícios", slug: prefixo },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "TESTE" },
  });
  const outra = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Outra loja fictícia",
      codigo: "OUTRA",
    },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador fictício",
      email: `${prefixo}@example.invalid`,
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
    organizacao: { id: org.id, nome: org.nome },
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
      nome: "Produto fictício",
      unidadeMedida: "UN",
      custoMedio: 2,
    },
  });
  const ficha = await db.fichaTecnica.create({
    data: {
      organizacaoId: org.id,
      nome: "Prato fictício",
      precoVenda: 10,
      rendimento: 1,
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: unidade.id,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: 100,
    },
  });
  const caixaId = await abrirCaixa(ctx, {
    saldoInicialCentavos: 1000,
    localEstoqueId: local.id,
  });
  const base: FinalizarEntrada = {
    chave: randomUUID(),
    caixaId,
    modalidade: "ENTREGA",
    observacao: "Pedido fictício",
    itens: [{ produtoId: ficha.id, quantidade: 1, opcoes: [], observacao: "" }],
    descontoCentavos: 0,
    taxaCentavos: 0,
    pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
  };
  const entregaId = await finalizarVenda(ctx, base);
  assert.equal(await finalizarVenda(ctx, base), entregaId);
  const cozinha = (await listarPedidos(ctx)).pedidos.find(
    (p) => p.vendaId === entregaId,
  )!;
  assert.equal(cozinha.status, "COZINHA");
  assert.equal(cozinha.numero, 1);
  assert.equal(cozinha.versao, 1);
  assert.equal(cozinha.historico.length, 1);
  assert.equal(
    await db.pdvPedido.count({ where: { unidadeId: unidade.id } }),
    1,
  );
  const apenasLeitura = { ...ctx, permissoes: new Set(["pdv.ver"]) };
  assert.equal((await listarPedidos(apenasLeitura)).ativosTotal, 1);
  await assert.rejects(
    () =>
      moverPedido(apenasLeitura, {
        pedidoId: cozinha.id,
        versao: 1,
        destino: "AGUARDANDO_COLETA",
      }),
    /permissão/,
  );
  await assert.rejects(
    () =>
      moverPedido(
        { ...ctx, unidadeAtiva: outra },
        { pedidoId: cozinha.id, versao: 1, destino: "AGUARDANDO_COLETA" },
      ),
    /indisponível/,
  );
  assert.equal(
    (await listarPedidos({ ...ctx, unidadeAtiva: outra })).pedidos.length,
    0,
  );
  const snapshot = await db.pdvVenda.findUniqueOrThrow({
    where: { id: entregaId },
  });
  const saldoAntes = (
    await db.posicaoEstoque.findUniqueOrThrow({
      where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
    })
  ).quantidade.toString();
  await assert.rejects(
    () =>
      moverPedido(ctx, {
        pedidoId: cozinha.id,
        versao: 1,
        destino: "ENTREGUE",
      }),
    /não é permitida/,
  );
  await assert.rejects(() =>
    moverPedido(ctx, { pedidoId: cozinha.id, versao: 1, destino: "CANCELADO" }),
  );
  const prontas = await Promise.all([
    moverPedido(ctx, {
      pedidoId: cozinha.id,
      versao: 1,
      destino: "AGUARDANDO_COLETA",
    }),
    moverPedido(ctx, {
      pedidoId: cozinha.id,
      versao: 1,
      destino: "AGUARDANDO_COLETA",
    }),
  ]);
  assert.equal(prontas[0].versao, 2);
  assert.equal(prontas[1].versao, 2);
  assert.equal(prontas[0].historico.length, 2);
  assert.ok(prontas[0].prontoEm);
  await assert.rejects(
    () =>
      moverPedido(ctx, {
        pedidoId: cozinha.id,
        versao: 1,
        destino: "SAIU_ENTREGA",
      }),
    /outra tela/,
  );
  const saiu = await moverPedido(ctx, {
    pedidoId: cozinha.id,
    versao: 2,
    destino: "SAIU_ENTREGA",
  });
  assert.equal(saiu.versao, 3);
  assert.ok(saiu.saiuEntregaEm);
  await assert.rejects(
    () =>
      cancelarVenda(ctx, {
        vendaId: entregaId,
        motivo: "Cancelamento fictício",
        pedidoId: cozinha.id,
        versaoPedido: 2,
      }),
    /outra tela/,
  );
  const entregue = await moverPedido(ctx, {
    pedidoId: cozinha.id,
    versao: 3,
    destino: "ENTREGUE",
  });
  assert.equal(entregue.versao, 4);
  assert.ok(entregue.entregueEm);
  const depois = await db.pdvVenda.findUniqueOrThrow({
    where: { id: entregaId },
  });
  assert.deepEqual(depois, snapshot);
  assert.equal(
    (
      await db.posicaoEstoque.findUniqueOrThrow({
        where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
      })
    ).quantidade.toString(),
    saldoAntes,
  );
  assert.equal(
    await db.movimentoEstoque.count({ where: { unidadeId: unidade.id } }),
    1,
  );
  await cancelarVenda(ctx, {
    vendaId: entregaId,
    motivo: "Devolução fictícia",
    pedidoId: cozinha.id,
    versaoPedido: 4,
  });
  await cancelarVenda(ctx, {
    vendaId: entregaId,
    motivo: "Devolução fictícia",
    pedidoId: cozinha.id,
    versaoPedido: 4,
  });
  const cancelado = (await listarPedidos(ctx)).pedidos.find(
    (p) => p.id === cozinha.id,
  )!;
  assert.equal(cancelado.status, "CANCELADO");
  assert.equal(cancelado.versao, 5);
  assert.equal(cancelado.venda.status, "CANCELADA");
  assert.equal(cancelado.historico.length, 5);
  assert.equal(cancelado.historico.at(-1)!.observacao, "Devolução fictícia");
  assert.equal(
    await db.movimentoEstoque.count({
      where: { unidadeId: unidade.id, tipo: "ESTORNO_VENDA" },
    }),
    1,
  );
  assert.equal(
    (
      await db.posicaoEstoque.findUniqueOrThrow({
        where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
      })
    ).quantidade.toString(),
    "100",
  );
  await assert.rejects(
    () =>
      moverPedido(ctx, {
        pedidoId: cozinha.id,
        versao: 5,
        destino: "ENTREGUE",
      }),
    /cancelada/,
  );
  const balcaoId = await finalizarVenda(ctx, {
    ...base,
    chave: randomUUID(),
    modalidade: "BALCAO",
  });
  const balcao = (await listarPedidos(ctx)).pedidos.find(
    (p) => p.vendaId === balcaoId,
  )!;
  await db.pdvPedido.update({
    where: { id: balcao.id },
    data: { criadoEm: new Date("2026-10-20T12:00:00Z") },
  });
  assert.ok(
    (await listarPedidos(ctx, { dia: "2026-10-27" })).pedidos.some(
      (p) => p.id === balcao.id,
    ),
    "ativo de outro dia permanece no quadro",
  );
  const coletaBalcao = await moverPedido(ctx, {
    pedidoId: balcao.id,
    versao: 1,
    destino: "AGUARDANDO_COLETA",
  });
  await assert.rejects(
    () =>
      moverPedido(ctx, {
        pedidoId: balcao.id,
        versao: 2,
        destino: "SAIU_ENTREGA",
      }),
    /não é permitida/,
  );
  await moverPedido(ctx, {
    pedidoId: coletaBalcao.id,
    versao: 2,
    destino: "ENTREGUE",
  });
  await db.pdvPedido.update({
    where: { id: balcao.id },
    data: { entregueEm: new Date("2026-10-27T02:59:59Z") },
  });
  assert.ok(
    (await listarPedidos(ctx, { dia: "2026-10-26" })).pedidos.some(
      (p) => p.id === balcao.id,
    ),
  );
  assert.ok(
    !(await listarPedidos(ctx, { dia: "2026-10-27" })).pedidos.some(
      (p) => p.id === balcao.id,
    ),
    "entregue respeita dia civil SP",
  );
  const retiradaId = await finalizarVenda(ctx, {
    ...base,
    chave: randomUUID(),
    modalidade: "RETIRADA",
  });
  const retirada = (await listarPedidos(ctx)).pedidos.find(
    (p) => p.vendaId === retiradaId,
  )!;
  await assert.rejects(
    () =>
      cancelarVenda(ctx, {
        vendaId: retiradaId,
        motivo: "Pedido diferente",
        pedidoId: balcao.id,
        versaoPedido: 3,
      }),
    /indisponível/,
  );
  await assert.rejects(
    () =>
      finalizarVenda(ctx, {
        ...base,
        chave: randomUUID(),
        itens: [{ ...base.itens[0], quantidade: 999 }],
        pagamentos: [{ forma: "PIX", valorCentavos: 999000 }],
      }),
    /Estoque insuficiente/,
  );
  assert.equal(
    await db.pdvPedido.count({ where: { unidadeId: unidade.id } }),
    3,
    "falha da venda não deixa pedido órfão",
  );
  await fecharCaixa(ctx, {
    caixaId,
    valorContadoCentavos: 1000,
    observacao: "Teste de encerramento",
  });
  await assert.rejects(
    () =>
      cancelarVenda(ctx, {
        vendaId: retiradaId,
        motivo: "Caixa encerrado",
        pedidoId: retirada.id,
        versaoPedido: 1,
      }),
    /já foi fechado/,
  );
  assert.equal(
    (await db.pdvPedido.findUniqueOrThrow({ where: { id: retirada.id } }))
      .status,
    "COZINHA",
  );
  const prontoRetirada = await moverPedido(ctx, {
    pedidoId: retirada.id,
    versao: 1,
    destino: "AGUARDANDO_COLETA",
  });
  assert.equal(
    prontoRetirada.versao,
    2,
    "produção continua independente de caixa fechado",
  );
  assert.ok(
    (await db.auditoria.count({
      where: { organizacaoId: org.id, entidade: "PdvPedido" },
    })) >= 10,
  );

  // Volume sintético local: contagens completas e limites explícitos no retorno.
  const dadosVenda = {
    organizacaoId: org.id,
    unidadeId: unidade.id,
    caixaId,
    usuarioId: usuario.id,
    operador: usuario.nome,
    modalidade: "RETIRADA",
    observacao: "Volume fictício",
    payloadHash: "teste",
    subtotalCentavos: 1000,
    descontoCentavos: 0,
    taxaCentavos: 0,
    totalCentavos: 1000,
    trocoCentavos: 0,
    itens: [],
    pagamentos: [],
    consumo: [],
  };
  const ids = Array.from({ length: 702 }, () => randomUUID());
  await db.pdvVenda.createMany({
    data: ids.map((id) => ({ ...dadosVenda, id, chave: randomUUID() })),
  });
  const hoje = diaPedidos();
  await db.pdvPedido.createMany({
    data: ids.map((id, n) => ({
      id: randomUUID(),
      organizacaoId: org.id,
      unidadeId: unidade.id,
      vendaId: id,
      numero: n + 4,
      status: n < 501 ? "COZINHA" : "ENTREGUE",
      entregueEm: n < 501 ? null : new Date(`${hoje}T12:00:00-03:00`),
      atualizadoEm: new Date(),
    })),
  });
  const volumoso = await listarPedidos(ctx, { dia: hoje });
  assert.equal(volumoso.ativosExibidos, 500);
  assert.equal(volumoso.limiteAtivos, 500);
  assert.equal(volumoso.ativosTotal, 502);
  assert.equal(volumoso.finalizadosExibidos, 200);
  assert.ok(volumoso.finalizadosTotal >= 201);
  assert.equal(volumoso.truncado, true);
});
