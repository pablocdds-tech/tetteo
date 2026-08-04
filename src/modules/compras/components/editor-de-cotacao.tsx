"use client";

import { useActionState, useRef } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

import {
  adicionarItemAcao,
  adicionarPropostaAcao,
  removerItemAcao,
  removerPropostaAcao,
  type EstadoCompras,
} from "../acoes";
import type { CotacaoCompleta } from "../services/cotacoes";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * A MONTAGEM DA COTAÇÃO: o que perguntar, e para quem.
 *
 * A quantidade é obrigatória e é o campo que as pessoas querem pular. Ela não
 * existe para controlar estoque — existe porque sem ela a comparação premia
 * quem é barato no que você compra pouco. Cotar sem quantidade é comparar
 * preço de etiqueta em vez de comparar a conta que vai chegar.
 */
export function EditorDeCotacao({
  cotacao,
  insumos,
  fornecedores,
  podeEditar,
}: {
  cotacao: CotacaoCompleta;
  insumos: {
    id: string;
    nome: string;
    unidadeMedida: string;
    unidadeRotulo: string | null;
  }[];
  fornecedores: { id: string; nome: string }[];
  podeEditar: boolean;
}) {
  const [estado, acao, enviando] = useActionState<EstadoCompras, FormData>(
    adicionarItemAcao,
    {},
  );
  const formulario = useRef<HTMLFormElement>(null);

  const jaNaLista = new Set(cotacao.itens.map((i) => i.insumoId));
  const jaConvidados = new Set(cotacao.propostas.map((p) => p.fornecedorId));

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section>
        <h2 className="font-semibold">A lista</h2>
        <p className="text-ink-3 mt-1 text-sm">
          O que você quer comprar, e quanto. A quantidade é o que faz a
          comparação valer.
        </p>

        {cotacao.itens.length === 0 ? (
          <p className="border-line-2 text-ink-3 mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm">
            Nenhum item ainda. Comece pelo que pesa: queijo, carne, farinha.
          </p>
        ) : (
          <div className="border-line divide-line mt-3 divide-y rounded-xl border">
            {cotacao.itens.map((i) => (
              <div
                key={i.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {i.nome}
                </span>
                <span className="text-ink-2 tabular-nums">
                  {formatarQuantidade(i.quantidade)} {sigla(i.unidade)}
                </span>
                {podeEditar && (
                  <form action={removerItemAcao}>
                    <input type="hidden" name="cotacaoId" value={cotacao.id} />
                    <input type="hidden" name="itemId" value={i.id} />
                    <Botao peso="fantasma" tamanho="pequeno" type="submit">
                      ✕
                    </Botao>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}

        {podeEditar && (
          <form
            ref={formulario}
            action={(dados) => {
              acao(dados);
              formulario.current?.reset();
            }}
            className="border-line bg-surface-2 mt-3 flex flex-col gap-3 rounded-xl border p-4"
          >
            <input type="hidden" name="cotacaoId" value={cotacao.id} />

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="insumoId"
                className="text-ink-2 text-sm font-semibold"
              >
                Insumo
              </label>
              <select
                id="insumoId"
                name="insumoId"
                defaultValue=""
                className={ESTILO_SELECT}
                required
              >
                <option value="" disabled>
                  Escolha
                </option>
                {insumos
                  .filter((i) => !jaNaLista.has(i.id))
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome} ({sigla(i.unidadeRotulo ?? i.unidadeMedida)})
                    </option>
                  ))}
              </select>
              {estado.erros?.insumoId && (
                <span className="text-bad text-sm">
                  {estado.erros.insumoId}
                </span>
              )}
            </div>

            <Campo
              rotulo="Quantidade"
              name="quantidade"
              inputMode="decimal"
              placeholder="40"
              erro={estado.erros?.quantidade}
              ajuda="Na unidade do insumo. É o que multiplica o preço de cada fornecedor."
              required
            />

            {estado.erro && (
              <p className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm">
                {estado.erro}
              </p>
            )}

            <div>
              <Botao
                type="submit"
                peso="secundario"
                tamanho="pequeno"
                carregando={enviando}
              >
                Adicionar item
              </Botao>
            </div>
          </form>
        )}
      </section>

      <section>
        <h2 className="font-semibold">Quem vai cotar</h2>
        <p className="text-ink-3 mt-1 text-sm">
          Convide pelo menos dois. Com um só não existe comparação — existe
          orçamento.
        </p>

        {cotacao.propostas.length === 0 ? (
          <p className="border-line-2 text-ink-3 mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm">
            Nenhum fornecedor convidado ainda.
          </p>
        ) : (
          <div className="border-line divide-line mt-3 divide-y rounded-xl border">
            {cotacao.propostas.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {p.fornecedor}
                  </span>
                  {p.telefone && (
                    <span className="text-ink-3 block text-xs">
                      {p.telefone}
                    </span>
                  )}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    p.status === "RESPONDIDA"
                      ? "bg-ok-sub text-ok"
                      : p.status === "RECUSADA"
                        ? "bg-surface-3 text-ink-3"
                        : "bg-warn-sub text-warn"
                  }`}
                >
                  {p.status === "RESPONDIDA"
                    ? "respondeu"
                    : p.status === "RECUSADA"
                      ? "recusou"
                      : "aguardando"}
                </span>
                {podeEditar && p.status !== "RESPONDIDA" && (
                  <form action={removerPropostaAcao}>
                    <input type="hidden" name="cotacaoId" value={cotacao.id} />
                    <input type="hidden" name="propostaId" value={p.id} />
                    <Botao peso="fantasma" tamanho="pequeno" type="submit">
                      ✕
                    </Botao>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}

        {podeEditar && (
          <form
            action={adicionarPropostaAcao}
            className="border-line bg-surface-2 mt-3 flex flex-wrap items-end gap-3 rounded-xl border p-4"
          >
            <input type="hidden" name="cotacaoId" value={cotacao.id} />
            <div className="min-w-[200px] flex-1">
              <label
                htmlFor="fornecedorId"
                className="text-ink-2 mb-1.5 block text-sm font-semibold"
              >
                Fornecedor
              </label>
              <select
                id="fornecedorId"
                name="fornecedorId"
                defaultValue=""
                className={ESTILO_SELECT}
                required
              >
                <option value="" disabled>
                  Escolha
                </option>
                {fornecedores
                  .filter((f) => !jaConvidados.has(f.id))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
              </select>
            </div>
            <Botao type="submit" peso="secundario" tamanho="pequeno">
              Convidar
            </Botao>
          </form>
        )}
      </section>
    </div>
  );
}
