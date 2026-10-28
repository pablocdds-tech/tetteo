export type RegistroDesempenho = {
  criadoEm: string;
  totalCentavos: number;
  cancelado: boolean;
  pendente: boolean;
  modalidade: string;
  origem: string;
  itens: { nome: string; quantidade: number }[];
};
export type IndicadoresPdv = {
  pedidos: number;
  valorCentavos: number;
  ticketCentavos: number | null;
  cancelados: number;
  valorCanceladoCentavos: number;
  pendentes: number;
  valorPendenteCentavos: number;
};
export type DesempenhoPdv = {
  de: string;
  ate: string;
  anteriorDe: string;
  anteriorAte: string;
  atual: IndicadoresPdv;
  anterior: IndicadoresPdv;
  dias: { dia: string; pedidos: number; valorCentavos: number }[];
  modalidades: { nome: string; pedidos: number; valorCentavos: number }[];
  origens: { nome: string; pedidos: number; valorCentavos: number }[];
  produtos: { nome: string; quantidade: number }[];
};
