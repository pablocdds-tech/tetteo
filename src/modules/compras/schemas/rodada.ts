/**
 * A RODADA: estados, transições e o calendário.
 *
 * Funções puras. O banco confere a VERSÃO em cada transição (services/
 * rodadas.ts); aqui mora só a regra de quais caminhos existem.
 *
 *   RASCUNHO → COLETANDO → COTANDO → REVISAO → APROVADA → DESPACHANDO → FECHADA
 *
 * Voltar é REABRIR, e reabrir exige motivo — uma rodada fechada não recebe
 * alteração invisível. Cancelar também exige motivo, e só não vale para a
 * rodada fechada: o que já foi comprado não se "cancela", se devolve.
 */

export const ESTADOS_DA_RODADA = [
  "RASCUNHO",
  "COLETANDO",
  "COTANDO",
  "REVISAO",
  "APROVADA",
  "DESPACHANDO",
  "FECHADA",
  "CANCELADA",
] as const;

export type EstadoDaRodada = (typeof ESTADOS_DA_RODADA)[number];

export const ROTULO_DO_ESTADO: Record<EstadoDaRodada, string> = {
  RASCUNHO: "Rascunho",
  COLETANDO: "Coletando requisições",
  COTANDO: "Em cotação",
  REVISAO: "Em revisão",
  APROVADA: "Aprovada",
  DESPACHANDO: "Enviando pedidos",
  FECHADA: "Fechada",
  CANCELADA: "Cancelada",
};

const AVANCO: Partial<Record<EstadoDaRodada, EstadoDaRodada>> = {
  RASCUNHO: "COLETANDO",
  COLETANDO: "COTANDO",
  COTANDO: "REVISAO",
  REVISAO: "APROVADA",
  APROVADA: "DESPACHANDO",
  DESPACHANDO: "FECHADA",
};

/** Os caminhos de volta. Todos exigem motivo. */
const REABERTURAS: [EstadoDaRodada, EstadoDaRodada][] = [
  ["REVISAO", "COTANDO"],
  ["APROVADA", "REVISAO"],
  ["DESPACHANDO", "REVISAO"],
  ["FECHADA", "DESPACHANDO"],
];

export type Transicao =
  | { ok: true; exigeMotivo: boolean; reabertura: boolean }
  | { ok: false; mensagem: string };

export function transicaoPermitida(
  de: EstadoDaRodada,
  para: EstadoDaRodada,
): Transicao {
  if (de === para) {
    return { ok: false, mensagem: `A rodada já está em "${ROTULO_DO_ESTADO[de]}".` };
  }
  if (para === "CANCELADA") {
    if (de === "FECHADA" || de === "CANCELADA") {
      return {
        ok: false,
        mensagem:
          "Rodada fechada não se cancela: o que foi comprado se devolve, pelo recebimento.",
      };
    }
    return { ok: true, exigeMotivo: true, reabertura: false };
  }
  if (AVANCO[de] === para) {
    return { ok: true, exigeMotivo: false, reabertura: false };
  }
  if (REABERTURAS.some(([a, b]) => a === de && b === para)) {
    return { ok: true, exigeMotivo: true, reabertura: true };
  }
  return {
    ok: false,
    mensagem: `Uma rodada "${ROTULO_DO_ESTADO[de]}" não vai direto para "${ROTULO_DO_ESTADO[para]}".`,
  };
}

export function proximoEstado(de: EstadoDaRodada): EstadoDaRodada | null {
  return AVANCO[de] ?? null;
}

// ---------------------------------------------------------------- CALENDÁRIO

const DIA_MS = 86_400_000;

/** O dia do calendário (ano, mês, dia) que um instante é, NUM fuso. */
function diaCivil(momento: Date, fuso: string) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(momento);
  const valor = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)!.value);
  return { ano: valor("year"), mes: valor("month"), dia: valor("day") };
}

/** Quanto o fuso está à frente do UTC, em minutos, naquele instante. */
function deslocamento(instante: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instante));
  const valor = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)!.value);
  const comoUtc = Date.UTC(
    valor("year"),
    valor("month") - 1,
    valor("day"),
    valor("hour"),
    valor("minute"),
  );
  return Math.round((comoUtc - instante) / 60_000);
}

/** "07:00 do dia tal, em São Paulo" → o instante UTC. */
function instanteLocal(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  fuso: string,
): Date {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let utc = palpite - deslocamento(palpite, fuso) * 60_000;
  // Perto de mudança de horário o deslocamento do palpite pode não ser o do
  // resultado; uma segunda passada acerta.
  const segundo = deslocamento(utc, fuso);
  utc = palpite - segundo * 60_000;
  return new Date(utc);
}

/**
 * A semana ISO do instante, no fuso da organização: "2026-W37".
 *
 * É a CHAVE da rodada automática. Uma por agenda por semana — e por ser a
 * semana, e não o dia, mudar a agenda de segunda para quarta no meio da semana
 * não abre uma segunda rodada.
 */
export function ocorrenciaDaSemana(momento: Date, fuso: string): string {
  const { ano, mes, dia } = diaCivil(momento, fuso);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const diaDaSemana = d.getUTCDay() || 7; // 1 = segunda … 7 = domingo
  // A quinta-feira da mesma semana decide o ano ISO.
  d.setUTCDate(d.getUTCDate() + 4 - diaDaSemana);
  const anoIso = d.getUTCFullYear();
  const semana = Math.ceil(
    ((d.getTime() - Date.UTC(anoIso, 0, 1)) / DIA_MS + 1) / 7,
  );
  return `${anoIso}-W${String(semana).padStart(2, "0")}`;
}

/**
 * O instante em que a agenda abre a rodada NA SEMANA de `momento`.
 * `diaDaSemana` segue o JavaScript: 0 = domingo … 6 = sábado.
 */
export function aberturaDaSemana(
  agenda: { diaDaSemana: number; horaAbertura: string },
  momento: Date,
  fuso: string,
): Date {
  const { ano, mes, dia } = diaCivil(momento, fuso);
  const hoje = new Date(Date.UTC(ano, mes - 1, dia));
  const desdeSegunda = (hoje.getUTCDay() + 6) % 7;
  const alvo = new Date(
    hoje.getTime() + ((agenda.diaDaSemana + 6) % 7 - desdeSegunda) * DIA_MS,
  );
  const [hora, minuto] = agenda.horaAbertura.split(":").map(Number);
  return instanteLocal(
    alvo.getUTCFullYear(),
    alvo.getUTCMonth() + 1,
    alvo.getUTCDate(),
    hora,
    minuto,
    fuso,
  );
}
