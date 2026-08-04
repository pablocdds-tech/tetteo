"use client";

import { useActionState, useMemo, useState } from "react";

import { Botao } from "@/design-system/botao";

import {
  fecharFolhaAcao,
  salvarFolhaAcao,
  type EstadoChecklist,
} from "../acoes";

export type LinhaDaFolha = {
  id: string;
  textoItem: string;
  secao: string | null;
  tipo: "SIM_NAO" | "NUMERO" | "TEXTO";
  obrigatorio: boolean;
  exigeObservacaoSeNao: boolean;
  exigeFoto: boolean;
  rotuloUnidade: string | null;
  faixa: string | null;
  conforme: boolean | null;
  naoSeAplica: boolean;
  valorNumero: string;
  valorTexto: string;
  observacao: string;
};

type Marcacao = "sim" | "nao" | "na" | "";

const ESTILO_TEXTO =
  "border-line-2 bg-surface text-ink focus:border-accent min-h-[44px] w-full rounded-md border px-3 py-2 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * Quando mostrar a caixa de explicação.
 *
 * Sempre que ela puder ser exigida no fechamento, e sempre que já houver algo
 * escrito — esconder um texto que a pessoa digitou seria apagá-lo sem avisar.
 */
function precisaObservar(linha: LinhaDaFolha, marcada: Marcacao) {
  if (linha.observacao) return true;
  if (marcada === "nao") return true;
  return linha.tipo === "NUMERO" && linha.faixa !== null;
}

/**
 * A FOLHA — a tela que a equipe usa de verdade.
 *
 * Ela é feita para um celular, de pé, com pressa e com a mão suja de farinha.
 * Três consequências disso, e nenhuma é enfeite:
 *
 *   Os botões são grandes. Sim/Não/N/A ocupam a largura inteira porque errar o
 *   alvo e marcar "não" sem querer gera pendência falsa — e pendência falsa
 *   ensina a equipe a ignorar a lista.
 *
 *   Nada salva sozinho a cada toque. A internet da cozinha cai; um formulário
 *   só, gravado quando a pessoa manda, é previsível. Salvar em background e
 *   falhar em silêncio é a pior das opções.
 *
 *   A caixa de observação aparece na hora em que "Não" é marcado, ao lado da
 *   resposta e não no fim da página. Pedir a explicação depois, num campo lá
 *   embaixo, é pedir que ninguém escreva.
 */
