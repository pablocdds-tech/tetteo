"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import {
  iniciarAgendadoAcao,
  reagendarPedidoAcao,
} from "../acoes-agendamentos";
import type { AgendamentoEntrada } from "../agendamento-types";
import type { PedidoPdv } from "../pedido-types";
import {
  converterAgendamento,
  formatoLocalSaoPaulo,
} from "../schemas/agendamento";

type Tentativa = {
  tipo: "REAGENDAR" | "INICIAR";
  payload: {
    pedidoId: string;
    versao: number;
    chave: string;
    motivo: string;
    agendamento?: AgendamentoEntrada;
  };
};

/** As ações da agenda vivem no detalhe do mesmo pedido do quadro. */
export function GerenciarAgendamento({
  pedido,
  podeVender,
  podeOperar,
  bloqueado,
  aoOcupar,
  aoConfirmar,
}: {
  pedido: PedidoPdv;
  podeVender: boolean;
  podeOperar: boolean;
  bloqueado: boolean;
  aoOcupar: (ocupado: boolean) => void;
  aoConfirmar: () => void;
}) {
  const [tipo, setTipo] = useState<Tentativa["tipo"] | null>(null);
  const [paraLocal, setParaLocal] = useState("");
  const [antecedencia, setAntecedencia] = useState("30");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [rejeitada, setRejeitada] = useState(false);
  const [erro, setErro] = useState("");
  const tentativa = useRef<Tentativa | null>(null);
  const trava = useRef(false);
  useEffect(() => {
    if (!ocupado && !incerta) return;
    const proteger = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [ocupado, incerta]);
  if (pedido.status !== "AGENDADO" || !pedido.agendadoPara) return null;
  function abrir(operacao: Tentativa["tipo"]) {
    if (bloqueado || trava.current) return;
    setTipo(operacao);
    setParaLocal(formatoLocalSaoPaulo(pedido.agendadoPara!));
    setAntecedencia(
      String(
        Math.max(
          1,
          Math.round(
            (new Date(pedido.agendadoPara!).getTime() -
              new Date(pedido.iniciarPreparoEm!).getTime()) /
              60_000,
          ),
        ),
      ),
    );
    setMotivo("");
    setErro("");
    setRejeitada(false);
    setIncerta(false);
    tentativa.current = null;
    aoOcupar(true);
  }
  function fechar() {
    if (ocupado || incerta) return;
    setTipo(null);
    setErro("");
    tentativa.current = null;
    aoOcupar(false);
  }
  async function confirmar() {
    if (trava.current || rejeitada || !tipo) return;
    if (!navigator.onLine) {
      setErro("Sem conexão. Verifique a conexão antes de confirmar.");
      return;
    }
    if (!tentativa.current) {
      if (motivo.trim().length < 3) {
        setErro("Informe o motivo com pelo menos três caracteres.");
        return;
      }
      const agendamento = {
        paraLocal,
        antecedenciaMinutos: Number(antecedencia),
      };
      if (tipo === "REAGENDAR") {
        try {
          converterAgendamento(agendamento);
        } catch (falha) {
          setErro(
            falha instanceof Error && falha.name !== "ZodError"
              ? falha.message
              : "Confira o horário e a antecedência.",
          );
          return;
        }
      }
      tentativa.current = {
        tipo,
        payload: {
          pedidoId: pedido.id,
          versao: pedido.versao,
          chave: crypto.randomUUID(),
          motivo: motivo.trim(),
          ...(tipo === "REAGENDAR" ? { agendamento } : {}),
        },
      };
    }
    trava.current = true;
    setOcupado(true);
    setErro("");
    try {
      const envio = tentativa.current;
      const resposta =
        envio.tipo === "REAGENDAR"
          ? await reagendarPedidoAcao(envio.payload)
          : await iniciarAgendadoAcao(envio.payload);
      if (resposta.erro) {
        setErro(resposta.erro);
        if (!incerta) setRejeitada(true);
        return;
      }
      if (!resposta.ok) throw new Error("Resposta sem confirmação");
      setIncerta(false);
      setTipo(null);
      tentativa.current = null;
      aoOcupar(false);
      aoConfirmar();
    } catch {
      setIncerta(true);
      setErro(
        "A resposta não foi confirmada. Repita aqui a mesma tentativa para evitar duplicação.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {podeVender && (
          <Botao
            type="button"
            peso="secundario"
            disabled={bloqueado}
            onClick={() => abrir("REAGENDAR")}
          >
            Reagendar
          </Botao>
        )}
        {podeOperar && (
          <Botao
            type="button"
            disabled={bloqueado}
            onClick={() => abrir("INICIAR")}
          >
            Iniciar preparo agora
          </Botao>
        )}
      </div>
      {tipo && (
        <PainelLateral
          aberto
          titulo={
            tipo === "REAGENDAR" ? "Reagendar pedido" : "Iniciar preparo agora"
          }
          apoio={`Pedido #${pedido.numero.toString().padStart(4, "0")} · horários de São Paulo`}
          aoFechar={fechar}
          podeFechar={() => !ocupado && !incerta}
          rodape={
            <Botao
              type="submit"
              form="gerenciar-agendamento-pdv"
              carregando={ocupado}
              disabled={rejeitada}
            >
              {incerta
                ? "Confirmar novamente"
                : tipo === "REAGENDAR"
                  ? "Confirmar reagendamento"
                  : "Iniciar preparo"}
            </Botao>
          }
        >
          <form
            id="gerenciar-agendamento-pdv"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmar();
            }}
            className="space-y-5"
          >
            <p className="text-ink-2 text-sm">
              Preços, estoque e pagamentos já registrados serão preservados.
            </p>
            <fieldset
              disabled={ocupado || incerta || rejeitada}
              className="space-y-4"
            >
              {tipo === "REAGENDAR" && (
                <>
                  <Campo
                    rotulo="Nova data e hora (São Paulo)"
                    type="datetime-local"
                    value={paraLocal}
                    onChange={(e) => setParaLocal(e.target.value)}
                    required
                  />
                  <Campo
                    rotulo="Antecedência do preparo (minutos)"
                    type="number"
                    min={1}
                    max={1440}
                    value={antecedencia}
                    onChange={(e) => setAntecedencia(e.target.value)}
                    required
                  />
                </>
              )}
              <Campo
                rotulo="Motivo"
                minLength={3}
                maxLength={300}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                required
              />
            </fieldset>
            {erro && (
              <p
                role="alert"
                className="bg-bad-sub text-bad rounded-md p-3 text-sm"
              >
                {erro}
              </p>
            )}
            {rejeitada && !incerta && (
              <Botao type="button" peso="secundario" onClick={fechar}>
                Atualizar situação e fechar
              </Botao>
            )}
            {incerta && (
              <Link
                href="/pdv"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent text-sm underline"
              >
                Consultar a gestão em outra aba
              </Link>
            )}
          </form>
        </PainelLateral>
      )}
    </>
  );
}
