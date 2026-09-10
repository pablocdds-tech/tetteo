import type { ReactNode } from "react";

/**
 * O CARTÃO.
 *
 * Uma superfície com borda fina e canto de 14px. Só isso.
 *
 * Duas regras que valem mais que o componente:
 *
 *   1. CARTÃO NÃO ENTRA DENTRO DE CARTÃO. Se pareceu necessário, o de fora
 *      não era um cartão — era uma seção, e seção se separa com espaço e
 *      título, não com mais uma borda. Borda dentro de borda faz a tela
 *      parecer um formulário de papel carbono.
 *
 *   2. SOMBRA É ALTURA, NÃO ENFEITE. O cartão fica no plano da página e não
 *      tem sombra. Quem tem sombra é o que FLUTUA por cima: menu, gaveta,
 *      painel. Se tudo tem sombra, nada está por cima de nada.
 */
export function Cartao({
  children,
  className = "",
  como: Como = "div",
}: {
  children: ReactNode;
  className?: string;
  como?: "div" | "section" | "article";
}) {
  return (
    <Como className={`bg-surface border-line rounded-lg border ${className}`}>
      {children}
    </Como>
  );
}

/**
 * O cabeçalho de uma seção dentro do painel.
 *
 * O título é `h2` por padrão porque a tela já tem um `h1`. Um documento com
 * dois `h1` não tem hierarquia — tem duas aberturas, e quem navega por
 * cabeçalho no leitor de tela perde a noção de onde está.
 */
export function TituloDeSecao({
  children,
  acao,
  apoio,
  nivel: Nivel = "h2",
  id,
}: {
  children: ReactNode;
  /** Um botão ou link à direita. Um só — dois viram uma barra de ferramentas. */
  acao?: ReactNode;
  apoio?: ReactNode;
  nivel?: "h2" | "h3";
  id?: string;
}) {
  return (
    <div className="border-line flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
      <div className="min-w-0">
        <Nivel id={id} className="text-[15px] leading-6 font-semibold">
          {children}
        </Nivel>
        {apoio && (
          <p className="text-ink-3 mt-0.5 text-xs leading-[18px]">{apoio}</p>
        )}
      </div>
      {acao && <div className="flex flex-none items-center gap-2">{acao}</div>}
    </div>
  );
}
