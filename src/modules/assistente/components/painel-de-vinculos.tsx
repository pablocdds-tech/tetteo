"use client";

import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import {
  criarVinculoAcao,
  removerVinculoAcao,
  type EstadoFormulario,
} from "../acoes";
import type { VinculoNaLista } from "../services/vinculos";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/** "5584981336549" → "(84) 98133-6549" */
function paraLeitura(e164: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `(${m[1]}) ${m[2]}-${m[3]}`;
}

/**
 * OS NÚMEROS — a lista de quem existe para a Severina.
 *
 * Vale a pena a tela dizer isso em voz alta: sem vínculo, a pessoa não recebe
 * e (na fase 2) não é ouvida. Quem cadastra precisa entender que está
 * concedendo acesso, não preenchendo uma agenda.
 */
export function PainelDeVinculos({
  vinculos,
  disponiveis,
  podeVincular,
}: {
  vinculos: VinculoNaLista[];
  disponiveis: { id: string; nome: string; email: string }[];
  podeVincular: boolean;
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    criarVinculoAcao,
    {},
  );

  return (
    <div className="flex flex-col gap-6">
      {podeVincular && (
        <form
          action={acao}
          className="border-line bg-surface-2 flex flex-col gap-4 rounded-xl border p-4"
        >
          <div>
            <h2 className="font-semibold">Ligar um número a uma pessoa</h2>
            <p className="text-ink-3 mt-0.5 text-sm">
              A Severina só fala com quem está nesta lista — e só obedece a quem
              está nela.
            </p>
          </div>

          {estado.erro && (
            <p className="border-bad/40 bg-bad/10 text-bad rounded-md border px-3 py-2 text-sm">
              {estado.erro}
            </p>
          )}
          {estado.ok && (
            <p className="border-good/40 bg-good/10 rounded-md border px-3 py-2 text-sm">
              Número vinculado.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="usuarioId"
                className="text-ink-2 text-sm font-semibold"
              >
                Pessoa
              </label>
              <select
                id="usuarioId"
                name="usuarioId"
                required
                className={ESTILO_SELECT}
              >
                <option value="">Escolha…</option>
                {disponiveis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
              {estado.erros?.usuarioId && (
                <p className="text-bad text-sm">{estado.erros.usuarioId}</p>
              )}
            </div>

            <Campo
              rotulo="Telefone"
              name="telefone"
              placeholder="84 98133-6549"
              ajuda="Com DDD. Pode digitar como quiser."
              erro={estado.erros?.telefone}
              required
            />
          </div>

          <div>
            <Botao type="submit" carregando={enviando}>
              Vincular
            </Botao>
          </div>
        </form>
      )}

      <section>
        <h2 className="mb-3 font-semibold">
          Vinculados{" "}
          <span className="text-ink-3 font-normal">({vinculos.length})</span>
        </h2>

        {vinculos.length === 0 ? (
          <div className="border-line text-ink-3 rounded-xl border border-dashed px-4 py-10 text-center text-sm">
            Ninguém vinculado ainda. Sem isso a Severina não tem para quem
            falar.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {vinculos.map((v) => (
              <li
                key={v.id}
                className="border-line bg-surface-2 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{v.nome}</span>
                  <span className="text-ink-3 block text-sm">
                    {paraLeitura(v.telefone)}
                    {v.email ? ` · ${v.email}` : ""}
                  </span>
                </span>

                {podeVincular && (
                  <form action={removerVinculoAcao} className="flex-none">
                    <input type="hidden" name="id" value={v.id} />
                    <Botao type="submit" peso="fantasma" tamanho="pequeno">
                      Remover
                    </Botao>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
