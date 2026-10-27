import type { ItemCarrinho, ProdutoPdv } from "./types";
import type { EntregaEntrada } from "./entrega-types";

export type EntregaCarrinho = Pick<
  EntregaEntrada,
  "destinatario" | "telefone" | "endereco" | "areaId"
>;

export type ConteudoCarrinho = {
  clienteId?: string;
  modalidade: "RETIRADA" | "BALCAO" | "ENTREGA";
  entrega?: EntregaCarrinho;
  observacao: string;
  itens: ItemCarrinho[];
};
export type CarrinhoSalvo = {
  id: string;
  versao: number;
  nome: string;
  atualizadoEm: string;
  conteudo: ConteudoCarrinho;
};
export type ResumoCarrinho = {
  id: string;
  versao: number;
  nome: string;
  atualizadoEm: string;
  quantidadeItens: number;
};
export type RetomadaCarrinho = {
  carrinho: CarrinhoSalvo;
  produtos: ProdutoPdv[];
  avisos: string[];
};
export type ResultadoCarrinho = {
  ok?: string;
  erro?: string;
  carrinho?: CarrinhoSalvo;
  carrinhos?: ResumoCarrinho[];
  retomada?: RetomadaCarrinho;
};
