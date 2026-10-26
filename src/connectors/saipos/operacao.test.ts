import test from "node:test";
import assert from "node:assert/strict";
import {
  assinatura,
  cifrar,
  decifrar,
  emitirToken,
  validarToken,
  lerCorpo,
} from "./operacao-seguranca";
import { configOperacao } from "./operacao-config";
import { comandoPedido, PedidosSaipos, FalhaPedidos } from "./pedidos";
import { SaiposClient } from "./client";
import {
  produtosVendidos,
  itensVendaSaipos,
  historicosVendaSaipos,
} from "./detalhes";

test("payload cifrado fica vinculado à unidade e tokens não cruzam merchants/ambientes", () => {
  const old = process.env.SAIPOS_OPERATIONS_KEY;
  process.env.SAIPOS_OPERATIONS_KEY = "ab".repeat(32);
  try {
    const encrypted = cifrar({ phone: "privado" }, "org:loja1");
    assert.equal(encrypted.includes("privado"), false);
    assert.deepEqual(decifrar(encrypted, "org:loja1"), { phone: "privado" });
    assert.throws(() => decifrar(encrypted, "org:loja2"));
    const token = emitirToken("merchant:homologacao", "secret", 100000);
    assert.ok(validarToken(token, "merchant:homologacao", "secret", 101000));
    assert.equal(
      validarToken(token, "merchant:producao", "secret", 101000),
      false,
    );
    assert.equal(validarToken(token, "outro", "secret", 101000), false);
    assert.equal(
      validarToken(token, "merchant:homologacao", "secret", 4000000),
      false,
    );
    assert.equal(
      validarToken(token + "x", "merchant:homologacao", "secret", 101000),
      false,
    );
    assert.notEqual(
      assinatura('{"a":1,"b":2}', "key"),
      assinatura('{ "b":2,"a":1}', "key"),
    );
  } finally {
    if (old === undefined) delete process.env.SAIPOS_OPERATIONS_KEY;
    else process.env.SAIPOS_OPERATIONS_KEY = old;
  }
});
test("corpo sem content-length também é limitado", async () => {
  await assert.rejects(() =>
    lerCorpo(
      new Request("https://example.test", {
        method: "POST",
        body: "x".repeat(100),
      }),
      10,
    ),
  );
});

