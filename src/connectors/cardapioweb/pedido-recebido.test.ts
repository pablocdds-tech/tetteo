import assert from "node:assert/strict";
import test from "node:test";
import { detalhePedidoCw } from "./schemas";
import { normalizarPedidoRecebidoCw } from "./pedido-recebido";
import { esquemaPedidoRecebido } from "@/lib/pedido-recebido";

const base = {
  id: 1234,
  display_id: 10,
  merchant_id: 99,
  status: "confirmed",
  order_type: "delivery",
  sales_channel: "catalog",
  created_at: "2026-10-27T20:00:00-03:00",
  updated_at: "2026-10-27T20:01:00-03:00",
  total: 70.5,
};
test("pedido externo preserva número e total da origem, combos, quantidades e privacidade", () => {
  const parsed = detalhePedidoCw.parse({
    ...base,
    fiscal_document: "documento-privado",
    customer: {
      name: "Cliente fictício",
      phone: "11999999999",
      cpf: "documento-privado",
    },
    delivery_address: {
      street: "Rua fictícia",
      number: null,
      address_block: "A",
      address_lot: "2",
      neighborhood: "Centro",
      city: "Cidade fictícia",
      state: "SP",
      latitude: "coordenada-privada",
    },
    items: [
      {
        item_id: 1,
        name: "Combo",
        quantity: 1,
        unit_price: 70.5,
        total_price: 70.5,
        items: [
          {
            item_id: 2,
            name: "Pizza",
            quantity: 1,
            unit_price: 0,
            total_price: 60,
            options: [
              {
                name: "Mussarela",
                quantity: 0.5,
                unit_price: 30,
                option_group_name: "Sabores",
              },
            ],
          },
          {
            item_id: 3,
            name: "Item cancelado",
            status: "canceled",
            quantity: 1,
            unit_price: 1,
            total_price: 1,
          },
        ],
      },
      {
        item_id: 4,
        name: "Produto cancelado",
        status: "canceled",
        quantity: 1,
        unit_price: 1,
        total_price: 1,
      },
    ],
    payments: [
      {
        payment_type: "online",
        payment_method: "pix_auto",
        total: 70.5,
        status: "pending",
        card_number: "privado",
      },
    ],
  });
  const d = esquemaPedidoRecebido.parse(normalizarPedidoRecebidoCw(parsed));
  assert.equal(d.numeroOrigem, "10");
  assert.equal(d.totalCentavos, 7050);
  assert.equal(d.itens.length, 1);
  assert.ok(d.itens[0].complementos.some((o) => o.nome === "0.5× Mussarela"));
  assert.ok(!JSON.stringify(d).includes("cancelado"));
  assert.ok(!JSON.stringify(d).includes("privad"));
  assert.equal(d.entrega?.numero, "Quadra A · Lote 2");
  assert.equal(d.pagamentos[0].pago, false);
});
test("estados externos e agendamento são traduzidos sem fabricar confirmação de pagamento", () => {
  for (const [status, etapa] of Object.entries({
    confirmed: "COZINHA",
    ready: "AGUARDANDO_COLETA",
    released: "SAIU_ENTREGA",
    waiting_to_catch: "AGUARDANDO_COLETA",
    delivered: "ENTREGUE",
    closed: "ENTREGUE",
    canceled: "CANCELADO",
  })) {
    assert.equal(
      normalizarPedidoRecebidoCw(detalhePedidoCw.parse({ ...base, status }))
        .etapa,
      etapa,
    );
  }
  assert.equal(
    detalhePedidoCw.safeParse({ ...base, status: "scheduled_confirmed" })
      .success,
    false,
  );
  const agendado = normalizarPedidoRecebidoCw(
    detalhePedidoCw.parse({
      ...base,
      status: "scheduled_confirmed",
      schedule: { scheduled_date_time_start: "2026-10-28T12:00:00-03:00" },
    }),
  );
  assert.equal(agendado.etapa, "AGENDADO");
  assert.equal(agendado.agendadoPara, "2026-10-28T12:00:00-03:00");
});
