import type { VendaPdv } from "./types";
import type { EntregaSnapshot } from "./entrega-types";
import type { PedidoRecebido } from "@/lib/pedido-recebido";

export type ResumoVendaPedido = Omit<VendaPdv, "status"> & {
  status: VendaPdv["status"] | "EXTERNA";
};
export type OrigemPedido = {
  codigo: string;
  nome: string;
  numero: string;
  situacao: string;
  canal: string;
  atualizadoEm: string;
  pagamentos: PedidoRecebido["pagamentos"];
  entrega: PedidoRecebido["entrega"];
};

export type StatusPedido =
  | "AGENDADO"
  | "COZINHA"
  | "AGUARDANDO_COLETA"
  | "SAIU_ENTREGA"
  | "ENTREGUE"
  | "CANCELADO";
export type DestinoPedido = Exclude<
  StatusPedido,
  "AGENDADO" | "COZINHA" | "CANCELADO"
>;
export type VisaoPedidos =
  "TODOS" | "EM_ANDAMENTO" | "AGENDADOS" | "RETIRADA" | "ENTREGA" | "BALCAO";
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
  vendaId: string | null;
  origem?: OrigemPedido;
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
  venda: ResumoVendaPedido;
  historico: EventoPedido[];
};
export type QuadroPedidos = {
  dia: string;
  visao: VisaoPedidos;
  totaisVisao: Record<VisaoPedidos, number>;
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
