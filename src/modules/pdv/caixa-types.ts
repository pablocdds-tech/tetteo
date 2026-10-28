import type { CaixaPdv, PagamentoPdv } from "./types";

export type FormaCaixa = PagamentoPdv["forma"];
export type TipoLancamento =
  "ABERTURA" | "VENDA" | "SANGRIA" | "SUPRIMENTO" | "ESTORNO";
export type LancamentoCaixa = {
  id: string;
  data: string;
  descricao: string;
  valorCentavos: number;
  forma: FormaCaixa;
  tipo: TipoLancamento;
  usuario: string;
};
export type TotaisCaixa = {
  pagamentos: Record<FormaCaixa, number>;
  subtotalCentavos: number;
  descontoCentavos: number;
  taxaCentavos: number;
  freteCentavos: number;
  totalCentavos: number;
};
export type DetalheCaixa = CaixaPdv & {
  observacao: string;
  lancamentos: LancamentoCaixa[];
  resumo: TotaisCaixa;
  modalidades: { modalidade: string; totais: TotaisCaixa }[];
  suprimentosCentavos: number;
  sangriasCentavos: number;
};
export type SessaoCaixa = Pick<
  CaixaPdv,
  | "id"
  | "abertoEm"
  | "fechadoEm"
  | "operador"
  | "saldoInicialCentavos"
  | "valorContadoCentavos"
>;
export type HistoricoCaixas = {
  itens: SessaoCaixa[];
  total: number;
  pagina: number;
  porPagina: number;
};

export const formasCaixa: Record<FormaCaixa, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CREDITO: "Cartão de crédito",
  DEBITO: "Cartão de débito",
};
export const tiposLancamento: Record<TipoLancamento, string> = {
  ABERTURA: "Abertura",
  VENDA: "Venda",
  SANGRIA: "Sangria",
  SUPRIMENTO: "Suprimento",
  ESTORNO: "Estorno",
};
export const modalidadesCaixa: Record<string, string> = {
  ENTREGA: "Delivery",
  RETIRADA: "Retirada",
  BALCAO: "Balcão",
};
export const moedaCaixa = (valor: number) =>
  ((valor || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
export const dataCaixa = (valor: string) =>
  new Date(valor).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
export const codigoCaixa = (id: string) => id.slice(0, 8).toUpperCase();
