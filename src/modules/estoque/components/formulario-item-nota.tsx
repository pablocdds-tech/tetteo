"use client";

import { useActionState, useRef, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { sigla } from "@/lib/unidades";

import { adicionarItemAcao, type EstadoFormulario } from "../acoes";

export type InsumoDaLista = {
  id: string;
  nome: string;
  unidadeMedida: string;
  unidadeRotulo: string | null;
  embalagens: { nome: string; fator: string }[];
};

/**
 * ACRESCENTAR UM ITEM À NOTA.
 *
 * O formulário é lido junto com o papel, linha por linha, então segue a ordem
 * do papel: o que é, quanto veio, quanto custou no total.
 *
 * O VALOR pedido é o TOTAL da linha, não o unitário. É o total que precisa
 * bater com o rodapé da nota; o unitário o sistema calcula e mostra. Pedir os
 * dois convida à divergência de centavo que ninguém consegue explicar depois.
 *
 * A EMBALAGEM é o ponto que decide se o CMV vai prestar. Mussarela se compra
 * em caixa de 10kg e se conta em quilo — sem a conversão, a nota entra como
 * "2" e a contagem em quilos. Quem já tem embalagem cadastrada escolhe na
 * lista; quem não tem digita o conteúdo uma vez e pode guardar para a próxima.
 */
export function FormularioItemNota({
  notaId,
  insumos,
}: {
  notaId: string;
  insumos: InsumoDaLista[];
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    adicionarItemAcao,
    {},
  );

  const formulario = useRef<HTMLFormElement>(null);
  const [insumoId, setInsumoId] = useState("");
  const [fator, setFator] = useState("1");
  const [quantidade, setQuantidade] = useState("");
  const [valor, setValor] = useState("");

  const insumo = insumos.find((i) => i.id === insumoId);
  const unidade = insumo
    ? (insumo.unidadeRotulo ?? sigla(insumo.unidadeMedida))
    : "";

  const numero = (t: string) => {
    const n = Number(t.trim().replace(/\./g, "").replace(",", "."));
    return Number.isNaN(n) ? 0 : n;
  };

  const base = numero(quantidade) * (numero(fator) || 1);
  const unitario = base > 0 ? numero(valor) / base : 0;
  const emEmbalagem = numero(fator) !== 1 && numero(fator) > 0;

  return (
    <form
      ref={formulario}
      action={async (dados) => {
        await acao(dados);
        // Só o que muda de item para item é limpo. O fornecedor da nota e a
        // embalagem escolhida costumam repetir na linha seguinte.
        setQuantidade("");
        setValor("");
        formulario.current
          ?.querySelector<HTMLSelectElement>('select[name="insumoId"]')
          ?.focus();
      }}
      className="border-line bg-surface-2 flex flex-col gap-3 rounded-xl border p-4"
    >
      <input type="hidden" name="notaId" value={notaId} />

      <div className="flex w-full flex-col gap-1.5">
        <label htmlFor="insumoId" className="text-ink-2 text-sm font-semibold">
          Insumo
        </label>
        <select
          id="insumoId"
          name="insumoId"
          value={insumoId}
          onChange={(e) => {
            setInsumoId(e.target.value);
            const escolhido = insumos.find((i) => i.id === e.target.value);
            // Embalagem padrão do insumo já vem pronta — na maioria das notas
            // o mesmo item chega sempre na mesma caixa.
            setFator(escolhido?.embalagens[0]?.fator ?? "1");
          }}
          required
          className="border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
        >
          <option value="">Escolha…</option>
          {insumos.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nome} ({i.unidadeRotulo ?? sigla(i.unidadeMedida)})
            </option>
          ))}
        </select>
        {estado.erros?.insumoId && (
          <span className="text-bad text-sm">{estado.erros.insumoId}</span>
        )}
      </div>

      {insumo && (
        <div className="flex w-full flex-col gap-1.5">
          <label
            htmlFor="fatorConversao"
            className="text-ink-2 text-sm font-semibold"
          >
            Como veio na nota
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="fatorConversao"
              value={fator}
              onChange={(e) => setFator(e.target.value)}
              className="border-line-2 bg-surface text-ink focus:border-accent h-10 min-w-[180px] flex-1 rounded-md border px-3 text-base focus:outline-none"
            >
              <option value="1">Direto em {unidade}</option>
              {insumo.embalagens.map((e) => (
                <option key={e.nome} value={e.fator}>
                  {e.nome} ({e.fator} {unidade})
                </option>
              ))}
              <option value="outra">Outra embalagem…</option>
            </select>

            {(fator === "outra" ||
              (emEmbalagem &&
                !insumo.embalagens.some((e) => e.fator === fator))) && (
              <div className="flex flex-1 items-center gap-2">
                <input
                  name="embalagemNome"
                  placeholder="Ex.: Caixa 10kg"
                  className="border-line-2 bg-surface text-ink focus:border-accent h-10 min-w-0 flex-1 rounded-md border px-3 text-base focus:outline-none"
                />
                <input
                  inputMode="decimal"
                  value={fator === "outra" ? "" : fator}
                  onChange={(e) => setFator(e.target.value)}
                  placeholder="10"
                  aria-label={`Quantos ${unidade} vêm dentro`}
                  className="border-line-2 bg-surface text-ink focus:border-accent h-10 w-20 rounded-md border px-3 text-right text-base tabular-nums focus:outline-none"
                />
                <span className="text-ink-3 text-sm">{unidade}</span>
              </div>
            )}
          </div>

          <input
            type="hidden"
            name="fatorConversao"
            value={fator === "outra" ? "1" : fator}
          />

          {emEmbalagem && (
            <label className="text-ink-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="salvarEmbalagem"
                className="accent-accent size-4"
              />
              Guardar esta embalagem no insumo, para a próxima nota já vir
              pronta
            </label>
          )}
          {estado.erros?.embalagemNome && (
            <span className="text-bad text-sm">
              {estado.erros.embalagemNome}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          rotulo={
            emEmbalagem ? "Quantas embalagens" : `Quantidade (${unidade})`
          }
          name="quantidadeNota"
          inputMode="decimal"
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          erro={estado.erros?.quantidadeNota}
          required
        />
        <Campo
          rotulo="Valor total da linha"
          name="valorTotal"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          erro={estado.erros?.valorTotal}
          ajuda="Como está no papel, não o preço unitário."
          required
        />
      </div>

      {/* A conferência antes de gravar: é aqui que um erro de conversão fica
          visível, enquanto ainda dá para corrigir sem procurar. */}
      {insumo && base > 0 && (
        <p className="text-ink-2 bg-surface rounded-md px-3 py-2 text-sm tabular-nums">
          Entram{" "}
          <strong>
            {base.toLocaleString("pt-BR")} {unidade}
          </strong>
          {unitario > 0 && (
            <>
              {" "}
              a{" "}
              <strong>
                {unitario.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                  maximumFractionDigits: 4,
                })}
                /{unidade}
              </strong>
            </>
          )}
        </p>
      )}

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}

      <div>
        <Botao type="submit" carregando={enviando}>
          Acrescentar item
        </Botao>
      </div>
    </form>
  );
}
