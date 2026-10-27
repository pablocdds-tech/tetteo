import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { ItemVendaPdv, PagamentoPdv, VendaPdv } from "../types";
import type { PedidoPdv, QuadroPedidos, StatusPedido } from "../pedido-types";
import { ErroPdv } from "../schemas/erro";
import { esquemaEntregaSnapshot } from "../schemas/entrega";
import {
  diaPedidos,
  esquemaListaPedidos,
  esquemaMoverPedido,
  periodoPedidos,
  STATUS_PEDIDO,
  validarTransicaoPedido,
} from "../schemas/pedido";
import { exigirEscopo } from "./pdv";

const incluirEventos = {
  eventos: { orderBy: { versao: "asc" as const } },
} satisfies Prisma.PdvPedidoInclude;
type PedidoBanco = Prisma.PdvPedidoGetPayload<{
  include: typeof incluirEventos;
}>;
type VendaBanco = Prisma.PdvVendaGetPayload<object>;
function vendaSerializada(v: VendaBanco): VendaPdv {
  return {
    id: v.id,
    criadaEm: v.criadaEm.toISOString(),
    cliente: v.cliente,
    modalidade: v.modalidade,
    status: v.status as VendaPdv["status"],
    totalCentavos: v.totalCentavos,
    subtotalCentavos: v.subtotalCentavos,
    descontoCentavos: v.descontoCentavos,
    taxaCentavos: v.taxaCentavos,
    freteCentavos: v.freteCentavos,
    trocoCentavos: v.trocoCentavos,
    observacao: v.observacao,
    operador: v.operador,
    itens: v.itens as ItemVendaPdv[],
    pagamentos: v.pagamentos as PagamentoPdv[],
    motivoCancelamento: v.motivoCancelamento,
  };
}
function serializarPedido(
  p: PedidoBanco,
  v: VendaBanco,
  ctx: ContextoSessao,
): PedidoPdv {
  const entrega = pode(ctx, "pdv.entrega")
    ? esquemaEntregaSnapshot.safeParse(v.entrega)
    : null;
  return {
    id: p.id,
    vendaId: p.vendaId,
    numero: p.numero,
    versao: p.versao,
    status: p.status as StatusPedido,
    criadoEm: p.criadoEm.toISOString(),
    atualizadoEm: p.atualizadoEm.toISOString(),
    prontoEm: p.prontoEm?.toISOString() ?? null,
    saiuEntregaEm: p.saiuEntregaEm?.toISOString() ?? null,
    entregueEm: p.entregueEm?.toISOString() ?? null,
    canceladoEm: p.canceladoEm?.toISOString() ?? null,
    entrega: entrega?.success ? entrega.data : null,
    temEnderecoEntrega: v.entrega !== null,
    entregadorId: p.entregadorId,
    entregadorNome: p.entregadorNome,
    venda: vendaSerializada(v),
    historico: p.eventos.map((e) => ({
      id: e.id,
      de: e.de as StatusPedido | null,
      para: e.para as StatusPedido,
      versao: e.versao,
      operador: e.operador,
      observacao: e.observacao,
      criadoEm: e.criadoEm.toISOString(),
    })),
  };
}
export async function listarPedidos(
  ctx: ContextoSessao,
  entrada: unknown = {},
): Promise<QuadroPedidos> {
  const escopo = await exigirEscopo(ctx);
  const dados = esquemaListaPedidos.parse(entrada);
  const dia = dados.dia ?? diaPedidos();
  const periodo = periodoPedidos(dia);
  const ativo: Prisma.PdvPedidoWhereInput = {
    ...escopo,
    status: { in: ["COZINHA", "AGUARDANDO_COLETA", "SAIU_ENTREGA"] },
  };
  const finalizado: Prisma.PdvPedidoWhereInput = {
    ...escopo,
    OR: [
      {
        status: "ENTREGUE",
        entregueEm: { gte: periodo.inicio, lt: periodo.fim },
      },
      {
        status: "CANCELADO",
        canceladoEm: { gte: periodo.inicio, lt: periodo.fim },
      },
    ],
  };
  return db.$transaction(
    async (tx) => {
      const [ativos, finalizados, contagens] = await Promise.all([
        tx.pdvPedido.findMany({
          where: ativo,
          include: incluirEventos,
          orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
          take: 500,
        }),
        tx.pdvPedido.findMany({
          where: finalizado,
          include: incluirEventos,
          orderBy: [{ atualizadoEm: "desc" }, { id: "desc" }],
          take: 200,
        }),
        tx.pdvPedido.groupBy({
          by: ["status"],
          where: { OR: [ativo, finalizado] },
          _count: { _all: true },
        }),
      ]);
      const todos = [...ativos, ...finalizados];
      const vendas = await tx.pdvVenda.findMany({
        where: { ...escopo, id: { in: todos.map((p) => p.vendaId) } },
      });
      const mapa = new Map(vendas.map((v) => [v.id, v]));
      const totais = Object.fromEntries(
        STATUS_PEDIDO.map((s) => [
          s,
          contagens.find((c) => c.status === s)?._count._all ?? 0,
        ]),
      ) as Record<StatusPedido, number>;
      const ativosTotal =
        totais.COZINHA + totais.AGUARDANDO_COLETA + totais.SAIU_ENTREGA;
      const finalizadosTotal = totais.ENTREGUE + totais.CANCELADO;
      return {
        dia,
        pedidos: todos.map((p) => {
          const venda = mapa.get(p.vendaId);
          if (!venda)
            throw new ErroPdv("Pedido sem venda disponível nesta unidade.");
          return serializarPedido(p, venda, ctx);
        }),
        totais,
        ativosTotal,
        finalizadosTotal,
        ativosExibidos: ativos.length,
        finalizadosExibidos: finalizados.length,
        limiteAtivos: 500,
        limiteFinalizados: 200,
        truncado:
          ativos.length < ativosTotal || finalizados.length < finalizadosTotal,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20_000,
    },
  );
}
export async function moverPedido(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<PedidoPdv> {
  const escopo = await exigirEscopo(ctx, "pdv.operar");
  const dados = esquemaMoverPedido.parse(entrada);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pdv:${escopo.organizacaoId}:${escopo.unidadeId}`},0))`;
    const pedido = await tx.pdvPedido.findFirst({
      where: { ...escopo, id: dados.pedidoId },
      include: incluirEventos,
    });
    if (!pedido) throw new ErroPdv("Pedido indisponível nesta unidade.");
    const venda = await tx.pdvVenda.findFirst({
      where: { ...escopo, id: pedido.vendaId },
    });
    if (!venda)
      throw new ErroPdv("Venda deste pedido não encontrada nesta unidade.");
    // Uma resposta perdida da mesma transição recupera a confirmação sem novo evento.
    if (pedido.versao === dados.versao + 1 && pedido.status === dados.destino)
      return serializarPedido(pedido, venda, ctx);
    if (pedido.versao !== dados.versao)
      throw new ErroPdv(
        "Este pedido mudou em outra tela. Atualize o quadro antes de continuar.",
      );
    if (venda.status !== "CONCLUIDA")
      throw new ErroPdv("A venda deste pedido foi cancelada.");
    validarTransicaoPedido(
      pedido.status as StatusPedido,
      dados.destino,
      venda.modalidade,
    );
    if (dados.destino === "SAIU_ENTREGA" && venda.entrega !== null) {
      if (!pode(ctx, "pdv.entrega"))
        throw new ErroPdv(
          "Seu perfil precisa de permissão de entrega para despachar este pedido.",
        );
      const entregador = pedido.entregadorId
        ? await tx.pdvEntregador.findFirst({
            where: { ...escopo, id: pedido.entregadorId, ativo: true },
            select: { id: true },
          })
        : null;
      if (!entregador)
        throw new ErroPdv(
          "Atribua um entregador ativo antes de marcar a saída para entrega.",
        );
    }
    const agora = new Date();
    const atualizado = await tx.pdvPedido.update({
      where: { id: pedido.id },
      data: {
        status: dados.destino,
        versao: { increment: 1 },
        ...(dados.destino === "AGUARDANDO_COLETA" ? { prontoEm: agora } : {}),
        ...(dados.destino === "SAIU_ENTREGA" ? { saiuEntregaEm: agora } : {}),
        ...(dados.destino === "ENTREGUE" ? { entregueEm: agora } : {}),
        eventos: {
          create: {
            de: pedido.status,
            para: dados.destino,
            versao: pedido.versao + 1,
            usuarioId: ctx.usuario.id,
            operador: ctx.usuario.nome,
          },
        },
      },
      include: incluirEventos,
    });
    await tx.auditoria.create({
      data: {
        ...escopo,
        usuarioId: ctx.usuario.id,
        entidade: "PdvPedido",
        entidadeId: pedido.id,
        acao: "ALTEROU",
        valoresAntes: { status: pedido.status, versao: pedido.versao },
        valoresDepois: { status: atualizado.status, versao: atualizado.versao },
      },
    });
    return serializarPedido(atualizado, venda, ctx);
  });
}
