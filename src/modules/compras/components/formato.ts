import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

/**
 * Formatação das telas de Compras. Os valores chegam do servidor como TEXTO
 * decimal ("535.80", "10.8") — nunca `Decimal` nem `BigInt`, que não
 * atravessam a fronteira servidor → navegador.
 */

export function dinheiro(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  return formatarMoeda(valor);
}

/** Quantidade e unidade andam juntas, sempre. "12,5" sozinho não informa. */
export function qtd(
  valor: string | number | null | undefined,
  unidade: string,
): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  return `${formatarQuantidade(valor)} ${sigla(unidade)}`;
}

const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const DIA_HORA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function dia(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return DIA.format(new Date(d));
}

export function diaHora(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return DIA_HORA.format(new Date(d)).replace(",", " às");
}

export function janela(
  de: Date | string | null,
  ate: Date | string | null,
): string {
  if (!de && !ate) return "sem janela";
  if (de && ate) return `${dia(de)} a ${dia(ate)}`;
  return dia((de ?? ate)!);
}

/** "Rodada 12" · número para gente; o id continua aleatório. */
export function nomeDaRodada(
  numero: number,
  descricao?: string | null,
): string {
  return descricao ? `Rodada ${numero} · ${descricao}` : `Rodada ${numero}`;
}
