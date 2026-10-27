import type { ItemCarrinho, ProdutoPdv } from "./types";

export type ConteudoCarrinho = {
  clienteId?: string;
  modalidade: "RETIRADA" | "BALCAO" | "ENTREGA";
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
