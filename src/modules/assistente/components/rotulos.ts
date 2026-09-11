import type { ComponentProps } from "react";

import type { Etiqueta } from "@/design-system/etiqueta";

import type { StatusAviso } from "../schemas/aviso";
import type { EstadoNaTela } from "../schemas/conexao";

/**
 * AS PALAVRAS E OS TONS das telas do WhatsApp — num lugar só.
 *
 * O tom da etiqueta segue o que o estado PEDE de quem olha: verde é "nada a
 * fazer", âmbar é "olhe isto", vermelho é "algo não saiu". "Aceito pelo
 * provedor" não é verde de propósito: aceito não é entregue, e a tela não
 * pode deixar parecer que é.
 */

type Tom = NonNullable<ComponentProps<typeof Etiqueta>["tom"]>;

export const ROTULO_DO_AVISO: Record<StatusAviso, string> = {
  RASCUNHO: "Rascunho",
  CONFIRMADO: "Confirmado",
  NA_FILA: "Na fila",
  ACEITO: "Aceito pelo provedor",
  ENTREGUE: "Entregue",
  LIDO: "Lido",
  INCERTO: "Resultado desconhecido",
  FALHOU: "Falhou",
  DESCARTADO: "Descartado",
};

export const TOM_DO_AVISO: Record<StatusAviso, Tom> = {
  RASCUNHO: "neutro",
  CONFIRMADO: "info",
  NA_FILA: "info",
  ACEITO: "acento",
  ENTREGUE: "ok",
  LIDO: "ok",
  INCERTO: "aviso",
  FALHOU: "ruim",
  DESCARTADO: "neutro",
};

export const TOM_DO_ESTADO: Record<EstadoNaTela, Tom> = {
  CONECTADO: "ok",
  CONECTANDO: "info",
  DESCONECTADO: "ruim",
  ATENCAO: "aviso",
  PENDENTE: "aviso",
};

export const ROTULO_DO_EVENTO = {
  RECEBIDO: "Recebido",
  PROCESSADO: "Processado",
  IGNORADO: "Ignorado",
  FALHOU: "Falhou",
} as const;

export const TOM_DO_EVENTO: Record<keyof typeof ROTULO_DO_EVENTO, Tom> = {
  RECEBIDO: "info",
  PROCESSADO: "ok",
  IGNORADO: "neutro",
  FALHOU: "ruim",
};

/** A hora da OPERAÇÃO, não a do computador de quem olha. */
const FORMATO = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Sao_Paulo",
});

/** "10/09 23:41", ou "—" quando não há registro. */
export function quando(data: Date | string | null | undefined): string {
  if (!data) return "—";
  return FORMATO.format(
    typeof data === "string" ? new Date(data) : data,
  ).replace(",", "");
}
