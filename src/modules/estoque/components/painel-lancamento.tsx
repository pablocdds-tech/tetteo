"use client";

import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { formatarMoeda } from "@/lib/numero";

import { lancarNotaAcao, type EstadoFormulario } from "../acoes";

/**
 * O BOTÃO QUE FAZ O PAPEL VIRAR ESTOQUE.
 *
 * Fica separado do resto porque é o único gesto irreversível da tela, e o
 * texto ao lado dele diz exatamente o que vai acontecer — em quantidade e em
 * dinheiro. Um botão "Lançar" sozinho obrigaria a pessoa a descobrir o efeito
 * depois de já ter acontecido.
 */
export function PainelLancamento({
  notaId,
  itens,
  valorTotal,
  local,
}: {
  notaId: string;
  itens: number;
  valorTotal: string;
  local: string | null;
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    lancarNotaAcao,
    {},
  );

  const pronta = itens > 0 && Boolean(local);

  return (
    <form
      action={acao}
      className="border-line bg-surface-2 flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4"
    >
      <input type="hidden" name="notaId" value={notaId} />

      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {pronta ? "Pronta para lançar" : "Ainda não dá para lançar"}
        </p>
        <p className="text-ink-3 mt-0.5 text-sm">
          {!local
            ? "Falta dizer onde a mercadoria foi guardada."
            : itens === 0
              ? "Acrescente ao menos um item."
              : `${itens} ${itens === 1 ? "item" : "itens"} · ${formatarMoeda(valorTotal)} entram no saldo de ${local} e no custo médio dos insumos.`}
        </p>
      </div>

      <Botao type="submit" disabled={!pronta} carregando={enviando}>
        Lançar nota
      </Botao>

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad w-full rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}
    </form>
  );
}
