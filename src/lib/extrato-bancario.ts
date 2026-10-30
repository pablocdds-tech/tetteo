/** Contrato interno: o conector traduz o banco, o Financeiro decide a baixa. */
export type TransacaoBancaria = {
  id: string;
  data: string;
  direcao: "PAGAR" | "RECEBER";
  valor: string;
  tipo: string;
  titulo: string;
  descricao: string;
  documento: string | null;
  nome: string | null;
};
