"use client";

import { useActionState, useRef, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { hojeParaCampo } from "@/lib/data";
import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

import {
  registrarSaidaAcao,
  transferirAcao,
  type EstadoFormulario,
} from "../acoes";
import { ROTULO_MOVIMENTO, type TipoDeMovimento } from "../schemas/movimentos";
import { TIPOS_DE_SAIDA } from "../schemas/movimento";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const COR: Record<TipoDeMovimento, string> = {
  ENTRADA: "bg-ok-sub text-ok",
  PERDA: "bg-bad-sub text-bad",
  QUEBRA: "bg-bad-sub text-bad",
  CONSUMO_INTERNO: "bg-warn-sub text-warn",
  DOACAO: "bg-warn-sub text-warn",
  TRANSFERENCIA: "bg-accent-sub text-accent",
  AJUSTE: "bg-surface-3 text-ink-2",
};

export type MovimentoNaLista = {
  id: string;
  tipo: TipoDeMovimento;
  insumo: string;
  unidade: string;
  local: string;
  localDestino: string | null;
  quantidade: number;
  valor: number;
  motivo: string | null;
  ocorridoEm: Date;
};

/**
 * O RAZÃO E OS DOIS GESTOS QUE O ALIMENTAM.
 *
 * Registrar perda é o gesto que ninguém quer fazer: dá trabalho, e o
 * resultado é ver quanto se está jogando fora. Por isso o formulário é curto e
 * fica na mesma tela da lista — pedir três cliques para anotar meio quilo de
 * mussarela estragada garante que ninguém anote, e uma perda que ninguém anota
 * some do custo sem sumir do bolso.
 *
 * O motivo é opcional no banco e insistente na tela. É ele que transforma
 * "R$ 800 de perda" em "R$ 800 de perda porque a câmara está com defeito" —
 * a segunda frase conserta alguma coisa; a primeira só irrita.
 */
export function PainelDeMovimentos({
  movimentos,
  insumos,
  locais,
  podeRegistrar,
  podeVerValor,
}: {
  movimentos: MovimentoNaLista[];
  insumos: { id: string; nome: string; unidade: string }[];
  locais: { id: string; nome: string }[];
  podeRegistrar: boolean;
  podeVerValor: boolean;
}) {
  const [aba, setAba] = useState<"saida" | "transferencia">("saida");
  const [estadoSaida, acaoSaida, salvandoSaida] = useActionState<
    EstadoFormulario,
    FormData
  >(registrarSaidaAcao, {});
  const [estadoTransf, acaoTransf, salvandoTransf] = useActionState<
    EstadoFormulario,
    FormData
  >(transferirAcao, {});

  const formSaida = useRef<HTMLFormElement>(null);
  const formTransf = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-8">
      {podeRegistrar && (
        <section>
          <div className="mb-3 flex items-center gap-1">
            <Aba ativa={aba === "saida"} onClick={() => setAba("saida")}>
              Registrar saída
            </Aba>
            <Aba
              ativa={aba === "transferencia"}
              onClick={() => setAba("transferencia")}
            >
              Transferir entre lugares
            </Aba>
          </div>

          {aba === "saida" ? (
            <form
              ref={formSaida}
              action={(d) => {
                acaoSaida(d);
                formSaida.current?.reset();
              }}
              className="border-line bg-surface-2 flex flex-col gap-4 rounded-xl border p-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Seletor
                  id="tipo"
                  nome="tipo"
                  rotulo="O que aconteceu"
                  erro={estadoSaida.erros?.tipo}
                >
                  {TIPOS_DE_SAIDA.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.rotulo}
                    </option>
                  ))}
                </Seletor>

                <Seletor
                  id="insumoId"
                  nome="insumoId"
                  rotulo="Insumo"
                  erro={estadoSaida.erros?.insumoId}
                  vazio
                >
                  {insumos.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome} ({sigla(i.unidade)})
                    </option>
                  ))}
                </Seletor>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Seletor
                  id="localId"
                  nome="localId"
                  rotulo="De qual lugar"
                  erro={estadoSaida.erros?.localId}
                  vazio
                >
                  {locais.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </Seletor>

                <Campo
                  rotulo="Quantidade"
                  name="quantidade"
                  inputMode="decimal"
                  placeholder="0,5"
                  erro={estadoSaida.erros?.quantidade}
                  required
                />

                <Campo
                  rotulo="Quando"
                  name="ocorridoEm"
                  type="date"
                  defaultValue={hojeParaCampo()}
                  erro={estadoSaida.erros?.ocorridoEm}
                />
              </div>

              <Campo
                rotulo="Por quê"
                name="motivo"
                placeholder="Ex.: câmara fria descongelou no fim de semana"
                erro={estadoSaida.erros?.motivo}
                ajuda="Opcional, mas é o que transforma um prejuízo num conserto."
              />

              {estadoSaida.erro && (
                <p className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm">
                  {estadoSaida.erro}
                </p>
              )}
              {estadoSaida.salvos ? (
                <p className="bg-ok-sub text-ok rounded-md px-3 py-2 text-sm">
                  Saída registrada e estoque baixado.
                </p>
              ) : null}

              <div>
                <Botao
                  type="submit"
                  peso="secundario"
                  carregando={salvandoSaida}
                >
                  Registrar saída
                </Botao>
              </div>
            </form>
          ) : (
            <form
              ref={formTransf}
              action={(d) => {
                acaoTransf(d);
                formTransf.current?.reset();
              }}
              className="border-line bg-surface-2 flex flex-col gap-4 rounded-xl border p-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Seletor
                  id="tInsumo"
                  nome="insumoId"
                  rotulo="Insumo"
                  erro={estadoTransf.erros?.insumoId}
                  vazio
                >
                  {insumos.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome} ({sigla(i.unidade)})
                    </option>
                  ))}
                </Seletor>

                <Campo
                  rotulo="Quantidade"
                  name="quantidade"
                  inputMode="decimal"
                  erro={estadoTransf.erros?.quantidade}
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Seletor
                  id="tOrigem"
                  nome="localId"
                  rotulo="De"
                  erro={estadoTransf.erros?.localId}
                  vazio
                >
                  {locais.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </Seletor>

                <Seletor
                  id="tDestino"
                  nome="localDestinoId"
                  rotulo="Para"
                  erro={estadoTransf.erros?.localDestinoId}
                  vazio
                >
                  {locais.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </Seletor>
              </div>

              {estadoTransf.erro && (
                <p className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm">
                  {estadoTransf.erro}
                </p>
              )}
              {estadoTransf.salvos ? (
                <p className="bg-ok-sub text-ok rounded-md px-3 py-2 text-sm">
                  Transferência registrada.
                </p>
              ) : null}

              <p className="text-ink-3 text-sm">
                Transferir não é perda: a mercadoria continua na loja, só muda
                de prateleira. O total da unidade não se altera.
              </p>

              <div>
                <Botao
                  type="submit"
                  peso="secundario"
                  carregando={salvandoTransf}
                >
                  Transferir
                </Botao>
              </div>
            </form>
          )}
        </section>
      )}

      <section>
        <h2 className="font-semibold">Histórico</h2>
        {movimentos.length === 0 ? (
          <p className="border-line-2 text-ink-3 mt-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
            Nenhum movimento ainda. Toda entrada, saída, transferência e ajuste
            de contagem aparece aqui — é o que torna a posição explicável.
          </p>
        ) : (
          <div className="border-line divide-line mt-3 divide-y rounded-xl border">
            {movimentos.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              >
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${COR[m.tipo]}`}
                >
                  {ROTULO_MOVIMENTO[m.tipo].toLowerCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {m.insumo}
                  </span>
                  <span className="text-ink-3 block truncate text-xs">
                    {m.local}
                    {m.localDestino ? ` → ${m.localDestino}` : ""}
                    {m.motivo ? ` · ${m.motivo}` : ""}
                  </span>
                </div>

                <span className="text-ink-2 text-sm tabular-nums">
                  {formatarQuantidade(m.quantidade)} {sigla(m.unidade)}
                </span>

                {podeVerValor && (
                  <span className="text-ink-3 w-24 text-right text-sm tabular-nums">
                    {formatarMoeda(m.valor)}
                  </span>
                )}

                <span className="text-ink-3 text-xs tabular-nums">
                  {data.format(m.ocorridoEm)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Aba({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-medium ${
        ativa
          ? "bg-accent text-accent-ink"
          : "text-ink-2 hover:bg-surface-2 border-line-2 border"
      }`}
    >
      {children}
    </button>
  );
}

function Seletor({
  id,
  nome,
  rotulo,
  erro,
  vazio,
  children,
}: {
  id: string;
  nome: string;
  rotulo: string;
  erro?: string;
  vazio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-ink-2 text-sm font-semibold">
        {rotulo}
      </label>
      <select
        id={id}
        name={nome}
        defaultValue={vazio ? "" : undefined}
        className={ESTILO_SELECT}
        required
      >
        {vazio && (
          <option value="" disabled>
            Escolha
          </option>
        )}
        {children}
      </select>
      {erro && <span className="text-bad text-sm">{erro}</span>}
    </div>
  );
}
