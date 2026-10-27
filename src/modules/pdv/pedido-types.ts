import type { VendaPdv } from "./types";

export type StatusPedido =
  "COZINHA" | "AGUARDANDO_COLETA" | "SAIU_ENTREGA" | "ENTREGUE" | "CANCELADO";
export type DestinoPedido = Exclude<StatusPedido, "COZINHA" | "CANCELADO">;
export type EventoPedido = {
  id: string;
  de: StatusPedido | null;
  para: StatusPedido;
  versao: number;
  operador: string;
  observacao: string;
  criadoEm: string;
};
export type PedidoPdv = {
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