export function FolhaDeChecklist({
  respostaId,
  linhas,
  podeResponder,
}: {
  respostaId: string;
  linhas: LinhaDaFolha[];
  podeResponder: boolean;
}) {
  const [estado, acao, enviando] = useActionState<EstadoChecklist, FormData>(
    salvarFolhaAcao,
    {},
  );
  const [fechamento, acaoFechar, fechando] = useActionState<
    EstadoChecklist,
    FormData
  >(fecharFolhaAcao, {});

  const [marcacoes, setMarcacoes] = useState<Record<string, Marcacao>>(() =>
    Object.fromEntries(
      linhas.map((l) => [
        l.id,
        l.naoSeAplica
          ? "na"
          : l.conforme === true
            ? "sim"
            : l.conforme === false
              ? "nao"
              : "",
      ]),
    ),
  );

  const [preenchidos, setPreenchidos] = useState<Set<string>>(
    () =>
      new Set(
        linhas
          .filter(
            (l) =>
              l.naoSeAplica ||
              l.conforme !== null ||
              l.valorNumero !== "" ||
              l.valorTexto !== "",
          )
          .map((l) => l.id),
      ),
  );

  function anotar(id: string, respondido: boolean) {
    setPreenchidos((antes) => {
      const novo = new Set(antes);
      if (respondido) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }

  const secoes = useMemo(() => {
    const mapa = new Map<string, LinhaDaFolha[]>();
    for (const linha of linhas) {
      const chave = linha.secao ?? "";
      const atual = mapa.get(chave) ?? [];
      atual.push(linha);
      mapa.set(chave, atual);
    }
    return [...mapa.entries()];
  }, [linhas]);

  const restantes = linhas.filter(
    (l) => l.obrigatorio && !preenchidos.has(l.id),
  ).length;

  const erroAtual = fechamento.erro ?? estado.erro;
  const errosPorItem = fechamento.erros ?? estado.erros;

  return (
    <form className="flex flex-col gap-6">
      <input type="hidden" name="respostaId" value={respostaId} />

      {secoes.map(([secao, itens]) => (
        <section key={secao || "geral"}>
          {secao && (
            <h2 className="text-ink-2 mb-2 text-sm font-semibold tracking-wide uppercase">
              {secao}
            </h2>
          )}

          <div className="border-line divide-line divide-y rounded-xl border">
            {itens.map((linha) => {
              const marcada = marcacoes[linha.id] ?? "";
              const erro = errosPorItem?.[linha.id];

              return (
                <div key={linha.id} className="flex flex-col gap-2.5 px-4 py-3">
                  <input type="hidden" name="itemId" value={linha.id} />

                  <div className="flex items-start gap-2">
                    <span className="flex-1 text-sm font-medium">
                      {linha.textoItem}
                      {!linha.obrigatorio && (
                        <span className="text-ink-3 font-normal">
                          {" "}
                          (opcional)
                        </span>
                      )}
                    </span>
                    {linha.exigeFoto && (
                      <span
                        title="Este item pede foto — o envio de imagem ainda não está ligado."
                        className="bg-surface-3 text-ink-3 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      >
                        📷 pede foto
                      </span>
                    )}
                  </div>

                  {linha.tipo === "SIM_NAO" && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          {
                            valor: "sim",
                            texto: "Sim",
                            cor: "bg-ok text-white",
                          },
                          {
                            valor: "nao",
                            texto: "Não",
                            cor: "bg-bad text-white",
                          },
                          {
                            valor: "na",
                            texto: "N/A",
                            cor: "bg-ink-3 text-white",
                          },
                        ] as const
                      ).map((opcao) => (
                        <label
                          key={opcao.valor}
                          className={[
                            "flex h-11 cursor-pointer items-center justify-center rounded-md border text-sm font-semibold transition-colors",
                            marcada === opcao.valor
                              ? `${opcao.cor} border-transparent`
                              : "border-line-2 bg-surface text-ink-2 hover:bg-surface-2",
                            podeResponder
                              ? ""
                              : "pointer-events-none opacity-60",
                          ].join(" ")}
                        >
                          <input
                            type="radio"
                            name={`resp:${linha.id}`}
                            value={opcao.valor}
                            checked={marcada === opcao.valor}
                            disabled={!podeResponder}
                            onChange={() => {
                              setMarcacoes((antes) => ({
                                ...antes,
                                [linha.id]: opcao.valor,
                              }));
                              anotar(linha.id, true);
                            }}
                            className="sr-only"
                          />
                          {opcao.texto}
                        </label>
                      ))}
                    </div>
                  )}

                  {linha.tipo === "NUMERO" && (
                    <div className="flex items-center gap-2">
                      <input
                        name={`num:${linha.id}`}
                        defaultValue={linha.valorNumero}
                        inputMode="decimal"
                        disabled={!podeResponder}
                        placeholder={linha.faixa ?? ""}
                        onChange={(e) =>
                          anotar(linha.id, e.target.value.trim() !== "")
                        }
                        className={`${ESTILO_TEXTO} max-w-[160px]`}
                      />
                      {linha.rotuloUnidade && (
                        <span className="text-ink-2 text-sm font-semibold">
                          {linha.rotuloUnidade}
                        </span>
                      )}
                      {linha.faixa && (
                        <span className="text-ink-3 text-xs">
                          aceitável: {linha.faixa}
                        </span>
                      )}
                    </div>
                  )}

                  {linha.tipo === "TEXTO" && (
                    <textarea
                      name={`txt:${linha.id}`}
                      defaultValue={linha.valorTexto}
                      rows={2}
                      disabled={!podeResponder}
                      onChange={(e) =>
                        anotar(linha.id, e.target.value.trim() !== "")
                      }
                      className={ESTILO_TEXTO}
                    />
                  )}

                  {/* A explicação aparece junto da resposta, no instante em que
                      ela passa a ser exigida — nunca num campo solto no fim da
                      página, que é o mesmo que não pedir. Um campo só por item:
                      dois com o mesmo nome fariam um sobrescrever o outro. */}
                  {precisaObservar(linha, marcada) && (
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`obs-${linha.id}`}
                        className="text-ink-2 text-xs font-semibold"
                      >
                        {marcada === "nao" && linha.exigeObservacaoSeNao
                          ? "O que houve? (obrigatório)"
                          : linha.tipo === "NUMERO" && linha.faixa
                            ? "Observação (obrigatória se a leitura sair da faixa)"
                            : "Observação"}
                      </label>
                      <textarea
                        id={`obs-${linha.id}`}
                        name={`obs:${linha.id}`}
                        defaultValue={linha.observacao}
                        rows={2}
                        disabled={!podeResponder}
                        placeholder="Ex.: filtro entupido, avisei o Zé da manutenção"
                        className={ESTILO_TEXTO}
                      />
                    </div>
                  )}

                  {erro && <p className="text-bad text-sm">{erro}</p>}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {erroAtual && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm whitespace-pre-line"
        >
          {erroAtual}
        </p>
      )}

      {estado.ok && !erroAtual && (
        <p className="bg-ok-sub text-ok rounded-md px-3 py-2 text-sm">
          {estado.ok}
        </p>
      )}

      {podeResponder && (
        <div className="bg-surface border-line sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t px-4 py-3">
          <Botao
            formAction={acao}
            peso="secundario"
            carregando={enviando}
            type="submit"
          >
            Salvar
          </Botao>
          <Botao formAction={acaoFechar} carregando={fechando} type="submit">
            Fechar checklist
          </Botao>
          <span className="text-ink-3 ml-auto text-sm tabular-nums">
            {restantes === 0
              ? "Tudo respondido"
              : `${restantes} ${restantes === 1 ? "item obrigatório falta" : "itens obrigatórios faltam"}`}
          </span>
        </div>
      )}
    </form>
  );
}
