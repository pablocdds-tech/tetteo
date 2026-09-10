"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState, type ReactNode } from "react";

import { Icone } from "@/design-system/icones";

import { appAtual, destinoEstaAtivo, type AppNaBarra } from "./apps";

export type { AppNaBarra };

/**
 * O CONTEÚDO DA NAVEGAÇÃO.
 *
 * O MESMO componente serve a barra fixa do computador e a gaveta do celular.
 * Duas cópias divergiriam na primeira semana — e o jeito de descobrir seria um
 * destino que existe no computador e não no telefone.
 *
 * Duas camadas, e a separação entre elas é o que faz muitos módulos caberem
 * sem virar uma lista impossível de ler:
 *
 *   1. TROCAR DE MÓDULO — um gesto próprio, atrás de "Trocar de módulo".
 *   2. NAVEGAR DENTRO DO MÓDULO — a barra mostra só as opções do módulo
 *      aberto. Nunca os dos outros.
 *
 * Sem essa separação, o menu cresce junto com o sistema até ninguém achar
 * nada. Com ela, a barra tem sempre três ou quatro itens, não importa quantos
 * módulos existam.
 *
 * A lista de módulos abre PARA BAIXO, empurrando o resto, em vez de flutuar
 * por cima. Um painel flutuante de 330px cabia na barra do computador e seria
 * cortado dentro da gaveta de 280px — e um menu cortado pela metade é a pior
 * forma de descobrir que a tela mudou de tamanho.
 */
export function ConteudoDaNavegacao({
  apps,
  seletorDeUnidade,
  conta,
}: {
  apps: AppNaBarra[];
  seletorDeUnidade: ReactNode;
  conta: ReactNode;
}) {
  const caminho = usePathname();
  const atual = appAtual(apps, caminho);
  const [trocando, setTrocando] = useState(false);
  const idLista = useId();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ---- Marca e unidade ---- */}
      <div className="flex flex-none flex-col gap-3 px-3 pt-3 pb-2">
        <Link
          href="/"
          className="focus-visible:outline-accent flex items-center gap-2.5 rounded-md px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-3"
        >
          <span
            aria-hidden="true"
            className="bg-accent text-accent-ink grid size-7 flex-none place-items-center rounded-lg text-sm font-bold"
          >
            T
          </span>
          <span className="text-[15px] font-bold tracking-tight">Tetteo</span>
        </Link>

        {seletorDeUnidade}
      </div>

      {/* ---- Destinos ---- */}
      <nav
        aria-label="Seções do Tetteo"
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        <ItemDeDestino
          href="/"
          ativo={caminho === "/"}
          icone="casa"
          nome="Painel da operação"
        />

        <div className="bg-line my-2 h-px" aria-hidden="true" />

        {/* O módulo aberto, e a porta para trocar de módulo. */}
        <button
          type="button"
          onClick={() => setTrocando((v) => !v)}
          aria-expanded={trocando}
          aria-controls={idLista}
          className="hover:bg-surface-2 focus-visible:outline-accent flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
        >
          <span
            aria-hidden="true"
            className={`grid size-8 flex-none place-items-center rounded-xl ${
              atual ? "" : "bg-surface-3 text-ink-2"
            }`}
            style={
              atual
                ? { background: atual.cor.fundo, color: atual.cor.frente }
                : undefined
            }
          >
            <Icone nome={atual ? atual.icone : "grade"} tamanho={17} />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm leading-5 font-semibold">
              {atual ? atual.nome : "Escolher módulo"}
            </span>
            <span className="text-ink-3 block truncate text-xs leading-4">
              {atual ? atual.subtitulo : "Todos os módulos da rede"}
            </span>
          </span>

          <Icone
            nome="seta-baixo"
            tamanho={14}
            className={`text-ink-3 transition-transform duration-150 ${
              trocando ? "rotate-180" : ""
            }`}
          />
          <span className="sr-only">
            {trocando ? "Fechar a lista de módulos" : "Trocar de módulo"}
          </span>
        </button>

        {/* A lista de módulos. Só existe no DOM quando aberta — um menu
            fechado que continua alcançável pelo Tab é uma armadilha. */}
        {trocando && (
          <ul id={idLista} className="mt-1 flex flex-col gap-0.5">
            {apps.map((app) => (
              <li key={app.chave}>
                <Link
                  href={app.rota}
                  aria-current={atual?.chave === app.chave ? "true" : undefined}
                  onClick={() => setTrocando(false)}
                  className={`focus-visible:outline-accent flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 ${
                    atual?.chave === app.chave
                      ? "bg-surface-3"
                      : "hover:bg-surface-2"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-6 flex-none place-items-center rounded-md ${
                      app.emConstrucao ? "opacity-50" : ""
                    }`}
                    style={{ background: app.cor.fundo, color: app.cor.frente }}
                  >
                    <Icone nome={app.icone} tamanho={13} />
                  </span>
                  <span className="text-ink min-w-0 flex-1 truncate text-sm leading-5">
                    {app.nome}
                  </span>
                  {app.emConstrucao && (
                    <span className="bg-surface-3 text-ink-2 flex-none rounded-full px-1.5 py-0.5 text-[10px] leading-4 font-semibold">
                      em breve
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* ---- As opções DENTRO do módulo aberto ---- */}
        {atual && !trocando && (
          <ul className="mt-1 flex flex-col gap-0.5">
            {atual.navegacao.map((destino) => {
              const ativo = destinoEstaAtivo(destino, atual.rota, caminho);
              return (
                <li key={destino.rota}>
                  <Link
                    href={destino.rota}
                    aria-current={ativo ? "page" : undefined}
                    className={`focus-visible:outline-accent block rounded-md px-3 py-1.5 text-sm leading-5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 ${
                      ativo
                        ? "bg-accent-sub text-accent font-semibold"
                        : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {destino.nome}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* ---- A conta, no rodapé ----
          `flex-none` de propósito: quando a barra precisa rolar, quem rola é a
          lista de destinos. A conta e o botão de sair ficam onde estão. */}
      <div className="border-line flex-none border-t p-3">{conta}</div>
    </div>
  );
}

function ItemDeDestino({
  href,
  ativo,
  icone,
  nome,
}: {
  href: string;
  ativo: boolean;
  icone: "casa";
  nome: string;
}) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={`focus-visible:outline-accent flex items-center gap-2.5 rounded-md px-2 py-2 text-sm leading-5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 ${
        ativo
          ? "bg-accent-sub text-accent font-semibold"
          : "text-ink-2 hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <Icone nome={icone} tamanho={18} />
      {nome}
    </Link>
  );
}
