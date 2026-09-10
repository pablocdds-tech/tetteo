import type { Unidade } from "@/lib/unidades";

import {
  dividirArredondando,
  embalagensNecessarias,
  precoPorUnidade,
  quantidadeDeEmbalagens,
  totalFracionado,
  totalPorEmbalagens,
  type Centavos,
  type DezMilesimos,
  type Micros,
  type Milesimos,
} from "./aritmetica";

/**
 * AS LINHAS DO PEDIDO — puras.
 *
 * O pedido é o snapshot do que foi aprovado. As contas saem daqui, uma vez,
 * no servidor, e o total é CONFERIDO contra as linhas antes de gravar: se a
 * soma das linhas mais o frete não der o total ao centavo, é erro — não um
 * "ajuste de arredondamento" silencioso.
 *
 * Regra (desenho §5): embalagem inteira é exata (n × preço da embalagem);
 * a granel, o total da linha é arredondado UMA vez, meio para cima.
 */

export const REGRA_DE_ARREDONDAMENTO = "linha-meio-para-cima-v1";

export type EntradaDaLinha = {
  insumoId: string;
  nome: string;
  unidade: Unidade;
  necessario: Milesimos;
  nomeEmbalagem: string | null;
  pecas: number;
  conteudo: DezMilesimos | null;
  unidadeConteudo: Unidade | null;
  fracionavel: boolean;
  fator: DezMilesimos;
  precoEmbalagem: Centavos;
  origemPreco: string;
  itemDePropostaId: string | null;
  itemDeRequisicaoId: string | null;
};

export type LinhaDoPedido = EntradaDaLinha & {
  /** Em milésimos de EMBALAGEM: 2 caixas = 2000n; a granel pode ser fração. */
  embalagensMil: Milesimos;
  comprado: Milesimos;
  adicional: Milesimos;
  precoPorUnidade: Micros;
  total: Centavos;
};

export function montarLinha(e: EntradaDaLinha): LinhaDoPedido {
  if (e.necessario <= 0n) throw new Error(`${e.nome}: quantidade precisa ser maior que zero.`);
  if (e.fator <= 0n) throw new Error(`${e.nome}: fator da embalagem inválido.`);

  if (e.fracionavel) {
    return {
      ...e,
      embalagensMil: dividirArredondando(e.necessario * 10_000n, e.fator),
      comprado: e.necessario,
      adicional: 0n,
      precoPorUnidade: precoPorUnidade(e.precoEmbalagem, e.fator),
      total: totalFracionado(e.necessario, e.precoEmbalagem, e.fator),
    };
  }

  const n = embalagensNecessarias(e.necessario, e.fator);
  const comprado = quantidadeDeEmbalagens(n, e.fator);
  return {
    ...e,
    embalagensMil: n * 1000n,
    comprado,
    adicional: comprado - e.necessario,
    precoPorUnidade: precoPorUnidade(e.precoEmbalagem, e.fator),
    total: totalPorEmbalagens(n, e.precoEmbalagem),
  };
}

export function montarPedido(entradas: EntradaDaLinha[], frete: Centavos) {
  if (entradas.length === 0) throw new Error("Pedido sem itens.");
  const linhas = entradas.map(montarLinha);
  const subtotal = linhas.reduce((s, l) => s + l.total, 0n);
  return { linhas, subtotal, frete, total: subtotal + frete };
}

/** A soma das linhas arredondadas mais o frete dá o total, ao centavo? */
export function conferirTotal(
  linhas: { total: Centavos }[],
  frete: Centavos,
  total: Centavos,
): boolean {
  return linhas.reduce((s, l) => s + l.total, 0n) + frete === total;
}
