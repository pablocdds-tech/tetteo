import type { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { esquemaPedidoRecebido, nomeOrigemPedido } from "@/lib/pedido-recebido";
import type {
  PedidoPdv,
  StatusPedido,
  StatusEventoPedido,
} from "../pedido-types";

type Pedido = Prisma.PdvPedidoGetPayload<{
  include: { recebido: true; eventos: true };
}>;
export function serializarPedidoExterno(
  p: Pedido,
  ctx: ContextoSessao,
): PedidoPdv {
  if (!p.recebido || p.vendaId) throw new Error("Pedido externo indisponível.");
  const d = esquemaPedidoRecebido.parse(p.recebido.conteudo);
  return {
    id: p.id,
    vendaId: null,
    numero: p.numero,
    versao: p.versao,
    status: p.status as StatusPedido,
    criadoEm: d.criadoEm,
    atualizadoEm: p.atualizadoEm.toISOString(),
    prontoEm: p.prontoEm?.toISOString() ?? null,
    saiuEntregaEm: p.saiuEntregaEm?.toISOString() ?? null,
    entregueEm: p.entregueEm?.toISOString() ?? null,
    canceladoEm: p.canceladoEm?.toISOString() ?? null,
    agendadoPara: p.agendadoPara?.toISOString() ?? null,
    iniciarPreparoEm: p.iniciarPreparoEm?.toISOString() ?? null,
    preparoIniciadoEm: p.preparoIniciadoEm?.toISOString() ?? null,
    temEnderecoEntrega: !!d.entrega,
    origem: {
      codigo: p.recebido.origem,
      nome: nomeOrigemPedido(p.recebido.origem),
      numero: d.numeroOrigem,
      situacao: d.situacaoNome,
      canal: d.canal,
      atualizadoEm: d.atualizadoEm,
      pagamentos: d.pagamentos,
      entrega: pode(ctx, "pdv.entrega") ? d.entrega : null,
    },
    venda: {
      id: p.id,
      criadaEm: d.criadoEm,
      cliente: pode(ctx, "crm.ver") ? d.cliente : null,
      modalidade: d.modalidade,
      status: "EXTERNA",
      totalCentavos: d.totalCentavos,
      subtotalCentavos: d.totalCentavos,
      descontoCentavos: 0,
      taxaCentavos: 0,
      freteCentavos: d.freteCentavos,
      trocoCentavos: 0,
      observacao: d.observacao,
      operador: nomeOrigemPedido(p.recebido.origem),
      itens: d.itens.map((i) => ({ ...i, opcoes: [] })),
      pagamentos: [],
      motivoCancelamento: null,
    },
    historico: p.eventos.map((e) => ({
      id: e.id,
      de: e.de as StatusEventoPedido | null,
      para: e.para as StatusEventoPedido,
      versao: e.versao,
      operador: e.operador,
      observacao: e.observacao,
      criadoEm: e.criadoEm.toISOString(),
    })),
  };
}
