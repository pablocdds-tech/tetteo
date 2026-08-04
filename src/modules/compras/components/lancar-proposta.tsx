"use client";

import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { formatarMoeda, formatarQuantidade, paraCampo } from "@/lib/numero";

import { lancarPropostaAcao, type EstadoCompras } from "../acoes";
import { precoUnitario } from "../schemas/comparacao";
import type { CotacaoCompleta } from "../services/cotacoes";

const ESTILO_CAMPO =
  "border-line-2 bg-surface text-ink focus:border-accent h-9 w-full rounded-md border px-2 text-sm focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * A DIGITAÇÃO DA RESPOSTA DO FORNECEDOR.
 *
 * A pessoa está com o WhatsApp aberto do lado, lendo "mussarela caixa 10kg
 * 300, tomate cx 20kg 78". A tela pede exatamente nessa ordem: embalagem,
 * quanto vem nela, quanto custa. O preço por quilo aparece calculado ao lado,
 * na hora — é ele que vai ser comparado, e ver o número mudar enquanto digita
 * é o que pega o fator errado antes de virar decisão.
 *
 * Linha em branco é "ainda não perguntei". Só "não atende" afirma que ele não
 * trabalha com o item. Confundir os dois faria um fornecedor incompleto
 * aparecer como se tivesse cotado tudo.
 */
export function LancarProposta({
  cotacaoId,
  proposta,
  itens,
}: {
  cotacaoId: string;
  proposta: CotacaoCompleta["propostas"][number];
  itens: CotacaoCompleta["itens"];
}) {
  const [estado, acao, enviando] = useActionState<EstadoCompras, FormData>(
    lancarPropostaAcao,
    {},
  );

  const inicial: Record<string, { preco: string; fator: string }> = {};
  for (const item of itens) {
    const p = proposta.precos.find((x) => x.itemId === item.id);
    inicial[item.id] = {
      preco: p && !p.naoAtende ? paraCampo(p.precoEmbalagem, 2) : "",
      fator: p ? paraCampo(p.fatorConversao) : "1",
    };
  }
  const [valores, setValores] = useState(inicial);

  function mudar(itemId: string, campo: "preco" | "fator", valor: string) {
    setValores((antes) => ({
      ...antes,
      [itemId]: { ...antes[itemId], [campo]: valor },
    }));
  }

  /** O número que vai ser comparado, calculado enquanto se digita. */
  function unitario(itemId: string) {
    const v = valores[itemId];
    if (!v) return null;
    const preco = Number(v.preco.replace(/\./g, "").replace(",", "."));
    const fator = Number(v.fator.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(preco) || !Number.isFinite(fator) || preco <= 0) {
      return null;
    }
    return precoUnitario(preco, fator);
  }

  return (
    <form action={acao} className="flex flex-col gap-3">
      <input type="hidden" name="cotacaoId" value={cotacaoId} />
      <input type="hidden" name="propostaId" value={proposta.id} />

      <div className="border-line divide-line overflow-hidden rounded-xl border">
        <div className="bg-surface-2 text-ink-3 grid grid-cols-[1fr_auto] gap-2 px-3 py-2 text-xs font-semibold sm:grid-cols-[1fr_7rem_5rem_7rem_6rem]">
          <span>Item</span>
          <span className="hidden sm:block">Embalagem</span>
          <span className="hidden text-right sm:block">Vem</span>
          <span className="hidden text-right sm:block">Preço</span>
          <span className="text-right">Por unidade</span>
        </div>

        {itens.map((item) => {
          const p = proposta.precos.find((x) => x.itemId === item.id);
          const calculado = unitario(item.id);
          const erro = estado.erros?.[item.id];

          return (
            <div key={item.id} className="px-3 py-2.5">
              <input type="hidden" name="itemId" value={item.id} />

              <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_7rem_5rem_7rem_6rem]">
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <span className="block truncate text-sm font-medium">
                    {item.nome}
                  </span>
                  <span className="text-ink-3 block text-xs">
                    precisa de {formatarQuantidade(item.quantidade)}{" "}
                    {item.unidade.toLowerCase()}
                  </span>
                </div>

                <input
                  name={`emb:${item.id}`}
                  defaultValue={p?.embalagem ?? ""}
                  placeholder="Caixa 10kg"
                  aria-label={`Embalagem de ${item.nome}`}
                  className={ESTILO_CAMPO}
                />
                <input
                  name={`fator:${item.id}`}
                  value={valores[item.id]?.fator ?? "1"}
                  onChange={(e) => mudar(item.id, "fator", e.target.value)}
                  inputMode="decimal"
                  aria-label={`Quanto vem na embalagem de ${item.nome}`}
                  className={`${ESTILO_CAMPO} text-right`}
                />
                <input
                  name={`preco:${item.id}`}
                  value={valores[item.id]?.preco ?? ""}
                  onChange={(e) => mudar(item.id, "preco", e.target.value)}
                  inputMode="decimal"
                  placeholder="300,00"
                  aria-label={`Preço da embalagem de ${item.nome}`}
                  className={`${ESTILO_CAMPO} text-right`}
                />

                <span className="text-ink-2 text-right text-sm tabular-nums">
                  {calculado === null ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <>
                      {formatarMoeda(calculado)}
                      <span className="text-ink-3 block text-[10px]">
                        por {item.unidade.toLowerCase()}
                      </span>
                    </>
                  )}
                </span>
              </div>

              <label className="text-ink-3 mt-1 flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name={`na:${item.id}`}
                  defaultChecked={p?.naoAtende ?? false}
                  className="accent-accent size-3.5"
                />
                Não trabalha com este item
              </label>

              {erro && <p className="text-bad mt-1 text-xs">{erro}</p>}
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-ink-2 text-xs font-semibold">Frete</span>
          <input
            name="frete"
            defaultValue={paraCampo(proposta.frete, 2)}
            inputMode="decimal"
            className={ESTILO_CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-2 text-xs font-semibold">
            Pedido mínimo
          </span>
          <input
            name="pedidoMinimo"
            defaultValue={paraCampo(proposta.pedidoMinimo ?? 0, 2)}
            inputMode="decimal"
            className={ESTILO_CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-2 text-xs font-semibold">Observação</span>
          <input
            name="observacao"
            defaultValue={proposta.observacao ?? ""}
            placeholder="Ex.: entrega só terça"
            className={ESTILO_CAMPO}
          />
        </label>
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

      <div>
        <Botao type="submit" peso="secundario" carregando={enviando}>
          Gravar resposta
        </Botao>
      </div>
    </form>
  );
}
