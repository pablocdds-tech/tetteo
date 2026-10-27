import type { PagamentoPdv, VendaPdv } from "./types";

export type ReceberEntrada = {
  vendaId: string;
  versaoFinanceira: number;
  chave: string;
  caixaId: string;
  pagamentos: PagamentoPdv[];
};
export type DadosRecebimento = {
  venda: VendaPdv;
  pedidoNumero: number | null;
  caixa: { id: string; operador: string } | null;
};
export type ResultadoRecebimento = {
  erro?: string;
  ok?: string;
  dados?: DadosRecebimento;
  vendaId?: string;
};
