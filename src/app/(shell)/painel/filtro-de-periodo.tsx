import Link from "next/link";

/**
 * O FILTRO DE PERÍODO.
 *
 * Links, não botões — e a diferença importa. O período vive no ENDEREÇO, então
 * ele pode ser copiado, colado, aberto em outra aba e desfeito com o botão
 * Voltar do navegador. Um `<button>` com estado só na memória perde as quatro
 * coisas, e a última é a que mais dói: trocar o período por engano e não ter
 * como voltar.
 *
 * Mudando o endereço, o servidor refaz a busca — e os indicadores, o gráfico e
 * a tabela mudam JUNTOS, porque os três saem da mesma consulta. Não existe
 * estado intermediário em que o número de cima já mudou e a lista de baixo
 * ainda não.
 */

export const PERIODOS = [7, 30, 90] as const;

export type Periodo = (typeof PERIODOS)[number];

export const PERIODO_PADRAO: Periodo = 30;

/** O que chega da URL é texto de estranho: qualquer coisa fora da lista vira o padrão. */
export function lerPeriodo(bruto: string | string[] | undefined): Periodo {
  const texto = Array.isArray(bruto) ? bruto[0] : bruto;
  const numero = Number(texto);
  return (PERIODOS as readonly number[]).includes(numero)
    ? (numero as Periodo)
    : PERIODO_PADRAO;
}

export function FiltroDePeriodo({ atual }: { atual: Periodo }) {
  return (
    <div
      role="group"
      aria-label="Período do painel"
      className="border-line-2 flex items-center gap-0.5 rounded-md border p-0.5"
    >
      {PERIODOS.map((dias) => {
        const ativo = dias === atual;
        return (
          <Link
            key={dias}
            href={dias === PERIODO_PADRAO ? "/" : `/?periodo=${dias}`}
            aria-current={ativo ? "true" : undefined}
            className={`focus-visible:outline-accent inline-flex h-9 items-center rounded-[5px] px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 ${
              ativo
                ? "bg-accent text-accent-ink"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {dias} dias
            <span className="sr-only">
              {ativo ? " (período selecionado)" : ""}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
