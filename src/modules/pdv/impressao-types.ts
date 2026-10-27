export type TipoImpressaoPdv = "COMPROVANTE" | "COZINHA";

export type ItemImpressaoPdv = {
  nome: string;
  quantidade: number;
  observacao: string;
  complementos: { grupo: string; nome: string }[];
};

type DocumentoBase = {
  vendaId: string;
  unidade: string;
  pedido: { id: string; numero: number; status: string } | null;
  criadaEm: string;
  geradoEm: string;
  operador: string;
  cliente?: string;
  modalidade: string;
  observacao: string;
  statusVenda: "CONCLUIDA" | "CANCELADA";
  motivoCancelamento: string | null;
};

export type DocumentoImpressaoPdv =
  | (DocumentoBase & { tipo: "COZINHA"; itens: ItemImpressaoPdv[] })
  | (DocumentoBase & {
      tipo: "COMPROVANTE";
      itens: (ItemImpressaoPdv & {
        precoUnitarioCentavos: number;
        totalCentavos: number;
      })[];
      subtotalCentavos: number;
      descontoCentavos: number;
      taxaCentavos: number;
      totalCentavos: number;
      trocoCentavos: number;
      pagamentos: {
        forma: "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO";
        valorCentavos: number;
      }[];
    });

export type SolicitacaoImpressaoPdv = {
  documento: DocumentoImpressaoPdv;
  solicitacao: { chave: string; quando: string; reimpressao: boolean };
};

export type ResultadoImpressaoPdv = {
  erro?: string;
  resultado?: SolicitacaoImpressaoPdv;
};
