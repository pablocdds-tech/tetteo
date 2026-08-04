"use client";

import { useTransition } from "react";

import { trocarUnidade } from "./acoes";

/**
 * O seletor de unidade.
 *
 * Fica sempre visível no topo: saber "de qual loja é este número" nunca pode
 * exigir um clique. "Rede Completa" só aparece para quem tem acesso de rede.
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
    <label className="flex items-center gap-2">
      <span className="sr-only">Unidade</span>
      <select
        value={valorAtual}
        disabled={trocando}
        onChange={(e) => {
          const valor = e.target.value;
          iniciarTroca(() => {
            void trocarUnidade(valor);
          });
        }}
        className="border-line-2 bg-surface text-ink hover:bg-surface-2 h-8 cursor-pointer rounded-md border px-2 text-sm font-semibold disabled:opacity-60"
      >
        {podeVerRede && <option value="rede">🌐 Rede Completa</option>}
        {unidades.map((u) => (
          <option key={u.id} value={u.id}>
            🏪 {u.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
