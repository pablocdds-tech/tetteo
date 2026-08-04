/**
 * A AGENDA DAS ROTINAS.
 *
 * Nasceu no Estoque, para cobrar contagem. Mudou para cá quando os Checklists
 * precisaram da mesma coisa — "abertura todo dia às 7h" é o mesmo problema que
 * "contagem da praça todo dia às 7h", e um App não pode importar do outro.
 * Não há vocabulário de negócio aqui: só datas, recorrência e atraso.
 *
 * Funções puras, sem banco e sem relógio próprio — quem chama passa o "hoje".
 * É o que permite testar "segunda que vem" sem esperar até segunda.
 *
 * A cobrança é por DIA, nunca por hora: fechar a contagem das 7h às 7h20 não
 * é atraso; pular o dia é. Por isso tudo aqui compara datas sem horário.
 */

export type Agenda = {
  recorrencia: "DIARIA" | "SEMANAL" | "MENSAL";
  /** 0 = domingo … 6 = sábado (SEMANAL). */
  diaDaSemana: number | null;
  /** 1–28 (MENSAL). */
  diaDoMes: number | null;
};

export type StatusRotina = "feita" | "aguardando" | "atrasada";

/** A data sem o horário — meia-noite local. */
function soData(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diasAtras(d: Date, dias: number) {
  const r = new Date(d);
  r.setDate(r.getDate() - dias);
  return r;
}

/**
 * A ocorrência mais recente da agenda que já venceu — hoje incluso.
 *
 * É contra ela que se cobra: se a última contagem fechada é anterior a esta
 * data, a rotina está pendente.
 */
export function prazoAtual(agenda: Agenda, hoje: Date): Date {
  const dia = soData(hoje);

  if (agenda.recorrencia === "DIARIA") return dia;

  if (agenda.recorrencia === "SEMANAL") {
    const alvo = agenda.diaDaSemana ?? 1;
    const diferenca = (dia.getDay() - alvo + 7) % 7;
    return diasAtras(dia, diferenca);
  }

  // MENSAL
  const alvo = Math.min(agenda.diaDoMes ?? 1, 28);
  const nesteMes = new Date(dia.getFullYear(), dia.getMonth(), alvo);
  if (nesteMes <= dia) return nesteMes;
  return new Date(dia.getFullYear(), dia.getMonth() - 1, alvo);
}

/** A ocorrência seguinte a um prazo — para mostrar "próxima: em 6 dias". */
export function proximaOcorrencia(agenda: Agenda, prazo: Date): Date {
  if (agenda.recorrencia === "DIARIA") return diasAtras(prazo, -1);
  if (agenda.recorrencia === "SEMANAL") return diasAtras(prazo, -7);
  const alvo = Math.min(agenda.diaDoMes ?? 1, 28);
  return new Date(prazo.getFullYear(), prazo.getMonth() + 1, alvo);
}

/**
 * Onde a rotina está em relação à agenda.
 *
 *   feita       a ocorrência vigente já foi cumprida (contagem ou checklist)
 *   aguardando  vence HOJE e ainda não foi feita — o estado normal de manhã
 *   atrasada    a ocorrência vigente ficou para trás sem contagem
 */
export function statusDaRotina(
  agenda: Agenda,
  ultimaFechada: Date | null,
  hoje: Date,
): StatusRotina {
  const prazo = prazoAtual(agenda, hoje);

  if (ultimaFechada && soData(ultimaFechada) >= prazo) return "feita";
  if (prazo.getTime() === soData(hoje).getTime()) return "aguardando";
  return "atrasada";
}

/**
 * O que mostrar na coluna "próxima": a pendência vigente, ou a ocorrência
 * seguinte quando a vigente já foi feita.
 */
export function proximaCobranca(
  agenda: Agenda,
  ultimaFechada: Date | null,
  hoje: Date,
): Date {
  const prazo = prazoAtual(agenda, hoje);
  if (ultimaFechada && soData(ultimaFechada) >= prazo) {
    return proximaOcorrencia(agenda, prazo);
  }
  return prazo;
}
