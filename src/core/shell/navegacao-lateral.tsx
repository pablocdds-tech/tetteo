"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type AppNaBarra = {
  chave: string;
  nome: string;
  subtitulo: string;
  icone: string;
  cor: { fundo: string; frente: string };
  rota: string;
  navegacao: { rota: string; nome: string }[];
  emConstrucao?: boolean;
};

/**
 * A NAVEGAÇÃO LATERAL.
 *
 * Duas camadas, e a separação entre elas é o que faz muitos módulos caberem sem
 * virar uma lista impossível de ler:
 *
 *   1. TROCAR DE MÓDULO — um gesto próprio. O módulo atual fica no topo; ao
 *      clicar, abre um painel flutuante com todos, em grade.
 *   2. NAVEGAR DENTRO DO MÓDULO — a barra mostra só as opções do módulo
 *      aberto. Nunca os dos outros.
 *
 * Sem essa separação, o menu cresce junto com o sistema até ninguém achar
 * nada. Com ela, a barra tem sempre três ou quatro itens, não importa quantos
 * módulos existam.
 */
export function NavegacaoLateral({ apps }: { apps: AppNaBarra[] }) {
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  const painel = useRef<HTMLDivElement>(null);

  // O módulo mais específico que casa com o endereço atual.
  const atual = apps
    .filter((a) => caminho === a.rota || caminho.startsWith(`${a.rota}/`))
    .sort((a, b) => b.rota.length - a.rota.length)[0];

  // Fecha ao clicar fora ou apertar Esc — o esperado de qualquer painel.
  // (Ao escolher um módulo, quem fecha é o próprio clique no item, mais
  // abaixo: reagir à troca de rota por efeito colateral é mais frágil.)
  useEffect(() => {
    if (!aberto) return;
    const clique = (e: MouseEvent) => {
      if (!painel.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", clique);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", clique);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  return (
    <div ref={painel} className="relative flex flex-col gap-1">
      <Link
        href="/"
        className="mb-1 flex items-center gap-2.5 rounded-md px-2 py-1"
      >
        <span className="bg-accent text-accent-ink grid size-7 place-items-center rounded-lg text-sm font-bold">
          T
        </span>
        <span className="text-[15px] font-bold tracking-tight">Tetteo</span>
      </Link>

      {/* ---- O módulo atual, que abre o painel ---- */}
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        className="hover:bg-surface-3 focus-visible:outline-accent flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {atual ? (
          <>
            <span
              aria-hidden
              className="grid size-9 flex-none place-items-center rounded-xl text-base"
              style={{ background: atual.cor.fundo, color: atual.cor.frente }}
            >
              {atual.icone}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {atual.nome}
              </span>
              <span className="text-ink-3 block truncate text-xs">
                {atual.subtitulo}
              </span>
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className="bg-surface-3 text-ink-2 grid size-9 flex-none place-items-center rounded-xl text-base"
            >
              ⌂
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Início</span>
              <span className="text-ink-3 block text-xs">
                Escolha um módulo
              </span>
            </span>
          </>
        )}
        <span
          aria-hidden
          className={`text-ink-3 flex-none text-xs transition-transform duration-150 ${aberto ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {/* ---- O painel flutuante com todos os módulos ---- */}
      {aberto && (
        <div
          role="menu"
          className="border-line bg-surface absolute top-[86px] left-0 z-50 w-[330px] rounded-xl border p-3 shadow-[0_12px_32px_rgb(0_0_0/12%)]"
        >
          <p className="text-ink-3 px-1 pb-2 font-mono text-[10px] tracking-[0.14em] uppercase">
            Módulos da rede
          </p>

          <div className="grid grid-cols-3 gap-1">
            {apps.map((app) => {
              const ativo = atual?.chave === app.chave;
              return (
                <Link
                  key={app.chave}
                  href={app.rota}
                  role="menuitem"
                  onClick={() => setAberto(false)}
                  className={[
                    "flex flex-col items-center gap-1.5 rounded-lg p-2 text-center",
                    "transition-colors duration-150",
                    ativo ? "bg-surface-3" : "hover:bg-surface-2",
                  ].join(" ")}
                >
                  <span
                    aria-hidden
                    className={`grid size-10 place-items-center rounded-xl text-lg ${app.emConstrucao ? "opacity-55" : ""}`}
                    style={{ background: app.cor.fundo, color: app.cor.frente }}
                  >
                    {app.icone}
                  </span>
                  <span className="text-ink w-full truncate text-[11px] leading-tight font-semibold">
                    {app.nome}
                  </span>
                  <span className="text-ink-3 line-clamp-2 text-[10px] leading-tight">
                    {app.subtitulo}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- As opções DENTRO do módulo aberto ---- */}
      {atual && (
        <nav className="mt-2 flex flex-col gap-0.5">
          {atual.navegacao.map((item) => {
            const ativo =
              caminho === item.rota ||
              (item.rota !== atual.rota && caminho.startsWith(`${item.rota}/`));
            return (
              <Link
                key={item.rota}
                href={item.rota}
                aria-current={ativo ? "page" : undefined}
                className={[
                  "rounded-md px-3 py-1.5 text-sm transition-colors duration-150",
                  ativo
                    ? "bg-accent-sub text-accent font-semibold"
                    : "text-ink-2 hover:bg-surface-3 hover:text-ink",
                ].join(" ")}
              >
                {item.nome}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