test("contrato observado aceita código PDV numérico e agregação null sem aceitar item malformado", () => {
  const envelope = {
    id_store: 1,
    id_sale: 2,
    updated_at: "2026-10-26T10:00:00",
  };
  assert.deepEqual(
    itensVendaSaipos.parse({ ...envelope, items: null }).items,
    [],
  );
  assert.deepEqual(
    historicosVendaSaipos.parse({ ...envelope, histories: null }).histories,
    [],
  );
  const item = {
    id_sale_item: 3,
    desc_sale_item: "Produto de teste",
    integration_code: 456,
    quantity: 1,
    unit_price: 12.5,
    deleted: "N",
  };
  assert.equal(
    itensVendaSaipos.parse({ ...envelope, items: [item] }).items[0]
      .integration_code,
    "456",
  );
  assert.throws(() => itensVendaSaipos.parse(envelope));
  assert.throws(() =>
    itensVendaSaipos.parse({
      ...envelope,
      items: [{ ...item, unit_price: "12.5" }],
    }),
  );
  assert.throws(() =>
    itensVendaSaipos.parse({ ...envelope, items: { invalid: true } }),
  );
});
test("pedido não pode carregar loja ou campos arbitrários e exige endereço delivery", () => {
  const base = {
    acao: "criar",
    pedido: {
      order_id: "test",
      display_id: "001",
      cod_store: "outra-loja",
      created_at: "2026-10-26T12:00:00Z",
      total_discount: 0,
      customer: { id: -1, name: "Anônimo" },
      order_method: { mode: "TAKEOUT" },
      items: [
        {
          integration_code: "PDV",
          desc_item: "Pizza",
          quantity: 1,
          unit_price: 20,
        },
      ],
    },
  };
  const parsed = comandoPedido.parse(base);
  assert.ok(parsed.acao === "criar");
  assert.equal("cod_store" in parsed.pedido, false);
  assert.throws(() =>
    comandoPedido.parse({
      ...base,
      pedido: { ...base.pedido, order_method: { mode: "DELIVERY" } },
    }),
  );
});
test("pedidos reutilizam token, sobrescrevem cod_store no servidor e não repetem timeout", async () => {
  const names = [
    "SAIPOS_OPERATIONS_KEY",
    "SAIPOS_OPERATIONS_UNIDADE_ID",
    "SAIPOS_ORDER_ENABLED",
    "SAIPOS_ORDER_SECRET",
    "SAIPOS_ORDER_PARTNER_ID",
    "SAIPOS_ORDER_STORE_CODE",
    "SAIPOS_OPERATIONS_ENVIRONMENT",
  ];
  const old = names.map((n) => process.env[n]);
  Object.assign(process.env, {
    SAIPOS_OPERATIONS_KEY: "ab".repeat(32),
    SAIPOS_OPERATIONS_UNIDADE_ID: "loja",
    SAIPOS_ORDER_ENABLED: "true",
    SAIPOS_ORDER_SECRET: "secret-test",
    SAIPOS_ORDER_PARTNER_ID: "partner-test",
    SAIPOS_ORDER_STORE_CODE: "autorizada",
    SAIPOS_OPERATIONS_ENVIRONMENT: "homologacao",
  });
  try {
    let auth = 0,
      sends = 0;
    const client = new PedidosSaipos((async (url, options) => {
      if (String(url).endsWith("/auth")) {
        auth++;
        return Response.json({ token: "token-only-for-tests" });
      }
      sends++;
      assert.equal(JSON.parse(String(options?.body)).cod_store, "autorizada");
      throw new Error("network timeout");
    }) as typeof fetch);
    await assert.rejects(
      () => client.executar({ acao: "cancelar", order_id: "123" }),
      (e: unknown) => e instanceof FalhaPedidos && e.incerta,
    );
    await assert.rejects(() =>
      client.executar({ acao: "cancelar", order_id: "456" }),
    );
    assert.equal(auth, 1);
    assert.equal(sends, 2);
    process.env.SAIPOS_OPERATIONS_ENVIRONMENT = "producao";
    assert.throws(() => configOperacao("pedidos"), /homologação/);
  } finally {
    names.forEach((n, i) => {
      if (old[i] === undefined) delete process.env[n];
      else process.env[n] = old[i];
    });
  }
});
test("detalhes filtram loja e descartam usuários/observações privados; produtos não duplicam adicionais", async () => {
  const old = process.env.SAIPOS_TOKEN;
  process.env.SAIPOS_TOKEN = "test-only";
  const item = {
    id_sale_item: 1,
    id_store_item: 3,
    desc_sale_item: "Pizza",
    quantity: 2,
    unit_price: 30,
    deleted: "N",
    notes: "dado privado",
    choices: [
      {
        id_sale_item_choice: 1,
        desc_sale_item_choice: "Borda",
        aditional_price: 5,
        deleted: "N",
      },
    ],
  };
  try {
    const client = new SaiposClient((async () =>
      Response.json([
        {
          id_store: 1,
          id_sale: 2,
          updated_at: "2026-10-26T10:00:00",
          items: [item],
        },
        {
          id_store: 2,
          id_sale: 3,
          updated_at: "2026-10-26T10:00:00",
          items: [item],
        },
      ])) as typeof fetch);
    const rows = await client.items(
      {
        column: "updated_at",
        start: "2026-10-26T00:00:00",
        end: "2026-10-26T23:59:59",
      },
      1,
    );
    assert.equal(rows.length, 1);
    assert.equal("notes" in rows[0].items[0], false);
    const products = produtosVendidos([
      {
        cancelada: false,
        itensSaipos: [
          item,
          { ...item, id_sale_item: 2, deleted: "Y" },
          { ...item, id_sale_item: 3, id_sale_to: 99 },
        ],
      },
      { cancelada: true, itensSaipos: [item] },
    ]);
    assert.equal(products[0].centavos, 6000);
    assert.equal(products[0].quantidade, 2);
  } finally {
    if (old === undefined) delete process.env.SAIPOS_TOKEN;
    else process.env.SAIPOS_TOKEN = old;
  }
});
