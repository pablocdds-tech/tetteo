export type OpcaoComplemento = {
  id: string;
  nome: string;
  precoCentavos: number;
  fichaId?: string;
};
export type GrupoComplemento = {
  id: string;
  nome: string;
  minimo: number;
  maximo: number;
  calculo: "SOMA" | "MEDIA";
  opcoes: OpcaoComplemento[];
};
export type ProdutoPdv = {
  id: string;
  nome: string;
  categoria: string;
  precoCentavos: number;
  codigo: string;
  grupos: GrupoComplemento[];
};
export type ItemCarrinho = {
  produtoId: string;
  quantidade: number;
  opcoes: string[];
  observacao: string;
};
export type PagamentoPdv = {
  forma: "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO";
  valorCentavos: number;
};
export type FinalizarEntrada = {
  chave: string;
  caixaId: string;
  clienteId?: string;
  modalidade: "RETIRADA" | "BALCAO" | "ENTREGA";
  observacao: string;
  itens: ItemCarrinho[];
  descontoCentavos: number;
  taxaCentavos: number;
  pagamentos: PagamentoPdv[];
};
export type ItemVendaPdv = ItemCarrinho & {
  nome: string;
  precoUnitarioCentavos: number;
  totalCentavos: number;
  complementos: { grupo: string; nome: string; precoCentavos: number }[];
};
export type CaixaPdv = {
  id: string;
  abertoEm: string;
  fechadoEm: string | null;
  operador: string;
  localEstoqueId: string;
  saldoInicialCentavos: number;
  saldoEsperadoCentavos: number;
  valorContadoCentavos: number | null;
  diferencaCentavos: number | null;
  movimentos: {
    id: string;
    tipo: string;
    valorCentavos: number;
    motivo: string;
    criadoEm: string;
  }[];
};
export type VendaPdv = {
  id: string;
  criadaEm: string;
  cliente: string | null;
  modalidade: string;
  status: "CONCLUIDA" | "CANCELADA";
  totalCentavos: number;
  subtotalCentavos: number;
  descontoCentavos: number;
  taxaCentavos: number;
  trocoCentavos: number;
  observacao: string;
  operador: string;
  itens: ItemVendaPdv[];
  pagamentos: PagamentoPdv[];
  motivoCancelamento: string | null;
};
export type DadosPdv = {
  produtos: ProdutoPdv[];
  caixa: CaixaPdv | null;
  caixasAnteriores: CaixaPdv[];
  vendas: VendaPdv[];
  clientes: { id: string; nome: string }[];
  locais: { id: string; nome: string }[];
};
export type ResultadoPdv = { ok?: string; erro?: string; vendaId?: string };
