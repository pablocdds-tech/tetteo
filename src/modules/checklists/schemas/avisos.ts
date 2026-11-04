import type { AvisoDoModulo } from "@/core/registry/tipos";
import { prazoAtual, statusDaRotina, type Agenda } from "@/lib/agenda";

/** Datas de agenda são dias locais; o relógio da VPS não decide o dia da loja. */
function diaLocal(agora: Date, fuso: string): Date {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const numero = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value);
  return new Date(numero("year"), numero("month") - 1, numero("day"));
}

function referencia(dia: Date): string {
  return [
    dia.getFullYear(),
    String(dia.getMonth() + 1).padStart(2, "0"),
    String(dia.getDate()).padStart(2, "0"),
  ].join("-");
}

export function avisoDaRotina(
  rotina: Agenda & {
    id: string;
    nome: string;
    horario: string | null;
    ultimaFechada: Date | null;
  },
  agora: Date,
  fuso: string,
): AvisoDoModulo | null {
  const hoje = diaLocal(agora, fuso);
  const ultima = rotina.ultimaFechada
    ? diaLocal(rotina.ultimaFechada, fuso)
    : null;
  const status = statusDaRotina(rotina, ultima, hoje);
  if (status === "feita") return null;

  if (status === "aguardando" && rotina.horario) {
    const hora = new Intl.DateTimeFormat("en-GB", {
      timeZone: fuso,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(agora);
    if (hora < rotina.horario) return null;
  }

  return {
    chave: `checklists:rotina:${rotina.id}:${referencia(prazoAtual(rotina, hoje))}:${status}`,
    assunto:
      status === "atrasada"
        ? `O checklist "${rotina.nome}" está atrasado e ainda precisa ser preenchido.`
        : `O checklist "${rotina.nome}" é para hoje e ainda precisa ser preenchido.`,
    referenciaTipo: "rotina_de_checklist",
    referenciaId: rotina.id,
  };
}

export function avisoDePrazo(
  resposta: { id: string; nome: string; prazoEm: Date },
  agora: Date,
): AvisoDoModulo | null {
  if (resposta.prazoEm >= agora) return null;
  return {
    chave: `checklists:resposta:${resposta.id}:prazo:${resposta.prazoEm.toISOString()}`,
    assunto: `O prazo do checklist "${resposta.nome}" passou e ele ainda não foi concluído.`,
    referenciaTipo: "resposta_de_checklist",
    referenciaId: resposta.id,
  };
}

export function avisoDeConclusao(
  resposta: {
    id: string;
    nome: string;
    fechadaEm: Date;
    itensNaoConformes: number;
  },
  agora: Date,
): AvisoDoModulo | null {
  const instante = resposta.fechadaEm.getTime();
  const fim = agora.getTime();
  if (
    !Number.isFinite(instante) ||
    instante < fim - 24 * 60 * 60_000 ||
    instante > fim
  ) {
    return null;
  }
  const problemas =
    resposta.itensNaoConformes > 0
      ? ` Apontou ${resposta.itensNaoConformes} ${resposta.itensNaoConformes === 1 ? "não conformidade" : "não conformidades"}.`
      : "";
  return {
    chave: `checklists:concluida:${resposta.id}`,
    assunto: `O checklist "${resposta.nome}" foi concluído.${problemas} Confira as respostas e evidências no sistema.`,
    referenciaTipo: "resposta_de_checklist",
    referenciaId: resposta.id,
  };
}

export function avisoDePendencia(
  pendencia: {
    id: string;
    descricao: string;
    prazo: Date | null;
  },
  agora: Date,
  fuso = "America/Sao_Paulo",
): AvisoDoModulo {
  // Pendencia.prazo é uma data da operação. Diferente de prazoEm da
  // execução, não vence à meia-noite do próprio dia informado.
  const atrasada =
    pendencia.prazo !== null &&
    diaLocal(pendencia.prazo, fuso) < diaLocal(agora, fuso);
  return {
    chave: `checklists:pendencia:${pendencia.id}:${atrasada ? "atrasada" : "aberta"}:${pendencia.prazo?.toISOString() ?? "sem-prazo"}`,
    assunto: `Há uma pendência de checklist ${atrasada ? "atrasada" : "aberta"}: ${pendencia.descricao}`,
    referenciaTipo: "pendencia_de_checklist",
    referenciaId: pendencia.id,
  };
}
