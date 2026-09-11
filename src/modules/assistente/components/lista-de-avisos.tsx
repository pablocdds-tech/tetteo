"use client";

import Link from "next/link";
import { useActionState, useId, useState, useTransition } from "react";

import { Botao } from "@/design-system/botao";
import { Etiqueta } from "@/design-system/etiqueta";
import { LinhaDeDetalhe, PainelLateral } from "@/design-system/painel-lateral";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";

import {
  abrirAvisoAcao,
  descartarAvisoAcao,
  type EstadoFormulario,
} from "../acoes";
import type { AvisoNaLista, AvisoNoDetalhe } from "../services/avisos";

import { EtapasDoAviso } from "./etapas-do-aviso";
import { quando, ROTULO_DO_AVISO, TOM_DO_AVISO } from "./rotulos";

/**
 * OS AVISOS — rascunho, destinatário, prévia, confirmação, estado, erro.
 *
 * O detalhe é onde a decisão acontece, e ele é desenhado para ela: a prévia
 * do que vai chegar no celular, quem recebe, e UM botão principal. Confirmar
 * pede um segundo toque que diz em voz alta o que vai acontecer — "enviar 1
 * mensagem para Ana". Reenviar depois de um resultado desconhecido diz o
 * risco antes: pode chegar duas vezes.
 */

type AcaoDeFormulario = (
  anterior: EstadoFormulario,
  dados: FormData,
) => Promise<EstadoFormulario>;

const COLUNAS: Coluna<AvisoNaLista>[] = [
  {
    chave: "titulo",
    titulo: "Aviso",
    principal: true,
    celula: (a) => (
      <span className="flex flex-col">
        <span>{a.titulo}</span>
        <span className="text-ink-3 text-xs font-normal">
          Ref. {a.referencia}
        </span>
      </span>
    ),
  },
  {
    chave: "loja",
    titulo: "Loja",
    celula: (a) => a.unidadeNome ?? "Rede",
  },
  {
    chave: "destinatario",
    titulo: "Para",
    celula: (a) =>
      a.destinatario ? (
        <span className="flex flex-col">
          <span>{a.destinatario.nome}</span>
          <span className="text-ink-3 text-xs tabular-nums">
            {a.destinatario.telefone}
          </span>
        </span>
      ) : (
        <span className="text-ink-3">a escolher</span>
      ),
  },
  {
    chave: "status",
    titulo: "Estado",
    celula: (a) => (
      <Etiqueta tom={TOM_DO_AVISO[a.status]}>
        {ROTULO_DO_AVISO[a.status]}
      </Etiqueta>
    ),
  },
  {
    chave: "atualizadoEm",
    titulo: "Atualizado",
    numerica: true,
    celula: (a) => quando(a.atualizadoEm),
  },
];

