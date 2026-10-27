export type UfEntrega =
  | "AC"
  | "AL"
  | "AP"
  | "AM"
  | "BA"
  | "CE"
  | "DF"
  | "ES"
  | "GO"
  | "MA"
  | "MT"
  | "MS"
  | "MG"
  | "PA"
  | "PB"
  | "PR"
  | "PE"
  | "PI"
  | "RJ"
  | "RN"
  | "RS"
  | "RO"
  | "RR"
  | "SC"
  | "SP"
  | "SE"
  | "TO";
export type EnderecoEntrega = {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: UfEntrega;
  cep: string;
  referencia: string;
};
export type EntregaEntrada = {
  destinatario: string;
  telefone: string;
  endereco: EnderecoEntrega;
  areaId?: string;
  versaoArea?: number;
  freteCentavos: number;
  prazoMinutos: number;
  motivoFreteManual: string;
};
export type EntregaSnapshot = EntregaEntrada & {
  areaNome: string | null;
  previstoEm: string;
};
export type AreaEntrega = {
  id: string;
  versao: number;
  nome: string;
  cidade: string;
  uf: UfEntrega;
  bairros: string[];
  freteCentavos: number;
  prazoMinutos: number;
  ativa: boolean;
  atualizadoEm: string;
};
export type Entregador = {
  id: string;
  versao: number;
  nome: string;
  telefone: string;
  ativo: boolean;
  atualizadoEm: string;
};
export type EntregadorPdv = Entregador;
export type ResultadoEntrega = {
  ok?: string;
  erro?: string;
  area?: AreaEntrega;
  entregador?: Entregador;
};
