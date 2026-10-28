export type PedidoCozinha = {
  id: string;
  numero: string;
  versao: number;
  modalidade: string;
  status: "COZINHA" | "AGUARDANDO_COLETA";
  iniciadoEm: string;
  prontoEm: string | null;
  agendadoPara: string | null;
  observacao: string;
  itens: {
    nome: string;
    quantidade: number;
    observacao: string;
    complementos: string[];
  }[];
};
export type QuadroCozinha = {
  pedidos: PedidoCozinha[];
  emPreparo: number;
  prontos: number;
  truncado: boolean;
  atualizadoEm: string;
};