/** O que vai chegar no celular: o asterisco do WhatsApp vira negrito. */
function Previa({ corpo }: { corpo: string }) {
  return (
    <div>
      <p className="text-ink-3 mb-2 text-xs font-semibold">
        Prévia no WhatsApp
      </p>
      <div className="bg-surface-2 border-line rounded-lg border p-3">
        <div className="bg-surface border-line max-w-[38ch] rounded-lg rounded-tl-sm border px-3 py-2 text-sm leading-5 shadow-[var(--shadow-card)]">
          {corpo.split("\n").map((linha, i) =>
            linha === "" ? (
              <div key={i} className="h-3" aria-hidden />
            ) : (
              <p key={i} className="break-words">
                {/^\*.+\*$/.test(linha) ? (
                  <strong>{linha.slice(1, -1)}</strong>
                ) : (
                  linha
                )}
              </p>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function Mensagem({ estado }: { estado: EstadoFormulario }) {
  if (estado.erro) {
    return (
      <p role="alert" className="text-bad text-sm leading-5">
        {estado.erro}
      </p>
    );
  }
  if (estado.erros) {
    return (
      <p role="alert" className="text-bad text-sm leading-5">
        {Object.values(estado.erros)[0]}
      </p>
    );
  }
  return null;
}

function Detalhe({
  aviso,
  confirmar,
  reenviar,
  descartar,
  ocupado,
}: {
  aviso: AvisoNoDetalhe;
  confirmar: (dados: FormData) => void;
  reenviar: (dados: FormData) => void;
  descartar: (dados: FormData) => void;
  ocupado: boolean;
}) {
  const idDestino = useId();
  const unico =
    aviso.destinatariosPossiveis.length === 1
      ? aviso.destinatariosPossiveis[0].id
      : "";
  const [destino, setDestino] = useState(aviso.destinatarioRef ?? unico);
  const [perguntando, setPerguntando] = useState<
    "confirmar" | "reenviar" | "descartar" | null
  >(null);
  const escolhido = aviso.destinatariosPossiveis.find((d) => d.id === destino);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Etiqueta tom={TOM_DO_AVISO[aviso.status]}>
          {ROTULO_DO_AVISO[aviso.status]}
        </Etiqueta>
        {aviso.espera && (
          <span className="text-ink-3 text-sm">{aviso.espera}</span>
        )}
      </div>

      {aviso.erro && (
        <p
          className={`rounded-md border px-3 py-2 text-sm leading-5 ${
            aviso.status === "FALHOU"
              ? "border-bad/25 bg-bad-sub text-bad"
              : "border-warn/25 bg-warn-sub text-warn"
          }`}
        >
          {aviso.erro}
        </p>
      )}

      <Previa corpo={aviso.corpo} />

      {aviso.pode.confirmar ? (
        <form action={confirmar} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={aviso.id} />
          <label
            htmlFor={idDestino}
            className="text-ink-2 text-sm font-semibold"
          >
            Quem recebe
          </label>
          {aviso.destinatariosPossiveis.length === 0 ? (
            <p className="text-warn text-sm leading-5">
              Ninguém desta loja está autorizado a receber avisos. Um
              responsável autoriza em{" "}
              <Link href="/assistente/vinculos" className="underline">
                Números
              </Link>
              .
            </p>
          ) : (
            <select
              id={idDestino}
              name="destinatarioRef"
              required
              value={destino}
              onChange={(e) => {
                setDestino(e.target.value);
                setPerguntando(null);
              }}
              className="border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
            >
              <option value="">Escolha…</option>
              {aviso.destinatariosPossiveis.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome} · {d.telefone}
                </option>
              ))}
            </select>
          )}

          {perguntando === "confirmar" && escolhido ? (
            <div
              role="group"
              aria-label="Confirmar o envio"
              className="bg-accent-sub border-accent/25 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
            >
              <span className="text-sm leading-5">
                Enviar 1 mensagem para {escolhido.nome}?
              </span>
              <Botao type="submit" tamanho="pequeno" carregando={ocupado}>
                Sim, enviar
              </Botao>
              <Botao
                type="button"
                peso="fantasma"
                tamanho="pequeno"
                onClick={() => setPerguntando(null)}
              >
                Voltar
              </Botao>
            </div>
          ) : (
            <div>
              <Botao
                type="button"
                disabled={!escolhido}
                onClick={() => setPerguntando("confirmar")}
              >
                Confirmar envio
              </Botao>
            </div>
          )}
        </form>
      ) : (
        aviso.destinatario && (
          <dl>
            <LinhaDeDetalhe rotulo="Para">
              {aviso.destinatario.nome} · {aviso.destinatario.telefone}
            </LinhaDeDetalhe>
          </dl>
        )
      )}

      {aviso.pode.reenviar && (
        <form action={reenviar} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={aviso.id} />
          {aviso.status === "INCERTO" && (
            <p className="text-ink-2 text-sm leading-5">
              Se a mensagem tiver saído, reenviar manda uma segunda igual. O
              Tetteo já consultou o provedor {aviso.verificacoes} de 5 vezes.
            </p>
          )}
          {perguntando === "reenviar" ? (
            <div
              role="group"
              aria-label="Confirmar o reenvio"
              className="bg-warn-sub border-warn/25 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
            >
              <span className="text-sm leading-5">Reenviar mesmo assim?</span>
              <Botao type="submit" tamanho="pequeno" carregando={ocupado}>
                Sim, reenviar
              </Botao>
              <Botao
                type="button"
                peso="fantasma"
                tamanho="pequeno"
                onClick={() => setPerguntando(null)}
              >
                Voltar
              </Botao>
            </div>
          ) : (
            <div>
              <Botao
                type="button"
                peso="secundario"
                onClick={() => setPerguntando("reenviar")}
              >
                Reenviar mesmo assim
              </Botao>
            </div>
          )}
        </form>
      )}

      <section aria-label="Linha do tempo">
        <p className="text-ink-3 mb-1 text-xs font-semibold">Linha do tempo</p>
        <EtapasDoAviso etapas={aviso.etapas} status={aviso.status} />
      </section>

      <dl>
        <LinhaDeDetalhe rotulo="Preparado por">
          {aviso.solicitadoPor}
        </LinhaDeDetalhe>
        <LinhaDeDetalhe rotulo="Confirmado por">
          {aviso.confirmadoPor ?? "—"}
        </LinhaDeDetalhe>
        <LinhaDeDetalhe rotulo="Loja">
          {aviso.unidadeNome ?? "Rede"}
        </LinhaDeDetalhe>
        <LinhaDeDetalhe rotulo="Tentativas">{aviso.tentativas}</LinhaDeDetalhe>
      </dl>

      {aviso.pode.descartar && (
        <form action={descartar} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={aviso.id} />
          {perguntando === "descartar" ? (
            <div
              role="group"
              aria-label="Confirmar o descarte"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm">Descartar este aviso?</span>
              <Botao type="submit" peso="destrutivo" tamanho="pequeno">
                Sim, descartar
              </Botao>
              <Botao
                type="button"
                peso="fantasma"
                tamanho="pequeno"
                onClick={() => setPerguntando(null)}
              >
                Voltar
              </Botao>
            </div>
          ) : (
            <div>
              <Botao
                type="button"
                peso="fantasma"
                tamanho="pequeno"
                onClick={() => setPerguntando("descartar")}
              >
                Descartar
              </Botao>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

export function ListaDeAvisos({
  avisos,
  vazio,
  confirmar,
  reenviar,
}: {
  avisos: AvisoNaLista[];
  vazio: { titulo: string; explicacao: string; bom?: boolean };
  confirmar: AcaoDeFormulario;
  reenviar: AcaoDeFormulario;
}) {
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<AvisoNoDetalhe | null>(null);
  const [carregando, iniciar] = useTransition();

  function abrir(aviso: AvisoNaLista) {
    setAbertoId(aviso.id);
    setDetalhe(null);
    iniciar(async () => {
      setDetalhe(await abrirAvisoAcao(aviso.id));
    });
  }

  // Cada ação devolve o resultado E recarrega o detalhe, para a linha do
  // tempo e o estado mostrarem o que acabou de acontecer.
  const comRecarga =
    (acao: AcaoDeFormulario) =>
    async (anterior: EstadoFormulario, dados: FormData) => {
      const resultado = await acao(anterior, dados);
      const id = String(dados.get("id") ?? "");
      if (id) setDetalhe(await abrirAvisoAcao(id));
      return resultado;
    };

  const [estadoConfirmar, fazerConfirmar, confirmando] = useActionState(
    comRecarga(confirmar),
    {},
  );
  const [estadoReenviar, fazerReenviar, reenviando] = useActionState(
    comRecarga(reenviar),
    {},
  );
  const [estadoDescartar, fazerDescartar, descartando] = useActionState(
    comRecarga(descartarAvisoAcao),
    {},
  );

  const titulo = avisos.find((a) => a.id === abertoId)?.titulo ?? "Aviso";

  return (
    <>
      <Tabela
        legenda="Avisos do WhatsApp"
        colunas={COLUNAS}
        linhas={avisos}
        chaveDaLinha={(a) => a.id}
        aoAbrir={abrir}
        rotuloAbrir={(a) => `Abrir o aviso ${a.titulo}`}
        linhaAtiva={abertoId}
        vazio={
          <Vazio
            icone="entrada"
            tom={vazio.bom ? "bom" : "neutro"}
            titulo={vazio.titulo}
            explicacao={vazio.explicacao}
          />
        }
      />

      <PainelLateral
        aberto={abertoId !== null}
        aoFechar={() => {
          setAbertoId(null);
          setDetalhe(null);
        }}
        titulo={titulo}
        apoio={detalhe ? `Ref. ${detalhe.referencia}` : undefined}
      >
        {!detalhe ? (
          <p className="text-ink-3 text-sm" aria-live="polite">
            {carregando ? "Carregando…" : "Aviso não encontrado."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Detalhe
              key={`${detalhe.id}:${detalhe.status}`}
              aviso={detalhe}
              confirmar={fazerConfirmar}
              reenviar={fazerReenviar}
              descartar={fazerDescartar}
              ocupado={confirmando || reenviando || descartando}
            />
            <Mensagem estado={estadoConfirmar} />
            <Mensagem estado={estadoReenviar} />
            <Mensagem estado={estadoDescartar} />
          </div>
        )}
      </PainelLateral>
    </>
  );
}
