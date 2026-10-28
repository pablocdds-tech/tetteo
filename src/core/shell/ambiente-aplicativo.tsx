"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icone } from "@/design-system/icones";
import { PainelLateral } from "@/design-system/painel-lateral";
import { destinoAtual, type AppNaBarra } from "./apps";
import { AvisoDeConexao } from "./aviso-de-conexao";
import { ProvedorDeAmbientes } from "./link-integrado";

export function AmbienteAplicativo({
  app,
  principal,
  organizacao,
  seletorDeUnidade,
  conta,
  children,
  className,
}: {
  app: AppNaBarra;
  principal: string;
  organizacao: string;
  seletorDeUnidade: ReactNode;
  conta: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const caminho = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);
  const atual = destinoAtual(app, caminho);
  const navegacao = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-5 pb-4">
        <Link
          href={app.rota}
          className="focus-visible:outline-accent flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-3"
        >
          <span
            className="bg-accent text-accent-ink grid size-10 shrink-0 place-items-center rounded-xl"
            aria-hidden="true"
          >
            <Icone nome={app.icone} tamanho={22} />
          </span>
          <span>
            <span className="block text-xl font-bold tracking-tight">
              {app.nome}
            </span>
            <span className="text-ink-3 block text-xs">{organizacao}</span>
          </span>
        </Link>
        <div className="mt-5">{seletorDeUnidade}</div>
      </div>
      <nav
        aria-label={`Seções do ${app.nome}`}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
      >
        <ul className="flex flex-col gap-1">
          {app.navegacao.map((destino) => (
            <li key={destino.rota}>
              <Link
                href={destino.rota}
                onClick={() => setMenuAberto(false)}
                aria-current={atual?.rota === destino.rota ? "page" : undefined}
                className={`focus-visible:outline-accent flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 lg:min-h-10 ${atual?.rota === destino.rota ? "bg-accent-sub text-accent font-semibold" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
              >
                {destino.icone && <Icone nome={destino.icone} tamanho={18} />}
                {destino.nome}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-line border-t p-4">
        <a
          href={principal}
          className="text-ink-2 hover:text-accent focus-visible:outline-accent mb-4 flex min-h-11 items-center gap-2 rounded-md text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Icone nome="grade" tamanho={17} />
          Abrir Tetteo
          <Icone nome="seta-direita" tamanho={15} />
        </a>
        {conta}
      </div>
    </div>
  );
  return (
    <ProvedorDeAmbientes principal={principal} rotaAplicativo={app.rota}>
      <div
        className={`bg-paper flex min-h-dvh min-w-0 flex-1 ${className ?? ""}`}
      >
        <aside
          aria-label={`Menu do ${app.nome}`}
          className="border-line bg-surface sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r lg:flex"
        >
          {navegacao}
        </aside>
        <PainelLateral
          aberto={menuAberto}
          aoFechar={() => setMenuAberto(false)}
          titulo={`Menu do ${app.nome}`}
        >
          {menuAberto ? navegacao : null}
        </PainelLateral>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-line bg-surface sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b px-4 lg:px-6">
            <button
              type="button"
              onClick={() => setMenuAberto(true)}
              aria-label={`Abrir menu do ${app.nome}`}
              aria-expanded={menuAberto}
              className="hover:bg-surface-2 focus-visible:outline-accent grid size-11 shrink-0 place-items-center rounded-md focus-visible:outline-2 lg:hidden"
            >
              <Icone nome="menu" tamanho={21} />
            </button>
            <span className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
              {atual?.nome ?? app.nome}
            </span>
            <span className="text-ink-3 hidden text-xs sm:block">
              Integrado ao Tetteo
            </span>
          </header>
          <AvisoDeConexao />
          <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </ProvedorDeAmbientes>
  );
}
