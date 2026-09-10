import type { ReactNode } from "react";

/**
 * O CABEÇALHO DA TELA.
 *
 * Um `h1` por tela, sempre — é o que um leitor de tela usa para responder
 * "onde eu estou?". Título, uma linha de contexto, e na MESMA linha os
 * controles: filtro de período à esquerda das ações, ação principal por
 * último.
 *
 * Estar na mesma linha não é economia de pixel: é o que faz caber, em 1440×900
 * e sem rolar, o título, os filtros, os indicadores e as primeiras linhas de
 * trabalho. Um cabeçalho que ocupa um terço da tela empurra o trabalho para
 * baixo da dobra, e aí o painel deixa de ser painel.
 */
export function CabecalhoDePagina({
  titulo,
  contexto,
  controles,
  acao,
}: {
  titulo: string;
  /** Unidade, período, origem — a linha que situa o título. */
  contexto?: ReactNode;
  /** Filtros que valem para a tela inteira. */
  controles?: ReactNode;
  /** UMA ação principal. Duas competindo significam que a tela não decidiu. */
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[24px] leading-[30px] font-semibold tracking-tight md:text-[28px] md:leading-[34px]">
          {titulo}
        </h1>
        {contexto && (
          <p className="text-ink-3 mt-1 text-sm leading-5">{contexto}</p>
        )}
      </div>

      {(controles || acao) && (
        <div className="flex flex-wrap items-center gap-2">
          {controles}
          {acao}
        </div>
      )}
    </div>
  );
}
