import { sigla, type Unidade } from "@/lib/unidades";

import {
  CASAS,
  centavosDoBanco,
  doBanco,
  fatorDoBanco,
  milesimosDoBanco,
  numeroBrDe,
  quantidadeBr,
  reais,
  reaisPorUnidade,
} from "../schemas/aritmetica";
import { descreverEmbalagem } from "../schemas/embalagem";

/**
 * Uma linha do pedido em palavras — do mesmo jeito na aprovação, no detalhe
 * e na conferência: "2 × caixa", "Caixa: 12 × 900 g", "10,8 kg a granel".
 * As contas são as do servidor (inteiros na escala), nunca `Number`.
 */

type Decimalish = { toString(): string };

export type ItemDoPedidoNoBanco = {
  unidadeEstoque: string;
  nomeEmbalagem: string | null;
  pecas: number;
  conteudo: Decimalish | null;
  unidadeConteudo: string | null;
  fracionavel: boolean;
  embalagens: Decimalish;
  quantidade: Decimalish;
  quantidadeNecessaria: Decimalish;
  adicional: Decimalish;
  quantidadeCancelada: Decimalish;
  precoEmbalagem: Decimalish;
  precoUnitario: Decimalish;
  total: Decimalish;
};

export function descreverLinha(i: ItemDoPedidoNoBanco) {
  const u = i.unidadeEstoque as Unidade;
  const nome = i.nomeEmbalagem ?? "Embalagem";
  const embalagem = descreverEmbalagem(
    {
      pecas: i.pecas,
      conteudo: i.conteudo === null ? null : fatorDoBanco(i.conteudo),
      unidadeConteudo: i.unidadeConteudo as Unidade | null,
      fracionavel: i.fracionavel,
    },
    u,
  );
  const comprado = milesimosDoBanco(i.quantidade);
  const adicional = milesimosDoBanco(i.adicional);
  const cancelado = milesimosDoBanco(i.quantidadeCancelada);
  const preco = reais(centavosDoBanco(i.precoEmbalagem));

  return {
    quanto: i.fracionavel
      ? `${quantidadeBr(comprado, u)} a granel`
      : `${numeroBrDe(milesimosDoBanco(i.embalagens), CASAS.milesimos)} × ${nome.toLowerCase()}`,
    embalagem: i.fracionavel ? embalagem : `${nome}: ${embalagem}`,
    embalagensNoCampo: numeroBrDe(
      milesimosDoBanco(i.embalagens),
      CASAS.milesimos,
    ),
    comprado: quantidadeBr(comprado, u),
    necessario: quantidadeBr(milesimosDoBanco(i.quantidadeNecessaria), u),
    adicional: adicional > 0n ? quantidadeBr(adicional, u) : null,
    cancelado: cancelado > 0n ? quantidadeBr(cancelado, u) : null,
    preco: i.fracionavel
      ? `${preco}/${sigla(u)}`
      : `${preco} por ${nome.toLowerCase()}`,
    porUnidade: reaisPorUnidade(doBanco(i.precoUnitario, CASAS.micros), u),
    total: reais(centavosDoBanco(i.total)),
  };
}

/** Decimal do banco → "R$ 1.234,56". */
export const emReais = (v: Decimalish) => reais(centavosDoBanco(v));
