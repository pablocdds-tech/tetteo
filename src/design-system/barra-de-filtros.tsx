import { useId } from "react";

import { Icone } from "./icones";

/**
 * A BARRA DE FILTROS.
 *
 * A busca filtra o que JÁ ESTÁ NA TELA. Não há requisição por tecla digitada,
 * e não há "debounce" para disfarçar uma: os registros do período já vieram do
 * servidor, e filtrar mil linhas em memória é instantâneo. Rede só entra em
 * cena quando o PERÍODO muda — porque aí o conjunto de dados é outro de
 * verdade.
 *
 * Os estados são `<input type="radio">` de verdade, escondidos por baixo do
 * visual de pastilha. Ganhamos, sem escrever nada: seta do teclado navegando
 * entre as opções, o grupo anunciado como grupo, e o rótulo lido junto. A
 * versão com `<button aria-pressed>` parece igual na tela e é pior em tudo que
 * não se vê.
 *
 * "Limpar filtros" só aparece quando há filtro. Um botão que não faz nada
 * ensina a ignorar os botões.
 */

export type OpcaoDeFiltro = {
  valor: string;
  rotulo: string;
  /** Quantos registros caem nesta opção. Some quando não há como saber. */
  contagem?: number;
};

export function BarraDeFiltros({
  busca,
  aoBuscar,
  rotuloBusca,
  nomeDoGrupo,
  opcoes,
  selecionado,
  aoSelecionar,
  aoLimpar,
  resumo,
  acoes,
}: {
  busca: string;
  aoBuscar: (valor: string) => void;
  /** "Buscar por descrição ou fornecedor" — diz o que a busca alcança. */
  rotuloBusca: string;
  /** O nome do conjunto de estados: "Situação da conta". */
  nomeDoGrupo: string;
  opcoes: OpcaoDeFiltro[];
  selecionado: string;
  aoSelecionar: (valor: string) => void;
  /** Ausente quando não há nada para limpar. */
  aoLimpar?: () => void;
  /** "12 de 40 contas" — o que a combinação de filtros deixou passar. */
  resumo?: string;
  acoes?: React.ReactNode;
}) {
  const idBusca = useId();
  const idGrupo = useId();

  return (
    <div className="border-line flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-4 py-3">
      {/* ---- Busca ---- */}
      <div className="min-w-[min(100%,15rem)] flex-1">
        <label htmlFor={idBusca} className="sr-only">
          {rotuloBusca}
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="text-ink-3 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          >
            <Icone nome="lupa" tamanho={16} />
          </span>
          <input
            id={idBusca}
            type="search"
            value={busca}
            onChange={(e) => aoBuscar(e.target.value)}
            placeholder={rotuloBusca}
            className="bg-surface border-line-2 text-ink placeholder:text-ink-3 hover:border-ink-3 focus:border-accent h-11 w-full rounded-md border pr-3 pl-9 text-base transition-[border-color,box-shadow] duration-150 focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:h-[42px] md:text-sm"
          />
        </div>
      </div>

      {/* ---- Estados ---- */}
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend id={idGrupo} className="sr-only">
          {nomeDoGrupo}
        </legend>

        {opcoes.map((opcao) => (
          <label
            key={opcao.valor}
            className="focus-within:outline-accent group inline-flex cursor-pointer items-center gap-1.5 rounded-full focus-within:outline-2 focus-within:outline-offset-3"
          >
            <input
              type="radio"
              name={idGrupo}
              value={opcao.valor}
              checked={selecionado === opcao.valor}
              onChange={() => aoSelecionar(opcao.valor)}
              className="sr-only"
            />
            <span
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-150 ${
                selecionado === opcao.valor
                  ? "bg-accent-sub border-accent/30 text-accent"
                  : "border-line-2 text-ink-2 hover:bg-surface-2 hover:text-ink bg-transparent"
              }`}
            >
              {opcao.rotulo}
              {opcao.contagem !== undefined && (
                <span className="text-xs tabular-nums opacity-70">
                  {opcao.contagem}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {aoLimpar && (
        <button
          type="button"
          onClick={aoLimpar}
          className="text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-accent inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
        >
          <Icone nome="fechar" tamanho={14} />
          Limpar filtros
        </button>
      )}

      {acoes && <div className="flex items-center gap-2">{acoes}</div>}

      {resumo && (
        <p
          aria-live="polite"
          className="text-ink-3 basis-full text-xs leading-[18px] tabular-nums"
        >
          {resumo}
        </p>
      )}
    </div>
  );
}
