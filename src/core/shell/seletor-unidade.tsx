"use client";

import { useTransition } from "react";

import { Icone } from "@/design-system/icones";

import { trocarUnidade } from "./acoes";

/**
 * O SELETOR DE UNIDADE.
 *
 * Fica no alto da barra lateral, logo abaixo da marca: saber "de qual loja é
 * este número" nunca pode exigir um clique. "Rede Completa" só aparece para
 * quem tem acesso de rede — e mesmo assim o servidor confere de novo, porque o
 * que chega do navegador não vale como permissão.
 *
 * É um `<select>` de verdade. No celular ele abre a roda nativa do sistema,
 * que é maior, mais rápida e mais familiar do que qualquer lista que
 * possamos desenhar aqui.
 */
export function SeletorUnidade({
  unidades,
  valorAtual,
  podeVerRede,
}: {
  unidades: { id: string; nome: string }[];
  valorAtual: string;
  podeVerRede: boolean;
}) {
  const [trocando, iniciarTroca] = useTransition();

  return (
    <div>
      <label className="block">
        <span className="sr-only">Unidade em que você está trabalhando</span>

        <span className="relative block">
          <span
            aria-hidden="true"
            className="text-ink-3 pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
          >
            <Icone nome="casa" tamanho={15} />
          </span>

          <select
            value={valorAtual}
            disabled={trocando}
            aria-busy={trocando || undefined}
            onChange={(e) => {
              const valor = e.target.value;
              iniciarTroca(() => {
                void trocarUnidade(valor);
              });
            }}
            className="border-line-2 bg-surface text-ink hover:bg-surface-2 focus-visible:outline-accent desk:h-9 h-11 w-full cursor-pointer appearance-none rounded-md border pr-8 pl-8 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 disabled:cursor-wait disabled:opacity-60"
          >
            {/* Com uma loja só, "Rede Completa" seleciona exatamente o mesmo
                dado e ainda desliga as telas que exigem unidade. Um controle
                que só pode piorar a tela não deveria estar nela. Ele volta
                sozinho quando a segunda unidade for cadastrada. */}
            {podeVerRede && unidades.length > 1 && (
              <option value="rede">Rede Completa</option>
            )}
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>

          <span
            aria-hidden="true"
            className="text-ink-3 pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2"
          >
            <Icone nome="seta-baixo" tamanho={14} />
          </span>
        </span>
      </label>
    </div>
  );
}
