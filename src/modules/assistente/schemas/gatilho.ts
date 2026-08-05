/**
 * O GATILHO — a pergunta que o relógio faz a cada minuto.
 *
 * Puro de propósito, e é a peça mais testada da fase 1. O relógio bate 1.440
 * vezes por dia: um erro aqui não aparece como exceção, aparece como a equipe
 * recebendo a mesma cobrança sessenta vezes seguidas, ou não recebendo nunca.
 */

export type ConfigHorario = {
  /** "07:00" */
  horario: string;
  /** 0 = domingo. Lista vazia significa todo dia. */
  diasDaSemana: number[];
};

export type Limites = {
  janelaInicio?: string;
  janelaFim?: string;
};

/**
 * O relógio pode atrasar — contêiner reiniciando, tarefa agendada que pulou
 * uma batida. Sem tolerância, a cobrança das 7h se perderia por um minuto de
 * diferença. Com tolerância grande demais, ela chegaria fora de hora. Quinze
 * minutos é o intervalo em que "bom dia, hora da contagem" ainda faz sentido.
 */
const TOLERANCIA_MINUTOS = 15;

function emMinutos(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const hora = Number(m[1]);
  const minuto = Number(m[2]);
  if (hora > 23 || minuto > 59) return null;
  return hora * 60 + minuto;
}

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function deveDispararAgora(
  config: ConfigHorario,
  ultimoDisparo: Date | null,
  agora: Date,
): boolean {
  const alvo = emMinutos(config.horario);
  // Horário mal formado não dispara nunca. Melhor um agente calado do que um
  // agente que fala em hora imprevisível.
  if (alvo === null) return false;

  const dias = config.diasDaSemana ?? [];
  if (dias.length > 0 && !dias.includes(agora.getDay())) return false;

  // Já falou hoje: não repete, por mais vezes que o relógio bata.
  if (ultimoDisparo && mesmoDia(ultimoDisparo, agora)) return false;

  const atual = agora.getHours() * 60 + agora.getMinutes();

  // Fechada em cima de propósito: agente criado às 10h com horário de 7h não
  // cospe a cobrança de hoje. O momento passou.
  return atual >= alvo && atual <= alvo + TOLERANCIA_MINUTOS;
}

/**
 * A janela é um LIMITE, não uma instrução — vive em campo estruturado e é
 * conferida pelo código. Um agente com defeito não acorda a equipe às 3h.
 */
export function dentroDaJanela(limites: Limites, agora: Date): boolean {
  const atual = agora.getHours() * 60 + agora.getMinutes();
  const inicio = emMinutos(limites.janelaInicio ?? "");
  const fim = emMinutos(limites.janelaFim ?? "");

  if (inicio !== null && atual < inicio) return false;
  if (fim !== null && atual > fim) return false;
  return true;
}
