"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * O RASCUNHO DA LISTA DE COMPRAS.
 *
 * A lista mora no `sessionStorage`, e não no estado do React. Isso não é
 * detalhe de implementação: é o que faz o rascunho sobreviver a trocar de
 * filtro, abrir um detalhe, voltar, e até recarregar a página. Ele morre
 * quando a aba fecha — de propósito. Um rascunho de compra da semana passada
 * reaparecendo sozinho é pior do que rascunho nenhum.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `useSyncExternalStore` E NÃO UM `useEffect`.
 *
 * A tentação é guardar num `useState` e restaurar dentro de um efeito. Isso
 * tem dois defeitos, e os dois aparecem para quem usa:
 *
 *   1. O efeito roda DEPOIS da primeira pintura. A lista aparece vazia por um
 *      quadro e então pula com os itens dentro.
 *   2. `setState` dentro de efeito dispara uma segunda renderização em
 *      cascata — o `npm run lint` recusa isso, e recusa com razão.
 *
 * `useSyncExternalStore` foi feito exatamente para ler de um sistema de fora.
 * O terceiro argumento é o que o SERVIDOR enxerga: uma lista vazia, porque no
 * servidor não existe `sessionStorage`. O React usa ele também na primeira
 * renderização do navegador, durante a hidratação, e só depois troca pelo
 * valor real. É isso que evita o HTML do servidor discordar do HTML do
 * navegador sem precisar de nenhum efeito.
 * ---------------------------------------------------------------------------
 */

export type EscolhaDeCompra = {
  insumoId: string;
  nome: string;
  /** A unidade de CONTAGEM. O número só significa algo ao lado dela. */
  unidade: string;
  /** O texto do campo, como a pessoa digitou. Vazio é um estado válido. */
  quantidade: string;
  /** De onde veio o número que apareceu sozinho. `null` = a pessoa escreveu. */
  origem: string | null;
};

/**
 * A MESMA referência sempre.
 *
 * `getSnapshot` que devolve um array novo a cada chamada põe o React num laço
 * infinito de renderização — ele compara por identidade, não por conteúdo.
 */
const VAZIO: readonly EscolhaDeCompra[] = Object.freeze([]);

const cache = new Map<string, readonly EscolhaDeCompra[]>();
const ouvintes = new Map<string, Set<() => void>>();

function lerDoArmazenamento(chave: string): readonly EscolhaDeCompra[] {
  try {
    const salvo = sessionStorage.getItem(chave);
    if (!salvo) return VAZIO;

    const dados: unknown = JSON.parse(salvo);
    if (!Array.isArray(dados) || dados.length === 0) return VAZIO;
    return dados as EscolhaDeCompra[];
  } catch {
    // Aba anônima, armazenamento bloqueado, JSON estragado. A tela funciona
    // sem o rascunho; o que ela não pode é deixar de abrir por causa dele.
    return VAZIO;
  }
}

function snapshot(chave: string): readonly EscolhaDeCompra[] {
  const guardado = cache.get(chave);
  if (guardado) return guardado;

  const lido = lerDoArmazenamento(chave);
  cache.set(chave, lido);
  return lido;
}

/** O que o servidor enxerga: nada. Ele não tem a aba de ninguém. */
function snapshotDoServidor(): readonly EscolhaDeCompra[] {
  return VAZIO;
}

function gravar(chave: string, lista: readonly EscolhaDeCompra[]) {
  cache.set(chave, lista);

  try {
    if (lista.length === 0) sessionStorage.removeItem(chave);
    else sessionStorage.setItem(chave, JSON.stringify(lista));
  } catch {
    // Ver acima: não conseguir guardar não derruba a tela. O rascunho segue
    // valendo na memória desta página.
  }

  ouvintes.get(chave)?.forEach((avisar) => avisar());
}

/**
 * @param chave uma por unidade: trocar de loja não herda a lista da outra.
 */
export function useRascunhoDeCompras(chave: string) {
  const escolhas = useSyncExternalStore(
    useCallback(
      (avisar: () => void) => {
        const conjunto = ouvintes.get(chave) ?? new Set<() => void>();
        ouvintes.set(chave, conjunto);
        conjunto.add(avisar);
        return () => {
          conjunto.delete(avisar);
        };
      },
      [chave],
    ),
    useCallback(() => snapshot(chave), [chave]),
    snapshotDoServidor,
  );

  const acoes = useMemo(
    () => ({
      /** Já na lista não entra de novo — o banco recusaria o item duplicado. */
      adicionar(escolha: EscolhaDeCompra) {
        const atual = snapshot(chave);
        if (atual.some((e) => e.insumoId === escolha.insumoId)) return;
        gravar(chave, [...atual, escolha]);
      },

      remover(insumoId: string) {
        gravar(
          chave,
          snapshot(chave).filter((e) => e.insumoId !== insumoId),
        );
      },

      /**
       * Mexeu no número: a origem some.
       *
       * A partir daqui a quantidade é decisão da pessoa, e continuar
       * escrevendo "sugerido pelo sistema" embaixo dela seria mentira.
       */
      mudarQuantidade(insumoId: string, quantidade: string) {
        gravar(
          chave,
          snapshot(chave).map((e) =>
            e.insumoId === insumoId ? { ...e, quantidade, origem: null } : e,
          ),
        );
      },

      limpar() {
        gravar(chave, VAZIO);
      },
    }),
    [chave],
  );

  return [escolhas, acoes] as const;
}
