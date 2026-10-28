"use client";
import { useEffect, useState } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import type { AgendamentoEntrada } from "../agendamento-types";
import {
  formatoLocalSaoPaulo,
  converterAgendamento,
} from "../schemas/agendamento";

export function horarioSaoPaulo(data: string | Date) {
  return new Date(data).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}
export function dataLocalAgendamento(data: string | Date) {
  return formatoLocalSaoPaulo(data);
}
export function DadosAgendamento({
  agendamento,
  bloqueado,
  aoFechar,
  aoConfirmar,
}: {
  agendamento: AgendamentoEntrada | null;
  bloqueado: boolean;
  aoFechar: () => void;
  aoConfirmar: (agendamento: AgendamentoEntrada | null) => void;
}) {
  const [agendar, setAgendar] = useState(!!agendamento);
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [paraLocal, setParaLocal] = useState(
    () =>
      agendamento?.paraLocal ??
      dataLocalAgendamento(new Date(Date.now() + 3600000)),
  );
  const [antecedencia, setAntecedencia] = useState(
    String(agendamento?.antecedenciaMinutos ?? 30),
  );
  const [erro, setErro] = useState("");
  let inicio: Date | null = null;
  try {
    if (agendar)
      inicio = converterAgendamento({
        paraLocal,
        antecedenciaMinutos: Number(antecedencia),
      }).iniciarPreparoEm;
  } catch {}
  function confirmar() {
    if (bloqueado) return;
    if (!agendar) {
      aoConfirmar(null);
      return;
    }
    try {
      const entrada = { paraLocal, antecedenciaMinutos: Number(antecedencia) };
      converterAgendamento(entrada);
      aoConfirmar(entrada);
    } catch (falha) {
      setErro(
        falha instanceof Error && falha.name !== "ZodError"
          ? falha.message
          : "Informe data, hora e antecedência de 1 a 1.440 minutos.",
      );
    }
  }
  return (
    <PainelLateral
      aberto
      aoFechar={aoFechar}
      podeFechar={() => !bloqueado}
      titulo="Quando preparar o pedido"
      apoio="Horários de São Paulo."
      rodape={
        <Botao className="w-full" disabled={bloqueado} onClick={confirmar}>
          Confirmar horário
        </Botao>
      }
    >
      <div className="space-y-5">
        <fieldset disabled={bloqueado} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Atendimento</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="momento-pedido"
              checked={!agendar}
              onChange={() => setAgendar(false)}
              className="accent-accent"
            />
            Para agora
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="momento-pedido"
              checked={agendar}
              onChange={() => setAgendar(true)}
              className="accent-accent"
            />
            Agendar
          </label>
        </fieldset>
        {agendar && (
          <fieldset disabled={bloqueado} className="space-y-4">
            <Campo
              rotulo="Data e hora prometida (São Paulo)"
              type="datetime-local"
              value={paraLocal}
              onChange={(e) => {
                setParaLocal(e.target.value);
                setErro("");
              }}
            />
            <Campo
              rotulo="Iniciar preparo quantos minutos antes?"
              type="number"
              min={1}
              max={1440}
              value={antecedencia}
              onChange={(e) => {
                setAntecedencia(e.target.value);
                setErro("");
              }}
              ajuda="De 1 a 1.440 minutos. Agende entre 5 minutos e 90 dias."
            />
            {inicio && (
              <p role="status" className="bg-surface-2 rounded-md p-3 text-sm">
                {inicio.getTime() <= agora
                  ? "O horário de preparo já chegou: o pedido entrará imediatamente na cozinha."
                  : `Início previsto do preparo: ${horarioSaoPaulo(inicio)}.`}
              </p>
            )}
          </fieldset>
        )}
        <p className="text-ink-2 text-sm">
          Estoque e pagamento são registrados ao confirmar o pedido. O
          agendamento controla apenas o início da produção.
        </p>
        {erro && (
          <p role="alert" className="text-bad text-sm">
            {erro}
          </p>
        )}
      </div>
    </PainelLateral>
  );
}
