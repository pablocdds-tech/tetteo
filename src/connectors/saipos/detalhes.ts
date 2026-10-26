import { z } from "zod";

const id = z.number().int().safe();
const choice = z.object({
  id_sale_item_choice: id,
  id_store_choice_item: id.nullish(),
  desc_sale_item_choice: z.string().max(500),
  aditional_price: z.number().finite(),
  deleted: z.enum(["Y", "N"]),
});
export const itemSaipos = z.object({
  id_sale_item: id,
  id_store_item: id.nullish(),
  desc_sale_item: z.string().max(500),
  // A API real também devolve o código PDV como número inteiro.
  integration_code: z
    .union([z.string().max(100), id])
    .transform(String)
    .nullish(),
  quantity: z.number().finite().nonnegative(),
  unit_price: z.number().finite().nonnegative(),
  deleted: z.enum(["Y", "N"]),
  id_sale_to: id.nullish(),
  id_sale_from: id.nullish(),
  choices: z.array(choice).max(500).nullish(),
});
export const historicoSaipos = z.object({
  id_sale_status_history: id,
  order: z.number().int(),
  created_at: z.string().max(50),
  duration_time_seconds: z.number().finite().nonnegative().nullish(),
  desc_store_sale_status: z.string().max(200),
  desc_cancellation_reason: z.string().max(500).nullish(),
});
const envelope = z.object({
  id_store: id.positive(),
  id_sale: id.positive(),
  updated_at: z.string().max(50),
});
export const itensVendaSaipos = envelope.extend({
  // Agregações sem itens retornam null na origem (observado em 26/10/2026).
  items: z
    .array(itemSaipos)
    .max(10000)
    .nullable()
    .transform((value) => value ?? []),
});
export const historicosVendaSaipos = envelope.extend({
  histories: z
    .array(historicoSaipos)
    .max(10000)
    .nullable()
    .transform((value) => value ?? []),
});
export type ItensVendaSaipos = z.infer<typeof itensVendaSaipos>;
export type HistoricosVendaSaipos = z.infer<typeof historicosVendaSaipos>;

// unit_price da API de Dados já inclui adicionais. Itens transferidos/excluídos
// não voltam a compor o valor da venda de origem.
export function produtosVendidos(
  vendas: { cancelada: boolean; itensSaipos: unknown }[],
) {
  const produtos = new Map<
    string,
    { nome: string; quantidade: number; centavos: number }
  >();
  for (const venda of vendas) {
    if (venda.cancelada) continue;
    const parsed = z.array(itemSaipos).safeParse(venda.itensSaipos);
    if (!parsed.success) continue;
    for (const item of parsed.data) {
      if (item.deleted === "Y" || item.id_sale_to) continue;
      const key = String(
        item.id_store_item ?? item.integration_code ?? item.desc_sale_item,
      );
      const product = produtos.get(key) ?? {
        nome: item.desc_sale_item,
        quantidade: 0,
        centavos: 0,
      };
      product.quantidade += item.quantity;
      product.centavos += Math.round(item.unit_price * item.quantity * 100);
      produtos.set(key, product);
    }
  }
  return [...produtos.values()].sort((a, b) => b.centavos - a.centavos);
}
