"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";

import {
  atribuirPendenciaAcao,
  reabrirPendenciaAcao,
  resolverPendenciaAcao,
  type EstadoChecklist,
} from "../acoes";
import type { PendenciaNaLista } from "../services/pendencias";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

const ESTILO_CAMPO =
  "border-line-2 bg-surface text-ink focus:border-accent h-9 rounded-md border px-2 text-sm focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * A FILA DE PENDÊNCIAS.
 *
 * Resolver exige escrever o que foi feito. Um botão "Resolvido" sozinho é
 * rápido demais para ser verdade: some da tela sem deixar nada para conferir,
 * e três meses depois ninguém sabe se a coifa foi limpa ou se alguém só quis
 * limpar a lista.
 *
 * O formulário de resolução abre por clique, um de cada vez. Dezoito caixas de
 * texto abertas ao mesmo tempo transformariam a tela num paredão.
 */
export function ListaPendencias({
  pendencias,
  responsaveis,
  podeResolver,
}: {
  pendencias: PendenciaNaLista[];
  responsaveis: { id: string; nome: string }[];
  podeResolver: boolean;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [estado, acao, enviando] = useActionState<EstadoChecklist, FormData>(
    resolverPendenciaAcao,
    {},
  );

  if (pendencias.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p aria-hidden className="text-2xl opacity-50">
          🎉
        </p>
        <p className="mt-2 font-semibold">Nada pendente</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          Toda não conformidade apontada nos checklists já foi resolvida.
        </p>
      </div>
    );
  }

  return (
    <div className="border-line divide-line divide-y rounded-xl border">
      {pendencias.map((p) => (
        <div key={p.id} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{p.descricao}</span>
              <span className="text-ink-3 block text-xs">
                {p.origem ? (
                  <>
                    <Link
                      href={`/checklists/${p.origem.respostaId}`}
                      className="hover:text-ink underline"
                    >
                      {p.origem.modelo}
                    </Link>{" "}
                    · {data.format(p.origem.referencia)}
                  </>
                ) : (
                  "Aberta à mão"
                )}
                {p.responsavel
                  ? ` · ${p.responsavel.nome}`
                  : p.status === "ABERTA"
                    ? " · sem responsável"
                    : ""}
                {p.prazo && ` · prazo ${data.format(p.prazo)}`}
              </span>
              {p.status === "RESOLVIDA" && p.resolucao && (
                <span className="text-ink-2 mt-1 block text-xs">
                  ✓ {p.resolucao}
                </span>
              )}
            </div>

            {p.status === "RESOLVIDA" ? (
              <span className="bg-ok-sub text-ok rounded-full px-2 py-0.5 text-xs font-semibold">
                Resolvida
              </span>
            ) : p.atrasada ? (
              <span className="bg-bad-sub text-bad rounded-full px-2 py-0.5 text-xs font-semibold">
                Atrasada
              </span>
            ) : !p.responsavel ? (
              <span className="bg-warn-sub text-warn rounded-full px-2 py-0.5 text-xs font-semibold">
                Sem dono
              </span>
            ) : (
              <span className="bg-surface-3 text-ink-2 rounded-full px-2 py-0.5 text-xs font-semibold">
                Aberta
              </span>
            )}

            {podeResolver && p.status === "ABERTA" && (
              <Botao
                peso={aberta === p.id ? "fantasma" : "secundario"}
                tamanho="pequeno"
                type="button"
                onClick={() => setAberta(aberta === p.id ? null : p.id)}
              >
                {aberta === p.id ? "Cancelar" : "Resolver"}
              </Botao>
            )}

            {podeResolver && p.status === "RESOLVIDA" && (
              <form action={reabrirPendenciaAcao}>
                <input type="hidden" name="pendenciaId" value={p.id} />
                <Botao peso="fantasma" tamanho="pequeno" type="submit">
                  Reabrir
                </Botao>
              </form>
            )}
          </div>

          {podeResolver && p.status === "ABERTA" && aberta !== p.id && (
            <form
              action={atribuirPendenciaAcao}
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="pendenciaId" value={p.id} />
              <select
                name="responsavelId"
                defaultValue={p.responsavel?.id ?? ""}
                aria-label="Responsável"
                className={ESTILO_CAMPO}
              >
                <option value="">Sem responsável</option>
                {responsaveis.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                  </option>
                ))}
              </select>
              <input
                type="date"
                name="prazo"
                aria-label="Prazo"
                defaultValue={
                  p.prazo ? p.prazo.toISOString().slice(0, 10) : undefined
                }
                className={ESTILO_CAMPO}
              />
              <Botao peso="fantasma" tamanho="pequeno" type="submit">
                Atribuir
              </Botao>
            </form>
          )}

          {aberta === p.id && (
            <form action={acao} className="flex flex-col gap-2">
              <input type="hidden" name="pendenciaId" value={p.id} />
              <textarea
                name="resolucao"
                rows={2}
                required
                autoFocus
                placeholder="O que foi feito? Ex.: filtro trocado e coifa lavada em 04/08"
                className="border-line-2 bg-surface text-ink focus:border-accent w-full rounded-md border px-3 py-2 text-sm focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
              />
              {estado.erros?.resolucao && (
                <span className="text-bad text-sm">
                  {estado.erros.resolucao}
                </span>
              )}
              <div>
                <Botao type="submit" tamanho="pequeno" carregando={enviando}>
                  Marcar como resolvida
                </Botao>
              </div>
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
