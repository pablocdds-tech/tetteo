import Link from "next/link";

/**
 * O FILTRO QUE MORA NO ENDEREÇO.
 *
 * Mesmo desenho do controle segmentado, mas cada opção é um LINK: o filtro
 * muda o conjunto de dados que o servidor busca, então ele vai para a URL.
 * Voltar funciona, e o link colado no grupo abre a mesma tela filtrada.
 * Navega é `<a>` — ver DESIGN.md §4.
 */
export type OpcaoDeFiltro = {
  valor: string;
  rotulo: string;
  href: string;
  contagem?: number;
};

export function FiltroPorLink({
  nome,
  opcoes,
  selecionado,
}: {
  nome: string;
  opcoes: OpcaoDeFiltro[];
  selecionado: string;
}) {
  return (
    <nav
      aria-label={nome}
      className="bg-surface-2 border-line inline-flex max-w-full overflow-x-auto rounded-md border p-0.5"
    >
      {opcoes.map((opcao) => {
        const ativo = opcao.valor === selecionado;
        return (
          <Link
            key={opcao.valor}
            href={opcao.href}
            scroll={false}
            aria-current={ativo ? "page" : undefined}
            className={[
              "inline-flex h-10 items-center justify-center gap-1.5 rounded-sm px-3.5",
              "text-base whitespace-nowrap transition-[background-color,color] duration-150 md:h-8",
              "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
              ativo
                ? "bg-surface text-ink font-semibold shadow-[var(--shadow-card)]"
                : "text-ink-2 hover:text-ink font-medium",
            ].join(" ")}
          >
            {opcao.rotulo}
            {opcao.contagem !== undefined && (
              <span className="text-xs tabular-nums opacity-70">
                {opcao.contagem}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
