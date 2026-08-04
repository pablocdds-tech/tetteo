"use client";

import { useActionState, useState, type FormEvent } from "react";

import { Botao } from "@/design-system/botao";
import { sigla } from "@/lib/unidades";

import { fecharFolha, salvarFolha, type EstadoFormulario } from "../acoes";

export type ItemDaFolha = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  unidadeMedida: string;
  quantidade: string | null;
};

/**
 * A FOLHA DE CONTAGEM.
 *
 * Esta tela é usada em pé, de celular, dentro de uma câmara fria, com a mão
 * gelada. Todo o desenho sai daí:
 *
 *   · campo alto (48px) e teclado numérico — dedo com pressa não acerta alvo
 *     pequeno, e teclado de letras para digitar "12,5" é castigo;
 *   · agrupado por categoria — a pessoa anda pela loja por prateleira, não por
 *     ordem alfabética do sistema;
 *   · contador vivo no rodapé — contagem se faz em pedaços, com interrupção no
 *     meio; saber onde parou é o que faz voltar;
 *   · em branco ≠ zero — "não contei" e "acabou" são coisas diferentes, e o
 *     CMV trata cada uma do seu jeito.
 */
export function FolhaDeContagem({
  contagemId,
  itens,
  podeContar,
}: {
  contagemId: string;
  itens: ItemDaFolha[];
  podeContar: boolean;
}) {
  const [aoSalvar, acaoSalvar, salvando] = useActionState<
    EstadoFormulario,
    FormData
  >(salvarFolha, {});
  const [aoFechar, acaoFechar, fechando] = useActionState<
    EstadoFormulario,
    FormData
  >(fecharFolha, {});

  // Erro de fechamento tem precedência: é o mais recente e o mais grave.
  const estado = aoFechar.erro || aoFechar.erros ? aoFechar : aoSalvar;

  const [preenchidos, setPreenchidos] = useState(
    () => itens.filter((i) => i.quantidade !== null).length,
  );

  // Reconta a folha inteira a cada tecla. Percorrer cento e poucos campos é
  // barato; guardar um estado por campo custaria muito mais.
  function recontar(evento: FormEvent<HTMLFormElement>) {
    const campos = evento.currentTarget.querySelectorAll<HTMLInputElement>(
      'input[data-quantidade="sim"]',
    );
    let total = 0;
    campos.forEach((campo) => {
      if (campo.value.trim() !== "") total += 1;
    });
    setPreenchidos(total);
  }

  const grupos = agruparPorCategoria(itens);
  const faltam = itens.length - preenchidos;

  return (
    <form action={acaoSalvar} onInput={recontar} className="pb-28">
      <input type="hidden" name="contagemId" value={contagemId} />

      <div className="flex flex-col gap-6">
        {grupos.map(([categoria, doGrupo]) => (
          <section key={categoria}>
            <h2 className="text-ink-3 mb-1.5 font-mono text-[11px] tracking-[0.14em] uppercase">
              {categoria}
            </h2>

            <div className="border-line divide-line divide-y rounded-xl border">
              {doGrupo.map((item) => (
                <div
                  key={item.insumoId}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <label
                    htmlFor={`qtd-${item.insumoId}`}
                    className="text-ink min-w-0 flex-1 text-sm font-medium"
                  >
                    {item.nome}
                    {estado.erros?.[item.insumoId] && (
                      <span className="text-bad block text-xs font-normal">
                        {estado.erros[item.insumoId]}
                      </span>
                    )}
                  </label>

                  <div className="flex flex-none items-center gap-1.5">
                    <input
                      id={`qtd-${item.insumoId}`}
                      name={`qtd:${item.insumoId}`}
                      data-quantidade="sim"
                      defaultValue={item.quantidade ?? ""}
                      disabled={!podeContar}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="—"
                      className={[
                        "bg-surface text-ink h-12 w-24 rounded-md border px-2",
                        "text-right text-base tabular-nums",
                        "placeholder:text-ink-3",
                        "transition-[border-color,box-shadow] duration-150",
                        "focus:outline-none",
                        estado.erros?.[item.insumoId]
                          ? "border-bad focus:shadow-[0_0_0_3px_var(--bad-sub)]"
                          : "border-line-2 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-sub)]",
                        "disabled:bg-surface-2 disabled:cursor-not-allowed",
                      ].join(" ")}
                    />
                    <span className="text-ink-3 w-7 text-xs">
                      {sigla(item.unidadeMedida)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* ---- A barra que acompanha a pessoa pela loja ---- */}
      <div className="border-line bg-surface fixed right-0 bottom-0 left-0 z-40 border-t px-4 py-3 md:left-[216px]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold tabular-nums">
              {preenchidos} de {itens.length}
            </span>{" "}
            <span className="text-ink-3">contados</span>
            {faltam > 0 && (
              <span className="text-ink-3 block text-xs">
                {faltam} em branco {faltam === 1 ? "ficará" : "ficarão"} de fora
                do CMV
              </span>
            )}
          </p>

          {podeContar && (
            <div className="flex flex-none items-center gap-2">
              <Botao
                type="submit"
                peso="secundario"
                carregando={salvando}
                disabled={fechando}
              >
                Salvar
              </Botao>
              <Botao
                type="submit"
                formAction={acaoFechar}
                carregando={fechando}
                disabled={salvando}
              >
                Fechar contagem
              </Botao>
            </div>
          )}
        </div>

        {estado.erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad mx-auto mt-2 max-w-5xl rounded-md px-3 py-2 text-sm"
          >
            {estado.erro}
          </p>
        )}
        {aoSalvar.salvos !== undefined && !estado.erro && (
          <p
            role="status"
            className="text-ok mx-auto mt-2 max-w-5xl px-1 text-sm"
          >
            Contagem salva. Pode fechar o celular e continuar depois.
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Agrupa por categoria, na ordem em que aparecem.
 *
 * Sem categoria vai para o fim, sob um rótulo honesto — esconder esses itens
 * faria a contagem sair incompleta sem ninguém perceber.
 */
function agruparPorCategoria(itens: ItemDaFolha[]) {
  const mapa = new Map<string, ItemDaFolha[]>();

  for (const item of itens) {
    const chave = item.categoria?.trim() || "Sem categoria";
    const lista = mapa.get(chave);
    if (lista) lista.push(item);
    else mapa.set(chave, [item]);
  }

  return [...mapa].sort(([a], [b]) => {
    if (a === "Sem categoria") return 1;
    if (b === "Sem categoria") return -1;
    return a.localeCompare(b, "pt-BR");
  });
}
