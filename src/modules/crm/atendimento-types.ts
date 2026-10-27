export type UfEndereco =
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
export type EnderecoAtendimento = {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: UfEndereco;
  cep: string;
  referencia: string;
};
export type ClienteAtendimento = {
  id: string;
  nome: string;
  telefone: string | null;
};
export type EnderecoClienteAtendimento = {
  id: string;
  rotulo: string;
  principal: boolean;
  ativo: boolean;
  versao: number;
  endereco: EnderecoAtendimento;
};
export type ListaClientesAtendimento = {
  clientes: ClienteAtendimento[];
  total: number;
  pagina: number;
  totalPaginas: number;
};
export type DetalheClienteAtendimento = {
  cliente: ClienteAtendimento;
  enderecos: EnderecoClienteAtendimento[];
};
