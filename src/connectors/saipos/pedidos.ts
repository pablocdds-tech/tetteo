import { z } from "zod";
import { configOperacao, textoId } from "./operacao-config";
import { igual, hash } from "./operacao-seguranca";

const dinheiro = z.number().finite().nonnegative().max(1000000);
const texto = z.string().max(500);
export const novoPedido = z
  .object({
    order_id: textoId,
    display_id: textoId,
    created_at: z.iso.datetime({ offset: true }),
    notes: z.string().max(2000).optional(),
    total_discount: dinheiro,
    total_increase: dinheiro.optional(),
    total_amount: dinheiro.optional(),
    customer: z.object({
      id: z.union([textoId, z.literal(-1)]),
      name: texto,
      phone: z.string().max(30).optional(),
      email: z.email().optional(),
      document_number: z.string().max(30).optional(),
      localizer: texto.optional(),
    }),
    order_method: z.object({
      mode: z.enum(["DELIVERY", "TAKEOUT", "TICKET", "TABLE"]),
      delivery_by: z.enum(["PARTNER", "RESTAURANT"]).optional(),
      delivery_fee: dinheiro.optional(),
      scheduled: z.boolean().optional(),
      delivery_date_time: z.iso.datetime({ offset: true }).optional(),
      ticket_reference: texto.optional(),
      table_reference: texto.optional(),
      pickupCode: texto.optional(),
    }),
    delivery_address: z
      .object({
        country: z.literal("BR"),
        state: z.string().length(2),
        city: texto,
        district: texto,
        street_name: texto,
        street_number: texto,
        postal_code: z.string().max(15),
        reference: texto.optional(),
        complement: texto.optional(),
        coordinates: z
          .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
          })
          .optional(),
      })
      .optional(),
    table: z
      .object({
        integration_code: textoId.optional(),
        desc_table: texto.optional(),
        desc_order_pad: texto.optional(),
      })
      .optional(),
    items: z
      .array(
        z.object({
          integration_code: textoId,
          desc_item: texto,
          quantity: z.number().positive().max(10000),
          unit_price: dinheiro,
          notes: texto.optional(),
          id_store_waiter: textoId.optional(),
          choice_items: z
            .array(
              z.object({
                integration_code: textoId,
                desc_item_choice: texto,
                aditional_price: dinheiro,
                quantity: z.number().positive().max(10000),
                notes: texto.optional(),
              }),
            )
            .max(100)
            .optional(),
        }),
      )
      .min(1)
      .max(500),
    payment_types: z
      .array(
        z.object({
          code: textoId,
          amount: dinheiro,
          change_for: dinheiro.optional(),
          complement: texto.optional(),
          type: z.enum(["ONLINE", "OFFLINE"]).optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .superRefine((p, ctx) => {
    if (
      p.order_method.mode === "DELIVERY" &&
      (!p.order_method.delivery_by || !p.delivery_address)
    )
      ctx.addIssue({
        code: "custom",
        message: "Delivery exige responsável e endereço.",
        path: ["delivery_address"],
      });
    if (
      p.order_method.mode === "TABLE" &&
      !p.table?.integration_code &&
      !p.table?.desc_order_pad
    )
      ctx.addIssue({
        code: "custom",
        message: "Informe mesa ou comanda.",
        path: ["table"],
      });
    if (p.order_method.scheduled && !p.order_method.delivery_date_time)
      ctx.addIssue({
        code: "custom",
        message: "Informe o agendamento.",
        path: ["order_method"],
      });
  });
export const comandoPedido = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("criar"), pedido: novoPedido }),
  z.object({
    acao: z.literal("adicionar"),
    comando_id: z.uuid(),
    pedido: novoPedido.refine(
      (p) => p.order_method.mode === "TABLE",
      "Adição de itens exige mesa/comanda.",
    ),
  }),
  z.object({
    acao: z.literal("status"),
    order_id: textoId,
    status: z.enum(["DISPATCHED", "CONCLUDED", "CANCELLED"]),
  }),
  z.object({ acao: z.literal("cancelar"), order_id: textoId }),
  z.object({ acao: z.literal("fechar"), order_id: textoId }),
  z.object({
    acao: z.literal("transferir"),
    order_id: textoId,
    table: textoId,
  }),
  z.object({ acao: z.literal("converter"), table: textoId }),
]);
export type ComandoPedido = z.infer<typeof comandoPedido>;
const tokens = new Map<string, { token: string; ate: number }>();
const pendentes = new Map<string, Promise<string>>();
export class FalhaPedidos extends Error {
  constructor(
    message: string,
    public incerta: boolean,
  ) {
    super(message);
  }
}
export class PedidosSaipos {
  constructor(private transport: typeof fetch = fetch) {}
  private async token() {
    const c = configOperacao("pedidos"),
      key = hash(c.partnerId + c.secret);
    const old = tokens.get(key);
    if (old && old.ate > Date.now()) return old.token;
    const active = pendentes.get(key);
    if (active) return active;
    const task = (async () => {
      const response = await this.transport(
        "https://order-api.saipos.com/auth",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idPartner: c.partnerId, secret: c.secret }),
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok)
        throw new FalhaPedidos(
          "Não foi possível autenticar na API de Pedidos.",
          false,
        );
      const data = z
        .object({ token: z.string().min(10).max(10000) })
        .parse(await response.json());
      // FAQ: 2 dias. Margem de 10 minutos, nunca um token novo por pedido.
      tokens.set(key, {
        token: data.token,
        ate: Date.now() + (48 * 60 - 10) * 60000,
      });
      return data.token;
    })();
    pendentes.set(key, task);
    try {
      return await task;
    } finally {
      pendentes.delete(key);
    }
  }
  private async request(path: string, method: string, body?: unknown) {
    const token = await this.token();
    try {
      const response = await this.transport(
        `https://order-api.saipos.com${path}`,
        {
          method,
          headers: { Authorization: token, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw new FalhaPedidos(
          `Saipos respondeu HTTP ${response.status}. Confira a operação antes de reenviar.`,
          response.status >= 500 ||
            response.status === 408 ||
            response.status === 409,
        );
      const raw = await response.text();
      return raw ? (JSON.parse(raw) as unknown) : {};
    } catch (e) {
      if (e instanceof FalhaPedidos) throw e;
      throw new FalhaPedidos(
        "Resposta incerta da Saipos. Não reenvie antes de conferir o pedido no PDV.",
        method !== "GET",
      );
    }
  }
  async executar(input: ComandoPedido) {
    const c = configOperacao("pedidos"),
      cmd = comandoPedido.parse(input);
    if (cmd.acao === "criar" || cmd.acao === "adicionar")
      return this.request("/order", "POST", {
        ...cmd.pedido,
        cod_store: c.codStore,
      });
    const { acao, ...fields } = cmd;
    const paths = {
      status: "/update-order-status",
      cancelar: "/cancel-order",
      fechar: "/close-sale",
      transferir: "/change-table",
      converter: "/convert-orders-in-table",
    };
    return this.request(
      paths[acao],
      ["fechar", "transferir"].includes(acao) ? "PUT" : "POST",
      { ...fields, cod_store: c.codStore },
    );
  }
  async consultar(tipo: string, input: Record<string, string> = {}) {
    const c = configOperacao("pedidos");
    const paths: Record<string, { path: string; fields: string[] }> = {
      catalogo: { path: "/v2/catalog", fields: [] },
      garcons: { path: "/waiters", fields: [] },
      comandas: { path: "/order-cards", fields: [] },
      pedido: { path: "/order", fields: ["order_id"] },
      comanda: { path: "/order-card-status", fields: ["order_card"] },
      mesa: { path: "/sale-status-by-table-or-pad", fields: ["table", "pad"] },
    };
    const route = paths[tipo];
    if (!route) throw new Error("Consulta Saipos inválida.");
    const params = new URLSearchParams({ cod_store: c.codStore });
    for (const field of route.fields)
      if (input[field]) params.set(field, textoId.parse(input[field]));
    if (
      ["pedido", "comanda", "mesa"].includes(tipo) &&
      !route.fields.some((f) => params.has(f))
    )
      throw new Error("Informe o identificador da consulta.");
    return this.request(`${route.path}?${params}`, "GET");
  }
}
export function conferirCodStore(value: string) {
  return igual(value, configOperacao("pedidos").codStore);
}
