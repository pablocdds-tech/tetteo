import type { VendaPdv } from "./types";
import type { EntregaSnapshot } from "./entrega-types";

export type StatusPedido =
  "COZINHA" | "AGUARDANDO_COLETA" | "SAIU_ENTREGA" | "ENTREGUE" | "CANCELADO";
export type DestinoPedido = Exclude<StatusPedido, "COZINHA" | "CANCELADO">;
export type StatusEventoPedido = StatusPedido | "AGENDADO";
export type EventoPedido = {
  id: string;
  de: StatusEventoPedido | null;
  para: StatusEventoPedido;
  versao: number;
  operador: string;
  observacao: string;
  criadoEm: string;
};
export type PedidoPdv = {
  agendadoPara?: string | null;
  iniciarPreparoEm?: string | null;
  preparoIniciadoEm?: string | null;
  id: string;
  vendaId: string;
  numero: number;
  versao: number;
  status: StatusPedido;
  criadoEm: string;
  atualizadoEm: string;
  prontoEm: string | null;
  saiuEntregaEm: string | null;
  entregueEm: string | null;
  canceladoEm: string | null;
  entrega?: EntregaSnapshot | null;
  temEnderecoEntrega?: boolean;
  entregadorId?: string | null;
  entregadorNome?: string | null;
  venda: VendaPdv;
  historico: EventoPedido[];
};
export type QuadroPedidos = {
  dia: string;
  pedidos: PedidoPdv[];
  totais: Record<StatusPedido, number>;
  ativosTotal: number;
  finalizadosTotal: number;
  ativosExibidos: number;
  finalizadosExibidos: number;
  limiteAtivos: number;
  limiteFinalizados: number;
  truncado: boolean;
};
export type ResultadoPedido = {
  ok?: string;
  erro?: string;
  pedido?: PedidoPdv;
  quadro?: QuadroPedidos;
};
