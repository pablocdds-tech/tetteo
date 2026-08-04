"use client";

import { useActionState, useRef, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

import {
  adicionarItemDaFicha,
  removerItemDaFicha,
  type EstadoFormulario,
} from "../acoes";
import { UNIDADES } from "../schemas/insumo";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

export type LinhaDaReceita = {
  itemId: string;
  nome: string;
  ehSubFicha: boolean;
  quantidade: number;
  unidade: string;
  quantidadeBruta: number;
  perdaPercentual: number;
  custo: number;
  observacao: string | null;
  problema: string | null;
};

export type OpcoesDeItem = {
  insumos: { id: string; nome: string; unidadeMedida: string }[];
  fichas: {
    id: string;
    nome: string;
    tipo: string;
    unidadeRendimento: string;
  }[];
};

/**
 * Centavos de verdade.
 *
 * `formatarMoeda` mostra duas casas, e cinco gramas de manjericão custam
 * R$ 0,004 — que apareceria como R$ 0,00 e faria parecer que tempero é de
 * graça. Abaixo de um real, a linha mostra até quatro casas.
 */
function moedaFina(valor: number) {
  return valor > 0 && valor < 1
    ? `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
    : `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A RECEITA.
 *
 * Cada linha mostra o que vai no prato E o que sai do estoque, lado a lado,
 * quando os dois diferem. São números diferentes sempre que há perda — 1 kg de
 * tomate limpo exige 1,25 kg comprado — e mostrar só um deles é o jeito de a
 * ficha bater na cozinha e não bater no estoque.
 *
 * A unidade da linha vem sugerida da unidade do próprio ingrediente ao
 * escolhê-lo. É o campo que mais gera erro caro: mussarela comprada em kg com
 * receita escrita em g, e um zero a mais no custo da pizza.
 */
export function EditorDeReceita({
  fichaId,
  linhas,
  opcoes,
  podeVerCustos,
  podeEditar,
}: {
  fichaId: string;
  linhas: LinhaDaReceita[];
  opcoes: OpcoesDeItem;
  podeVerCustos: boolean;
  podeEditar: boolean;
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    adicionarItemDaFicha,
    {},
  );
  const [unidade, setUnidade] = useState("UN");
  const formulario = useRef<HTMLFormElement>(null);

  /** Ao escolher o ingrediente, a unidade dele vira a sugestão da linha. */
  function aoEscolherAlvo(alvo: string) {
    const [tipo, ...resto] = alvo.split(":");
    const id = resto.join(":");
    if (tipo === "insumo") {
      const insumo = opcoes.insumos.find((i) => i.id === id);
      if (insumo) setUnidade(insumo.unidadeMedida);
      return;
    }
    const ficha = opcoes.fichas.find((f) => f.id === id);
    if (ficha) setUnidade(ficha.unidadeRendimento);
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="font-semibold">Ingredientes</h2>

        {linhas.length === 0 ? (
          <p className="border-line-2 text-ink-3 mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm">
            Nenhum ingrediente ainda. Comece pelo que pesa no custo — queijo,
            carne, massa — e deixe o tempero por último.
          </p>
        ) : (
          <div className="border-line divide-line mt-3 divide-y rounded-xl border">
            {linhas.map((l) => (
              <div
                key={l.itemId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {l.nome}
                    {l.ehSubFicha && (
                      <span className="bg-accent-sub text-accent ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                        preparo
                      </span>
                    )}
                  </span>
                  <span className="text-ink-3 block text-xs">
                    {formatarQuantidade(l.quantidade)} {sigla(l.unidade)}
                    {l.perdaPercentual > 0 && (
                      <>
                        {" "}
                        · perda {formatarQuantidade(l.perdaPercentual)}% → sai{" "}
                        {formatarQuantidade(l.quantidadeBruta)}{" "}
                        {sigla(l.unidade)} do estoque
                      </>
                    )}
                    {l.observacao ? ` · ${l.observacao}` : ""}
                  </span>
                  {l.problema && (
                    <span className="text-bad mt-0.5 block text-xs">
                      {l.problema}
                    </span>
                  )}
                </div>

                {podeVerCustos && (
                  <span className="text-ink-2 w-24 text-right text-sm tabular-nums">
                    {l.problema ? "—" : moedaFina(l.custo)}
                  </span>
                )}

                {podeEditar && (
                  <form action={removerItemDaFicha}>
                    <input type="hidden" name="fichaId" value={fichaId} />
                    <input type="hidden" name="itemId" value={l.itemId} />
                    <Botao peso="fantasma" tamanho="pequeno" type="submit">
                      Remover
                    </Botao>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {podeEditar && (
        <form
          ref={formulario}
          action={(dados) => {
            acao(dados);
            formulario.current?.reset();
          }}
          className="border-line bg-surface-2 flex flex-col gap-4 rounded-xl border p-4"
        >
          <input type="hidden" name="fichaId" value={fichaId} />

          <h3 className="font-semibold">Novo ingrediente</h3>

          <div className="flex w-full flex-col gap-1.5">
            <label htmlFor="alvo" className="text-ink-2 text-sm font-semibold">
              O que entra
            </label>
            <select
              id="alvo"
              name="alvo"
              defaultValue=""
              onChange={(e) => aoEscolherAlvo(e.target.value)}
              className={ESTILO_SELECT}
              required
            >
              <option value="" disabled>
                Escolha um insumo ou preparo
              </option>
              {opcoes.fichas.length > 0 && (
                <optgroup label="Preparos e pratos">
                  {opcoes.fichas.map((f) => (
                    <option key={f.id} value={`ficha:${f.id}`}>
                      {f.nome}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Insumos">
                {opcoes.insumos.map((i) => (
                  <option key={i.id} value={`insumo:${i.id}`}>
                    {i.nome} ({sigla(i.unidadeMedida)})
                  </option>
                ))}
              </optgroup>
            </select>
            {estado.erros?.alvo && (
              <span className="text-bad text-sm">{estado.erros.alvo}</span>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              rotulo="Quantidade"
              name="quantidade"
              inputMode="decimal"
              placeholder="200"
              erro={estado.erros?.quantidade}
              required
            />

            <div className="flex w-full flex-col gap-1.5">
              <label
                htmlFor="unidade"
                className="text-ink-2 text-sm font-semibold"
              >
                Unidade
              </label>
              <select
                id="unidade"
                name="unidade"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                className={ESTILO_SELECT}
              >
                {UNIDADES.map((u) => (
                  <option key={u.valor} value={u.valor}>
                    {u.rotulo}
                  </option>
                ))}
              </select>
              {estado.erros?.unidade && (
                <span className="text-bad text-sm">{estado.erros.unidade}</span>
              )}
            </div>

            <Campo
              rotulo="Perda no preparo (%)"
              name="perdaPercentual"
              inputMode="decimal"
              placeholder="0"
              erro={estado.erros?.perdaPercentual}
              ajuda="Tomate que perde 20% ao limpar."
            />
          </div>

          <Campo
            rotulo="Observação"
            name="observacao"
            placeholder="Ex.: fatiada fina"
            erro={estado.erros?.observacao}
          />

          {estado.erro && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
            >
              {estado.erro}
            </p>
          )}

          <div>
            <Botao type="submit" peso="secundario" carregando={enviando}>
              Adicionar
            </Botao>
          </div>
        </form>
      )}
    </div>
  );
}
