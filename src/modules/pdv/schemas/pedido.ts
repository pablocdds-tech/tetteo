import { z } from "zod";
import type { DestinoPedido, StatusPedido } from "../pedido-types";
import { ErroPdv } from "./erro";

export const STATUS_PEDIDO = [
  "AGENDADO",
  "COZINHA",
  "AGUARDANDO_COLETA",
  "SAIU_ENTREGA",
  "ENTREGUE",
  "CANCELADO",
] as const;
export const ROTULO_PEDIDO: Record<StatusPedido, string> = {
  AGENDADO: "Agendado",
  COZINHA: "Na cozinha",
  AGUARDANDO_COLETA: "Aguardando coleta",
  SAIU_ENTREGA: "Saiu para entrega",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};
export const esquemaMoverPedido = z
  .object({
    pedidoId: z.string().trim().min(1).max(100),
    versao: z.number().int().min(1).max(2_000_000_000),
    destino: z.enum(["AGUARDANDO_COLETA", "SAIU_ENTREGA", "ENTREGUE"]),
  })
  .strict();
export const esquemaListaPedidos = z
  .object({
    visao: z
      .enum([
        "TODOS",
        "EM_ANDAMENTO",
        "AGENDADOS",
        "RETIRADA",
        "ENTREGA",
        "BALCAO",
      ])
      .default("TODOS"),
    dia: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
export function proximaEtapa(
  status: StatusPedido,
  modalidade: string,
): DestinoPedido | null {
  if (status === "COZINHA") return "AGUARDANDO_COLETA";
  if (status === "AGUARDANDO_COLETA")
    return modalidade === "ENTREGA" ? "SAIU_ENTREGA" : "ENTREGUE";
  if (status === "SAIU_ENTREGA" && modalidade === "ENTREGA") return "ENTREGUE";
  return null;
}
export function validarTransicaoPedido(
  status: StatusPedido,
  destino: DestinoPedido,
  modalidade: string,
) {
  if (!["BALCAO", "RETIRADA", "ENTREGA"].includes(modalidade))
    throw new ErroPdv("Modalidade de pedido inválida.");
  if (proximaEtapa(status, modalidade) !== destino)
    throw new ErroPdv(
      "Esta mudança de etapa não é permitida. Atualize o quadro e siga a sequência do pedido.",
    );
}
const formatadorDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function diaPedidos(agora = new Date()): string {
  return formatadorDia.format(agora);
}
/** Início do dia no fuso da operação, independente do fuso do servidor. */
function inicioDia(dia: string): Date {
  const alvo = new Date(`${dia}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dia) ||
    Number.isNaN(alvo.getTime()) ||
    alvo.toISOString().slice(0, 10) !== dia ||
    dia < "2000-01-01" ||
    dia > "2101-01-01"
  )
    throw new ErroPdv("Escolha uma data válida entre 2000 e 2100.");
  // Procura o primeiro instante do dia civil: também trata dias históricos
  // em que o horário de verão eliminou a meia-noite, sem supor UTC-3 fixo.
  let menor = alvo.getTime() - 36 * 60 * 60 * 1000;
  let maior = alvo.getTime() + 36 * 60 * 60 * 1000;
  while (maior - menor > 1) {
    const meio = Math.floor((menor + maior) / 2);
    if (diaPedidos(new Date(meio)) >= dia) maior = meio;
    else menor = meio;
  }
  return new Date(maior);
}
export function periodoPedidos(dia: string) {
  if (dia < "2000-01-01" || dia > "2100-12-31")
    throw new ErroPdv("Escolha uma data válida entre 2000 e 2100.");
  const inicio = inicioDia(dia);
  const seguinte = new Date(`${dia}T00:00:00Z`);
  seguinte.setUTCDate(seguinte.getUTCDate() + 1);
  return { inicio, fim: inicioDia(seguinte.toISOString().slice(0, 10)) };
}
