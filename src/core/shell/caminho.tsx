"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icone } from "@/design-system/icones";

import { appAtual, destinoAtual, type AppNaBarra } from "./apps";

/**
 * O CAMINHO, no topo.
 *
 * Responde "onde eu estou e como volto". Ele acompanha a barra lateral em vez
 * de repeti-la: a barra diz o que EXISTE, o caminho diz onde você ENTROU — e é
 * ele que ainda faz sentido quando a tela é um detalhe três níveis abaixo.
 *
 * `<nav>` com nome e `<ol>` de verdade: a ordem dos degraus é conteúdo, não
 * arranjo visual. Uma fila de `<span>` separados por barra vira, no leitor de
 * tela, uma linha de palavras soltas.
 */
export function Caminho({ apps }: { apps: AppNaBarra[] }) {
  const caminho = usePathname();
  const app = appAtual(apps, caminho);
  const destino = app ? destinoAtual(app, caminho) : null;

  // Na raiz o caminho tem um degrau só, e ele é a própria tela.
  const naHome = caminho === "/";

  return (
    <nav aria-label="Caminho" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        <li className="flex min-w-0 items-center gap-1.5">
          {naHome ? (
            <span
              aria-current="page"
              className="text-ink truncate font-semibold"
            >
              Painel da operação
            </span>
          ) : (
            <Link
              href="/"
              className="text-ink-3 hover:text-ink focus-visible:outline-accent flex-none rounded-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
            >
              <Icone nome="casa" tamanho={15} />
              <span className="sr-only">Painel da operação</span>
            </Link>
          )}
        </li>

        {app && (
          <li className="flex min-w-0 items-center gap-1.5">
            <Icone
              nome="seta-direita"
              tamanho={13}
              className="text-ink-3 flex-none"
            />
            {destino ? (
              <Link
                href={app.rota}
                className="text-ink-3 hover:text-ink focus-visible:outline-accent truncate rounded-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
              >
                {app.nome}
              </Link>
            ) : (
              <span
                aria-current="page"
                className="text-ink truncate font-semibold"
              >
                {app.nome}
              </span>
            )}
          </li>
        )}

        {app && destino && (
          <li className="flex min-w-0 items-center gap-1.5">
            <Icone
              nome="seta-direita"
              tamanho={13}
              className="text-ink-3 flex-none"
            />
            <span
              aria-current="page"
              className="text-ink truncate font-semibold"
            >
              {destino.nome}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
