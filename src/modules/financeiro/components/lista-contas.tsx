"use client";

import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { hojeParaCampo } from "@/lib/data";
import { formatarMoeda, paraCampo } from "@/lib/numero";

import {
  cancelarLancamentoAcao,
  estornarAcao,
  quitarLancamentoAcao,
  type EstadoFinanceiro,
} from "../acoes";
import type { LancamentoNaLista } from "../services/lancamentos";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

const ESTILO_CAMPO =
  "border-line-2 bg-surface text-ink focus:border-accent h-9 rounded-md border px-2 text-sm focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * A FILA DE CONTAS.
 *
 * Vencido em vermelho, no topo, sempre. A pergunta do dia 5 não é "quanto devo
 * este mês" — é "o que já venceu e eu não vi".
 *
 * A baixa abre um formulário com o valor já preenchido e editável. Preenchido
 * porque na esmagadora maioria das vezes pagou-se o combinado, e um campo
 * vazio obrigaria a redigitar; editável porque quando diverge — desconto,
 * juro — a diferença é justamente o que interessa registrar.
 */
export function ListaContas({
  lancamentos,
  contas,
  podeQuitar,
  podeLancar,
}: {
  lancamentos: LancamentoNaLista[];
  contas: { id: string; nome: string }[];
  podeQuitar: boolean;
  podeLancar: boolean;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [estado, acao, enviando] = useActionState<EstadoFinanceiro, FormData>(
    quitarLancamentoAcao,
    {},
  );

  if (lancamentos.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p aria-hidden className="text-2xl opacity-50">
          ✅
        </p>
        <p className="mt-2 font-semibold">Nada em aberto</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          Nenhuma conta esperando nesta fila.
        </p>
      </div>
    );
  }

  return (
    <div className="border-line divide-line divide-y rounded-xl border">
      {lancamentos.map((l) => (
        <div key={l.id} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {l.descricao}
              </span>
              <span className="text-ink-3 block truncate text-xs">
                {[
                  l.categoria?.nome,
                  l.fornecedor?.nome,
                  l.daNota ? "da nota de entrada" : null,
                  l.status === "QUITADO" && l.quitadoEm
                    ? `pago em ${data.format(l.quitadoEm)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "sem categoria"}
              </span>
            </div>

            <span
              className={`text-xs tabular-nums ${
                l.atrasado ? "text-bad font-semibold" : "text-ink-3"
              }`}
            >
              {data.format(l.vencimento)}
            </span>

            <span className="w-24 text-right text-sm font-semibold tabular-nums">
              {formatarMoeda(l.valorQuitado ?? l.valor)}
              {l.valorQuitado !== null && l.valorQuitado !== l.valor && (
                <span className="text-ink-3 block text-[10px] font-normal line-through">
                  {formatarMoeda(l.valor)}
                </span>
              )}
            </span>

            {l.status === "QUITADO" ? (
              <span className="bg-ok-sub text-ok rounded-full px-2 py-0.5 text-xs font-semibold">
                pago
              </span>
            ) : l.atrasado ? (
              <span className="bg-bad-sub text-bad rounded-full px-2 py-0.5 text-xs font-semibold">
                vencido
              </span>
            ) : null}

            {podeQuitar && l.status === "ABERTO" && (
              <Botao
                peso={aberto === l.id ? "fantasma" : "secundario"}
                tamanho="pequeno"
                type="button"
                onClick={() => setAberto(aberto === l.id ? null : l.id)}
              >
                {aberto === l.id ? "Cancelar" : "Dar baixa"}
              </Botao>
            )}

            {podeQuitar && l.status === "QUITADO" && (
              <form action={estornarAcao}>
                <input type="hidden" name="lancamentoId" value={l.id} />
                <Botao peso="fantasma" tamanho="pequeno" type="submit">
                  Estornar
                </Botao>
              </form>
            )}

            {podeLancar && l.status === "ABERTO" && aberto !== l.id && (
              <form action={cancelarLancamentoAcao}>
                <input type="hidden" name="lancamentoId" value={l.id} />
                <Botao peso="fantasma" tamanho="pequeno" type="submit">
                  ✕
                </Botao>
              </form>
            )}
          </div>

          {aberto === l.id && (
            <form
              action={acao}
              className="border-line bg-surface-2 flex flex-wrap items-end gap-2 rounded-lg border p-3"
            >
              <input type="hidden" name="lancamentoId" value={l.id} />

              <label className="flex flex-col gap-1">
                <span className="text-ink-2 text-xs font-semibold">
                  Valor pago
                </span>
                <input
                  name="valorQuitado"
                  defaultValue={paraCampo(l.valor, 2)}
                  inputMode="decimal"
                  className={`${ESTILO_CAMPO} w-28 text-right`}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-ink-2 text-xs font-semibold">Quando</span>
                <input
                  type="date"
                  name="quitadoEm"
                  defaultValue={hojeParaCampo()}
                  className={ESTILO_CAMPO}
                />
              </label>

              {contas.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="text-ink-2 text-xs font-semibold">
                    Por qual conta
                  </span>
                  <select
                    name="contaId"
                    defaultValue={l.conta?.id ?? ""}
                    className={ESTILO_CAMPO}
                  >
                    <option value="">—</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <Botao type="submit" tamanho="pequeno" carregando={enviando}>
                Confirmar
              </Botao>

              {estado.erros?.valorQuitado && (
                <span className="text-bad w-full text-sm">
                  {estado.erros.valorQuitado}
                </span>
              )}
            </form>
          )}
        </div>
      ))}

      {estado.erro && (
        <p role="alert" className="bg-bad-sub text-bad px-4 py-2 text-sm">
          {estado.erro}
        </p>
      )}
    </div>
  );
}
