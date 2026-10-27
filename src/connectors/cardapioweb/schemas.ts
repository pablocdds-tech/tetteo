import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const texto = z.string().max(300);
const data = z.iso.datetime({ offset: true });
export const tokensCw = z.object({
  access_token: z.string().min(1).max(16000),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
  expires_in: z.number().int().positive().max(31_536_000),
  refresh_token: z.string().min(1).max(16000).optional(),
  scope: z.string().max(2000),
});
export const lojaCw = z.object({ id, name: texto.min(1) });
export const pedidoCw = z.object({
  id,
  status: texto.min(1),
  order_type: texto,
  sales_channel: texto,
  created_at: data,
  updated_at: data,
});
export const pedidosCw = z
  .array(pedidoCw)
  .max(10000)
  .transform((pedidos) => {
    const unicos = new Map<number, z.infer<typeof pedidoCw>>();
    for (const pedido of pedidos) {
      const anterior = unicos.get(pedido.id);
      if (
        !anterior ||
        Date.parse(pedido.updated_at) >= Date.parse(anterior.updated_at)
      )
        unicos.set(pedido.id, pedido);
    }
    return [...unicos.values()].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    );
  });
// Valores monetários viram centavos sem somar números de ponto flutuante.
export const centavosCw = z
  .number()
  .finite()
  .nonnegative()
  .max(1_000_000_000)
  .transform((valor, ctx) => {
    const texto = String(valor);
    if (!/^\d+(?:\.\d{1,2})?$/.test(texto)) {
      ctx.addIssue({ code: "custom", message: "Valor monetário inválido." });
      return z.NEVER;
    }
    const [inteiro, fracao = ""] = texto.split(".");
    return Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
  });
const opcao = z.object({ id, name: texto, status: texto, price: centavosCw });
const grupo = z.object({
  id,
  name: texto,
  status: texto,
  choice_type: texto,
  price_calculation_type: texto,
  minimum_quantity: z.number().int().nonnegative(),
  maximum_quantity: z.number().int().nonnegative(),
  options: z.array(opcao).max(5000),
});
const etapa = z.object({
  id,
  name: texto,
  price: centavosCw,
  remove_add_on_prices: z.boolean(),
  combo_step_items: z
    .array(z.object({ item_id: id, additional_price: centavosCw }))
    .max(5000),
});
const item = z.object({
  id,
  name: texto,
  status: texto,
  price: centavosCw,
  kind: texto,
  external_code: texto.nullish(),
  promotional_price_active: z.boolean(),
  promotional_price: centavosCw.nullish(),
  option_groups: z.array(grupo).max(1000),
  combo_steps: z.array(etapa).max(1000),
});
export const catalogoCw = z.object({
  categories: z
    .array(
      z.object({
        id,
        name: texto,
        status: texto,
        items: z.array(item).max(10000),
      }),
    )
    .max(2000),
});
export type PedidosCw = z.output<typeof pedidosCw>;
export type CatalogoCw = z.output<typeof catalogoCw>;

export const detalhePedidoCw = pedidoCw.extend({
  merchant_id: id,
  display_id: z.union([texto, z.number().int()]).nullish(),
  total: centavosCw,
});
export const eventoWebhookCw = z.object({
  event_id: z.string().min(1).max(128),
  event_type: z.enum(["ORDER_CREATED", "ORDER_STATUS_UPDATED"]),
  merchant_id: id,
  order_id: id,
  order_status: texto.min(1),
  created_at: data,
});
export type EventoWebhookCw = z.infer<typeof eventoWebhookCw>;
