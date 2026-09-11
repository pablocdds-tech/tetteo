"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useTransition } from "react";

import { guardarRecorte } from "./recorte";

/**
 * O FILTRO DO TOPO — loja, rodada e estado, NO ENDEREÇO.
 *
 * Diferente da busca da Despensa (que só esconde o que já veio), estes
 * filtros mudam o CONJUNTO de dados: o servidor busca outras rodadas, outros
 * pedidos. Por isso moram na URL (regra do DESIGN.md §5): voltar do detalhe
 * devolve a lista como estava, e o link colado no WhatsApp abre o mesmo
 * recorte. O recorte também fica guardado na aba, para o "← voltar" das telas
 * de detalhe (componente Voltar).
 */

export type OpcaoDoFiltro = { valor: string; rotulo: string };

export function FiltrosDeCompras({
  filtros,
}: {
  filtros: {
    nome: string;
    rotulo: string;
    opcoes: OpcaoDoFiltro[];
    todos: string;
  }[];
}) {
  const router = useRouter();
  const caminho = usePathname();
  const busca = useSearchParams();
  const [pendente, iniciar] = useTransition();
  const base = useId();

  useEffect(() => {
    guardarRecorte(caminho, busca.toString());
  }, [caminho, busca]);

  function mudar(nome: string, valor: string) {
    const params = new URLSearchParams(busca.toString());
    if (valor) params.set(nome, valor);
    else params.delete(nome);
    iniciar(() =>
      router.replace(`${caminho}${params.size ? `?${params}` : ""}`, {
        scroll: false,
      }),
    );
  }

  const algum = filtros.some((f) => busca.get(f.nome));

  return (
    <div
      className="flex flex-wrap items-end gap-2"
      aria-busy={pendente || undefined}
      data-pendente={pendente || undefined}
    >
      {filtros.map((f) => (
        <div key={f.nome} className="flex min-w-[9rem] flex-col gap-1">
          <label
            htmlFor={`${base}-${f.nome}`}
            className="text-ink-3 text-xs font-medium"
          >
            {f.rotulo}
          </label>
          <select
            id={`${base}-${f.nome}`}
            value={busca.get(f.nome) ?? ""}
            onChange={(e) => mudar(f.nome, e.target.value)}
            className="bg-surface border-line-2 text-ink hover:border-ink-3 focus:border-accent h-10 rounded-md border px-2.5 text-sm focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
          >
            <option value="">{f.todos}</option>
            {f.opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
      ))}
      {algum && (
        <button
          type="button"
          onClick={() =>
            iniciar(() => router.replace(caminho, { scroll: false }))
          }
          className="text-accent hover:bg-accent-sub h-10 rounded-md px-3 text-sm font-semibold"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
