import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { enviarComando, registrarEventoPedido } from "./operacoes";
import { PedidosSaipos } from "./pedidos";
import {
  receberEntrega,
  receberAvisoEntrega,
  enviarTracking,
} from "./logistica";
import { contextoCifra, reservar } from "./operacao-repositorio";
import { decifrar } from "./operacao-seguranca";
import { sincronizarDetalhes } from "./sincronizar-detalhes";
import { SaiposClient } from "./client";

const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV !== "test" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Testes Saipos exigem banco local exclusivo _test.");
Object.assign(process.env, {
  SAIPOS_OPERATIONS_ENVIRONMENT: "homologacao",
  SAIPOS_OPERATIONS_KEY: "ab".repeat(32),
  SAIPOS_ORDER_ENABLED: "true",
  SAIPOS_ORDER_PARTNER_ID: "test-partner-integration",
  SAIPOS_ORDER_SECRET: "test-secret",
  SAIPOS_ORDER_STORE_CODE: "test-store",
  SAIPOS_ORDER_WEBHOOK_KEY: "cd".repeat(32),
  SAIPOS_LOGISTICS_ENABLED: "true",
  SAIPOS_LOGISTICS_CLIENT_ID: "test-client",
  SAIPOS_LOGISTICS_CLIENT_SECRET: "test-secret-for-logistics-123456789012",
  SAIPOS_LOGISTICS_MERCHANT_ID: "test-merchant",
  SAIPOS_TOKEN: "test-only",
});
after(() => db.$disconnect());
test("contratos reais de persistência: isolamento, corrida de envio, cifragem, eventos, cancelamento e cursor", async () => {
  const org = await db.organizacao.create({
      data: { nome: "Saipos Test", slug: randomUUID() },
    }),
    other = await db.organizacao.create({
      data: { nome: "Outra", slug: randomUUID() },
    });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Matriz Test",
      codigo: "test-" + randomUUID(),
    },
  });
  const scope = { organizacaoId: org.id, unidadeId: unit.id };
  process.env.SAIPOS_OPERATIONS_UNIDADE_ID = unit.id;
  await assert.rejects(() =>
    reservar({ ...scope, organizacaoId: other.id }, "PEDIDO", "x", "x", {}),
  );
  const command = {
    acao: "criar" as const,
    pedido: {
      order_id: randomUUID(),
      display_id: "1",
      created_at: new Date().toISOString(),
      total_discount: 0,
      customer: { id: -1 as const, name: "Teste" },
      order_method: { mode: "TAKEOUT" as const },
      items: [
        {
          integration_code: "pdv-test",
          desc_item: "Pizza Teste",
          quantity: 1,
          unit_price: 30,
        },
      ],
    },
  };
  let sends = 0;
  const client = new PedidosSaipos((async (endpoint) => {
    if (String(endpoint).endsWith("/auth"))
      return Response.json({ token: "token-only-for-tests" });
    sends++;
    return Response.json({});
  }) as typeof fetch);
  const results = await Promise.all([
    enviarComando(scope, command, client),
    enviarComando(scope, command, client),
  ]);
  assert.equal(sends, 1);
  assert.equal(results[0].id, results[1].id);
  await assert.rejects(() =>
    enviarComando(
      scope,
      { ...command, pedido: { ...command.pedido, total_discount: 1 } },
      client,
    ),
  );
  const stored = await db.saiposOperacao.findUniqueOrThrow({
    where: { id: results[0].id },
  });
  assert.equal(stored.payloadCifrado.includes("Teste"), false);
  assert.ok(decifrar(stored.payloadCifrado, contextoCifra(scope)));
  await assert.rejects(() =>
    registrarEventoPedido(scope, {
      event: "CONCLUDED",
      cod_store: "outra",
      order_id: command.pedido.order_id,
    }),
  );
  await registrarEventoPedido(scope, {
    event: "CONCLUDED",
    cod_store: "test-store",
    order_id: command.pedido.order_id,
  });
  await registrarEventoPedido(scope, {
    event: "CONCLUDED",
    cod_store: "test-store",
    order_id: command.pedido.order_id,
  });
  assert.equal(
    await db.saiposOperacao.count({
      where: { unidadeId: unit.id, tipo: "EVENTO" },
    }),
    1,
  );

  const raw = {
    orderId: randomUUID(),
    orderDisplayId: "001",
    merchant: { id: "test-merchant", name: "Loja Teste" },
    customerName: "Cliente Teste",
    pickupAddress: { city: "Teste" },
    deliveryAddress: { city: "Teste" },
    totalOrderPrice: { value: 30, currency: "BRL" },
    payments: [],
  };
  const delivery = await receberEntrega(scope, raw),
    duplicate = await receberEntrega(scope, raw);
  assert.equal(delivery.deliveryId, duplicate.deliveryId);
  let tracks = 0;
  const track = {
    deliveryId: delivery.deliveryId,
    orderId: raw.orderId,
    orderDisplayId: raw.orderDisplayId,
    merchant: raw.merchant,
    event: { type: "ACCEPTED", datetime: new Date().toISOString() },
    vehicle: {},
    deliveryPrice: {},
    eta: {},
    deliveryPerson: {},
  };
  await enviarTracking(scope, track, (async () => {
    tracks++;
    await receberAvisoEntrega(scope, raw.orderId, "cancelar", {
      reason: "OTHER",
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch);
  assert.equal(tracks, 1);
  assert.equal(
    (
      await db.saiposOperacao.findUniqueOrThrow({
        where: { id: delivery.deliveryId },
      })
    ).estado,
    "CANCELLED",
  );
  await assert.rejects(() => enviarTracking(scope, track));

  const maiorLoja = await db.saiposVinculo.aggregate({
    _max: { lojaSaiposId: true },
  });
  const lojaSaiposId = (maiorLoja._max.lojaSaiposId ?? 900) + 1;
  const vinculo = await db.saiposVinculo.create({
    data: { organizacaoId: org.id, unidadeId: unit.id, lojaSaiposId },
  });
  await db.saiposVenda.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unit.id,
      vendaExternaId: "1",
      dataTurno: "2026-10-25",
      totalCentavos: 3000,
      cancelada: false,
      criadaNoSaiposEm: new Date(),
      alteradaNoSaiposEm: new Date(),
    },
  });
  const dataClient = new SaiposClient((async (endpoint) =>
    Response.json([
      {
        id_store: lojaSaiposId,
        id_sale: 1,
        updated_at: "2026-10-26T10:00:00",
        ...(String(endpoint).includes("sales_items")
          ? {
              items: [
                {
                  id_sale_item: 1,
                  id_store_item: 2,
                  desc_sale_item: "Pizza Test",
                  quantity: 1,
                  unit_price: 30,
                  deleted: "N",
                },
              ],
            }
          : {
              histories: [
                {
                  id_sale_status_history: 1,
                  order: 1,
                  created_at: "2026-10-26T10:00:00",
                  desc_store_sale_status: "Entregue",
                  user: { email: "privado@test.invalid" },
                },
              ],
            }),
      },
    ])) as typeof fetch);
  await sincronizarDetalhes(vinculo.id, dataClient);
  const updated = await db.saiposVinculo.findUniqueOrThrow({
    where: { id: vinculo.id },
  });
  assert.ok(updated.detalhesCursor);
  assert.equal(updated.detalhesErro, null);
  const sale = await db.saiposVenda.findFirstOrThrow({
    where: { unidadeId: unit.id },
  });
  assert.equal(sale.totalCentavos, 3000);
  assert.ok(sale.itensSaipos);
  assert.equal(JSON.stringify(sale.historicoSaipos).includes("privado"), false);
  await db.saiposVinculo.update({
    where: { id: vinculo.id },
    data: { detalhesTentativaEm: null },
  });
  await sincronizarDetalhes(
    vinculo.id,
    new SaiposClient((async () =>
      Response.json({ invalid: true })) as typeof fetch),
  );
  const failed = await db.saiposVinculo.findUniqueOrThrow({
    where: { id: vinculo.id },
  });
  assert.equal(failed.detalhesCursor, updated.detalhesCursor);
  assert.ok(failed.detalhesErro);
});
