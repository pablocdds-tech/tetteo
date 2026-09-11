import { Esqueleto } from "@/design-system/esqueleto";

/**
 * O CARREGAMENTO DA TELA DO DIA.
 *
 * O esqueleto tem as MEDIDAS do que vem: a coluna de 310px, o cabeçalho da
 * atividade, a folha. É por isso que ele existe — não para entreter, mas para
 * a página não PULAR quando o dado chega. Um giro no meio da tela some e
 * empurra tudo; um esqueleto do tamanho certo é substituído no lugar, e o
 * olho já está onde precisa estar.
 *
 * A casca (barra lateral e topo) não pisca: ela está fora deste arquivo, e é
 * exatamente essa diferença que faz uma navegação parecer troca de tela e não
 * recarregamento de página.
 *
 * Quem usa leitor de tela ouve "Carregando as rotinas" uma vez, e não trinta
 * retângulos. A animação morre sozinha em `prefers-reduced-motion`, pela regra
 * global do globals.css.
 */
export default function CarregandoChecklists() {
  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <span className="sr-only" role="status">
        Carregando as rotinas de checklist.
      </span>

      <div aria-hidden="true" className="flex flex-col gap-4">
        {/* Cabeçalho da tela */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Esqueleto className="h-[34px] w-52" arredondado="md" />
            <Esqueleto className="h-[21px] w-72" />
          </div>
          <Esqueleto className="h-10 w-40" arredondado="md" />
        </div>

        {/* Barra de ferramentas */}
        <div className="flex min-h-14 items-center gap-4">
          <Esqueleto className="h-[42px] flex-1" arredondado="md" />
          <Esqueleto className="h-8 w-40" arredondado="md" />
        </div>

        {/* Lista e detalhe */}
        <div className="desk:grid-cols-[var(--shell-lista)_minmax(0,1fr)] grid items-start gap-4">
          <div className="border-line bg-surface flex flex-col gap-1.5 rounded-lg border p-1.5">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5 px-3 py-2.5">
                <Esqueleto className="h-[21px] w-3/4" />
                <Esqueleto className="h-[18px] w-full" />
                <Esqueleto className="h-[18px] w-2/5" />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            <div className="border-line bg-surface flex flex-col gap-2 rounded-lg border p-4">
              <Esqueleto className="h-7 w-1/2" arredondado="md" />
              <Esqueleto className="h-[21px] w-3/4" />
              <Esqueleto className="mt-2 h-9 w-64" arredondado="md" />
            </div>

            <div className="border-line bg-surface divide-line flex flex-col divide-y rounded-lg border">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2.5 p-4">
                  <Esqueleto className="h-[21px] w-2/3" />
                  <Esqueleto className="h-11 w-full" arredondado="md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
