"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Um App na barra lateral.
 *
 * O ponto colorido repete a cor do ícone da tela inicial: as pessoas
 * encontram por cor antes de ler o nome.
 */
export function ItemNav({
  rota,
  nome,
  cor,
  emConstrucao,
}: {
  rota: string;
  nome: string;
  cor: string;
  emConstrucao?: boolean;
}) {
  const caminho = usePathname();
  const ativo = caminho === rota || caminho.startsWith(`${rota}/`);

  return (
    <Link
      href={rota}
      aria-current={ativo ? "page" : undefined}
      className={[
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
        "transition-colors duration-150",
        ativo
          ? "bg-accent-sub text-accent font-semibold"
          : "text-ink-2 hover:bg-surface-3 hover:text-ink",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="size-2 flex-none rounded-sm"
        style={{ background: cor }}
      />
      <span className="truncate">{nome}</span>
      {emConstrucao && (
        <span className="text-ink-3 ml-auto text-xs font-normal">em breve</span>
      )}
    </Link>
  );
}
