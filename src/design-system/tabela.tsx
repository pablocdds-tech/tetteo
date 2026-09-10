import type { ReactNode } from "react";

import { Icone } from "./icones";

/**
 * A TABELA DE DADOS.
 *
 * Duas formas do MESMO dado, decididas pela largura:
 *
 *   ≥768px  tabela de verdade — `<table>`, `<th scope="col">`, uma linha por
 *           registro. Densidade é a razão de existir uma tabela.
 *   <768px  cartões com o RÓTULO DO CAMPO ao lado de cada valor.
 *
 * Por que não simplesmente rolar a tabela de lado no celular: porque ler uma
 * linha rolando para a direita e para a esquerda a cada campo é pior do que
 * não ter tabela. A rolagem horizontal continua existindo — numa região com
 * foco de teclado próprio — mas para o caso em que a tabela quase cabe, não
 * como plano para o celular.
 *
 * ABRIR UMA LINHA É UM BOTÃO, não um clique na `<tr>`. `<tr onClick>` não
 * recebe foco, não responde a Enter e não é anunciado — quem usa teclado
 * simplesmente não consegue abrir o registro. O botão fica na coluna que
 * identifica a linha, que é onde a pessoa já ia clicar.
 */

export type Coluna<T> = {
  chave: string;
  titulo: string;
  /** Alinha à direita e usa algarismos tabulares. Dinheiro, quantidade, data. */
  numerica?: boolean;
  /** A coluna que identifica o registro. Vem primeiro e vira o botão de abrir. */
  principal?: boolean;
  celula: (linha: T) => ReactNode;
  /** Fora do cartão do celular — para o que lá já está dito de outro jeito. */
  ocultarNoCartao?: boolean;
  larguraMin?: string;
};

export function Tabela<T>({
  legenda,
  colunas,
  linhas,
  chaveDaLinha,
  aoAbrir,
  rotuloAbrir,
  linhaAtiva,
  vazio,
}: {
  /** Descreve a tabela para quem não a enxerga. Vira o `<caption>`. */
  legenda: string;
  colunas: Coluna<T>[];
  linhas: T[];
  chaveDaLinha: (linha: T) => string;
  /** Só a partir de um componente cliente. Sem ela a tabela é só leitura. */
  aoAbrir?: (linha: T) => void;
  /** O nome acessível do botão: "Ver conta de luz". Nunca só "Ver". */
  rotuloAbrir?: (linha: T) => string;
  linhaAtiva?: string | null;
  vazio: ReactNode;
}) {
  if (linhas.length === 0) return <>{vazio}</>;

  const principal = colunas.find((c) => c.principal) ?? colunas[0];

  const conteudoPrincipal = (linha: T) => {
    const dentro = principal.celula(linha);
    if (!aoAbrir) return dentro;

    return (
      <button
        type="button"
        onClick={() => aoAbrir(linha)}
        aria-label={rotuloAbrir?.(linha)}
        className="hover:text-accent focus-visible:outline-accent -m-1 flex items-center gap-1.5 rounded-sm p-1 text-left font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
      >
        <span className="min-w-0">{dentro}</span>
        <Icone
          nome="seta-direita"
          tamanho={14}
          // No celular não existe hover: a seta fica visível o tempo todo.
          // Escondê-la lá deixaria o cartão sem nenhuma pista de que abre.
          className="text-ink-3 mt-px transition-opacity duration-150 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        />
      </button>
    );
  };

  return (
    <>
      {/* ---- Tabela: do tablet para cima ---- */}
      <div
        role="region"
        aria-label={`${legenda}. Role para o lado para ver todas as colunas.`}
        tabIndex={0}
        className="focus-visible:outline-accent hidden overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 md:block"
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{legenda}</caption>
          <thead>
            <tr className="border-line border-b">
              {colunas.map((c) => (
                <th
                  key={c.chave}
                  scope="col"
                  style={c.larguraMin ? { minWidth: c.larguraMin } : undefined}
                  className={`text-ink-3 px-4 py-2.5 text-[12px] leading-[18px] font-medium whitespace-nowrap ${
                    c.numerica ? "text-right" : "text-left"
                  }`}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-line divide-y">
            {linhas.map((linha) => {
              const id = chaveDaLinha(linha);
              const ativa = linhaAtiva === id;

              return (
                <tr
                  key={id}
                  aria-current={ativa ? "true" : undefined}
                  className={`group transition-colors duration-150 ${
                    ativa ? "bg-accent-sub" : "hover:bg-surface-2"
                  }`}
                >
                  {colunas.map((c) =>
                    c.chave === principal.chave ? (
                      <th
                        key={c.chave}
                        scope="row"
                        className="text-ink px-4 py-3 text-left align-top font-medium"
                      >
                        {conteudoPrincipal(linha)}
                      </th>
                    ) : (
                      <td
                        key={c.chave}
                        className={`text-ink-2 px-4 py-3 align-top ${
                          c.numerica
                            ? "text-right whitespace-nowrap tabular-nums"
                            : "text-left"
                        }`}
                      >
                        {c.celula(linha)}
                      </td>
                    ),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- Cartões: celular ---- */}
      <ul className="divide-line divide-y md:hidden">
        {linhas.map((linha) => {
          const id = chaveDaLinha(linha);
          const ativa = linhaAtiva === id;

          return (
            <li
              key={id}
              className={`group px-4 py-3 ${ativa ? "bg-accent-sub" : ""}`}
            >
              <div className="text-ink text-[15px] leading-6 font-medium">
                {conteudoPrincipal(linha)}
              </div>

              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {colunas
                  .filter(
                    (c) => c.chave !== principal.chave && !c.ocultarNoCartao,
                  )
                  .map((c) => (
                    <div key={c.chave} className="contents">
                      <dt className="text-ink-3 text-xs leading-5">
                        {c.titulo}
                      </dt>
                      <dd
                        className={`text-ink-2 text-sm leading-5 ${
                          c.numerica ? "text-right tabular-nums" : ""
                        }`}
                      >
                        {c.celula(linha)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
