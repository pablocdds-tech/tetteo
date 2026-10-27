import type { VendaPdv } from "./types";

export type HistoricoFiltros = {
  de: string;
  ate: string;
  status: "TODAS" | "CONCLUIDA" | "CANCELADA";
  modalidade: "TODAS" | "BALCAO" | "RETIRADA" | "ENTREGA";
  pagamento: "TODOS" | "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO";
  operadorId: string;
  busca: string;
  pagina: number;
};
export type VendaHistorico = VendaPdv & { numeroPedido: number | null };
export type PaginaHistorico = {
  filtros: HistoricoFiltros;
  vendas: VendaHistorico[];
  totalRegistros: number;
  totalPaginas: number;
  tamanhoPagina: number;
  resumo: {
    concluidas: number;
    canceladas: number;
    totalConcluidoCentavos: number;
    totalCanceladoCentavos: number;
  };
  operadores: { id: string; nome: string }[];
  podeVerClientes: boolean;
};
export type ExportacaoHistorico = {
  csv: string;
  nomeArquivo: string;
  quantidade: number;
};
export type ResultadoHistorico = {
  erro?: string;
  pagina?: PaginaHistorico;
  exportacao?: ExportacaoHistorico;
};
