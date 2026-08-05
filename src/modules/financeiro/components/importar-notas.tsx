"use client";

import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { formatarMoeda } from "@/lib/numero";

import { importarNotasAcao, type EstadoFinanceiro } from "../acoes";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-9 rounded-md border px-2 text-sm focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * As notas do Estoque que ainda não viraram conta a pagar.
 *
 * É a costura entre os dois módulos, e a razão de ela existir: obrigar a
 * redigitar aqui cada nota já lançada lá garantiria que ninguém digitasse — e
 * um contas a pagar incompleto é pior do que nenhum, porque dá falsa
 * segurança.
 *
 * Vem tudo marcado. O gesto esperado é "importar todas"; desmarcar é a
 * exceção, para a nota que foi paga na hora, em dinheiro.
 */
export function ImportarNotas({
  notas,
  categorias,
}: {
  notas: {
    id: string;
    fornecedor: string;
    numero: string | null;
    recebidaEm: Date;
    valorTotal: number;
  }[];
  categorias: { id: string; nome: string; tipo: string }[];
}) {
  const [estado, acao, enviando] = useActionState<EstadoFinanceiro, FormData>(
    importarNotasAcao,
    {},
  );

  if (notas.length === 0) return null;

  const total = notas.reduce((s, n) => s + n.valorTotal, 0);
  const mercadoria = categorias.find((c) => c.nome === "Mercadoria");

  return (
    <form
      action={acao}
      className="border-line bg-warn-sub/40 flex flex-col gap-3 rounded-xl border p-4"
    >
      <div>
        <h2 className="font-semibold">
          {notas.length}{" "}
          {notas.length === 1
            ? "nota lançada sem conta a pagar"
            : "notas lançadas sem conta a pagar"}
        </h2>
        <p className="text-ink-3 mt-1 text-sm">
          Mercadoria que entrou no estoque e ainda não está no seu fluxo de
          caixa — {formatarMoeda(total)} que você deve e não aparece em lugar
          nenhum.
        </p>
      </div>

      <div className="border-line divide-line max-h-64 divide-y overflow-y-auto rounded-lg border">
        {notas.map((n) => (
          <label
            key={n.id}
            className="hover:bg-surface-2 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              name="notaId"
              value={n.id}
              defaultChecked
              className="accent-accent size-4"
            />
            <span className="min-w-0 flex-1 truncate">
              {n.fornecedor}
              {n.numero ? ` · NF ${n.numero}` : ""}
            </span>
            <span className="text-ink-3 text-xs">
              {data.format(n.recebidaEm)}
            </span>
            <span className="tabular-nums">{formatarMoeda(n.valorTotal)}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-ink-2 text-xs font-semibold">
            Lançar na categoria
          </span>
          <select
            name="categoriaId"
            defaultValue={mercadoria?.id ?? ""}
            className={ESTILO_SELECT}
          >
            <option value="">Sem categoria</option>
            {categorias
              .filter((c) => c.tipo === "DESPESA")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </label>

        <Botao type="submit" carregando={enviando}>
          Importar
        </Botao>

        <span className="text-ink-3 text-xs">
          O vencimento sai da condição de pagamento do fornecedor — 28 dias
          quando não houver.
        </span>
      </div>

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p className="bg-ok-sub text-ok rounded-md px-3 py-2 text-sm">
          {estado.ok}
        </p>
      )}
    </form>
  );
}
