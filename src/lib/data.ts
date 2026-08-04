/**
 * Datas vindas de formulário.
 *
 * `new Date("2026-08-04")` NÃO é 4 de agosto aqui. O padrão manda ler a data
 * pura como UTC, e meia-noite em Londres é ainda dia 3 às 21h no Brasil — a
 * nota digitada hoje aparece como ontem, e ontem pode estar em outro período
 * de CMV. O erro é silencioso: ninguém confere data, e a diferença de um dia
 * só aparece quando o número do mês não bate.
 *
 * Já `new Date("2026-08-04T07:00")`, COM horário e sem "Z", é lido como local.
 * A armadilha existe só na data pura — que é justamente o que `<input
 * type="date">` devolve.
 */

const DATA_PURA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Lê "AAAA-MM-DD" e "AAAA-MM-DDTHH:MM" sempre no fuso de quem digitou. */
export function lerDataLocal(texto: string): Date | null {
  const limpo = texto.trim();
  if (!limpo) return null;

  const puro = DATA_PURA.exec(limpo);
  if (puro) {
    const [, ano, mes, dia] = puro;
    return new Date(Number(ano), Number(mes) - 1, Number(dia));
  }

  const data = new Date(limpo);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** O valor de hoje para um `<input type="date">`, no fuso local. */
export function hojeParaCampo(agora = new Date()) {
  const deslocamento = agora.getTimezoneOffset() * 60_000;
  return new Date(agora.getTime() - deslocamento).toISOString().slice(0, 10);
}

/** O valor de agora para um `<input type="datetime-local">`, no fuso local. */
export function agoraParaCampo(agora = new Date()) {
  const deslocamento = agora.getTimezoneOffset() * 60_000;
  return new Date(agora.getTime() - deslocamento).toISOString().slice(0, 16);
}
