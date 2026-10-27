import type { EntregaEntrada } from "./entrega-types";

export type ClienteAtendimentoPdv = {
  id: string;
  nome: string;
  telefone: string | null;
};
export type EnderecoClientePdv = {
  id: string;
  rotulo: string;
  principal: boolean;
  versao: number;
  endereco: EntregaEntrada["endereco"];
};
export type SeedEntregaCliente = Pick<
  EntregaEntrada,
  "destinatario" | "telefone"
> & { endereco?: EntregaEntrada["endereco"] };
export type ConsultaClienteAtendimento = {
  cliente: ClienteAtendimentoPdv;
  enderecos: EnderecoClientePdv[];
};
export type ListaClientesAtendimento = {
  clientes: ClienteAtendimentoPdv[];
  total: number;
  pagina: number;
  totalPaginas: number;
};
