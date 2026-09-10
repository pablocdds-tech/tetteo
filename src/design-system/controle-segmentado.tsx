"use client";

import { useId } from "react";

/**
 * O CONTROLE SEGMENTADO.
 *
 * Duas ou três opções que se excluem, lado a lado, com a escolhida em relevo.
 * É o controle da barra de ferramentas — "Hoje / Semana" — e não um filtro
 * qualquer: ele troca o CONJUNTO de dados da tela, não esconde parte do que
 * já está nela.
 *
 * POR QUE SÃO `<input type="radio">` E NÃO BOTÕES.
 *
 * A versão com `<button aria-pressed>` fica idêntica na tela e é pior em tudo
 * que não se vê. Com radios de verdade, o navegador entrega de graça:
 *
 *   • as SETAS do teclado andam entre as opções — e andar já escolhe, que é
 *     exatamente como um controle segmentado se comporta no sistema da Apple;
 *   • o grupo é anunciado como grupo, com o nome dele junto;
 *   • Tab entra e sai do grupo inteiro, não de opção em opção.
 *
 * O SELECIONADO NÃO É SÓ COR. Ele ganha uma superfície própria com sombra
 * (o "relevo") e o peso do texto sobe. Quem não distingue as duas cores
 * continua vendo qual está escolhida — e num controle de duas opções, essa é
 * a única informação que ele carrega.
 */

export type Segmento<T extends string> = {
  valor: T;
  rotulo: string;
  /** "12 rotinas" — o que muda ao escolher. Some quando não há como saber. */
  contagem?: number;
};

export function ControleSegmentado<T extends string>({
  nome,
  segmentos,
  selecionado,
  aoSelecionar,
  ocupado = false,
}: {
  /** O nome do conjunto, lido pelo leitor de tela: "Período da lista". */
  nome: string;
  segmentos: Segmento<T>[];
  selecionado: T;
  aoSelecionar: (valor: T) => void;
  /**
   * A troca pedida ainda está a caminho do servidor.
   *
   * NÃO desabilita o grupo — e isso já foi um defeito. Um `disabled` durante
   * a troca tirava o foco do rádio no meio da navegação por teclado: a
   * primeira seta funcionava, a segunda caía no vazio. Como o pedido mais
   * recente sempre vence o anterior, apertar de novo é seguro; basta avisar
   * que há algo a caminho.
   */
  ocupado?: boolean;
}) {
  const grupo = useId();

  return (
    <fieldset
      aria-busy={ocupado || undefined}
      className={`bg-surface-2 border-line inline-flex rounded-md border p-0.5 transition-opacity duration-150 ${
        ocupado ? "opacity-70" : ""
      }`}
    >
      <legend className="sr-only">{nome}</legend>

      {segmentos.map((segmento) => {
        const ativo = selecionado === segmento.valor;

        return (
          <label
            key={segmento.valor}
            className="focus-within:outline-accent relative cursor-pointer rounded-sm focus-within:outline-2 focus-within:outline-offset-2"
          >
            <input
              type="radio"
              name={grupo}
              value={segmento.valor}
              checked={ativo}
              onChange={() => aoSelecionar(segmento.valor)}
              className="sr-only"
            />
            <span
              className={[
                "inline-flex h-10 items-center justify-center gap-1.5 rounded-sm px-3.5",
                "text-base whitespace-nowrap transition-[background-color,color] duration-150",
                "md:h-8",
                ativo
                  ? "bg-surface text-ink font-semibold shadow-[var(--shadow-card)]"
                  : "text-ink-2 hover:text-ink font-medium",
              ].join(" ")}
            >
              {segmento.rotulo}
              {segmento.contagem !== undefined && (
                <span className="text-xs tabular-nums opacity-70">
                  {segmento.contagem}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
