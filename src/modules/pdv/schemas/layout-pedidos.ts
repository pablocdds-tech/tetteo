import { z } from "zod";
import { STATUS_PEDIDO } from "./pedido";

export const ESTADOS_OCULTAVEIS = [
  "AGENDADO",
  "ENTREGUE",
  "CANCELADO",
] as const;
const emAndamento = ["COZINHA", "AGUARDANDO_COLETA", "SAIU_ENTREGA"] as const;
export const esquemaLayoutPedidos = z
  .object({
    versao: z.literal(1),
    modo: z.enum(["LISTAS", "KANBAN"]),
    distribuicao: z.record(z.enum(STATUS_PEDIDO), z.enum(["1", "2", "OCULTO"])),
    visiveis: z.array(z.enum(STATUS_PEDIDO)).min(3).max(6),
  })
  .strict()
  .refine(
    (d) =>
      new Set(d.visiveis).size === d.visiveis.length &&
      emAndamento.every(
        (s) => d.visiveis.includes(s) && d.distribuicao[s] !== "OCULTO",
      ),
  );
export type LayoutPedidos = z.infer<typeof esquemaLayoutPedidos>;
export const LAYOUT_PEDIDOS_PADRAO: LayoutPedidos = {
  versao: 1,
  modo: "LISTAS",
  distribuicao: {
    AGENDADO: "1",
    COZINHA: "1",
    AGUARDANDO_COLETA: "1",
    SAIU_ENTREGA: "2",
    ENTREGUE: "2",
    CANCELADO: "2",
  },
  visiveis: [...STATUS_PEDIDO],
};
export function lerLayoutPedidos(texto: string | null): LayoutPedidos {
  try {
    return esquemaLayoutPedidos.parse(JSON.parse(texto ?? "null"));
  } catch {
    return LAYOUT_PEDIDOS_PADRAO;
  }
}
