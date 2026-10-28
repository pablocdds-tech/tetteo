import type { EventoPedido, StatusPedido } from "./pedido-types";
import type { VendaPdv } from "./types";

/** Data civil informada e exibida no fuso America/Sao_Paulo. */
export type AgendamentoEntrada = {
  paraLocal: string;
  antecedenciaMinutos: number;
};
export type AgendamentoPdv = {
  pedidoId: string;
  numero: number;
  versao: number;
  status: "AGENDADO" | StatusPedido;
  agendadoPara: string;
  iniciarPreparoEm: string;
  preparoIniciadoEm: string | null;
  antecedenciaMinutos: number;
  venda: VendaPdv;
  historico: EventoPedido[];
};
export type EstadoFiltroAgendamento =
  "EM_ABERTO" | "AGUARDANDO" | "INICIADOS" | "FINALIZADOS" | "TODOS";
export type FiltrosAgendamento = {
  de: string;
  ate: string;
  estado: EstadoFiltroAgendamento;
  pagina: number;
};
export type PaginaAgendamentos = {
  pedidos: AgendamentoPdv[];
  filtros: FiltrosAgendamento;
  totalRegistros: number;
  totalPaginas: number;
  tamanhoPagina: number;
  resumo: { aguardando: number; proximos: number; atrasados: number };
  agora: string;
};
export type ResultadoAgendamento = {
  erro?: string;
  ok?: string;
  pagina?: PaginaAgendamentos;
  pedido?: AgendamentoPdv;
};
