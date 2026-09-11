import { z } from "zod";

/**
 * A DATA QUE O CLAUDE PODE PEDIR.
 *
 * "Hoje" é o dia de Brasília: a loja fecha à meia-noite daqui, não de
 * Greenwich. Às 22h de uma quinta, "hoje" ainda é quinta — no relógio do
 * servidor em UTC já seria sexta, e a pergunta "quanto vendi hoje?" viraria
 * uma data futura recusada.
 */

export const DATA_MINIMA = "2020-01-01";

export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function esquemaData(agora: () => Date = () => new Date()) {
  return z.iso
    .date({
      error:
        "Use o formato AAAA-MM-DD com uma data que exista (ex.: 2026-09-10).",
    })
    .refine((data) => data >= DATA_MINIMA, {
      error: `A data precisa ser a partir de ${DATA_MINIMA}.`,
    })
    .refine((data) => data <= hojeEmSaoPaulo(agora()), {
      error: "A data não pode estar no futuro (horário de Brasília).",
    })
    .describe(
      "Dia a consultar, no formato AAAA-MM-DD, no horário de Brasília. Ex.: 2026-09-10",
    );
}
