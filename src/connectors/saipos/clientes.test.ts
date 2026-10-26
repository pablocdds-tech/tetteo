import test from "node:test";
import assert from "node:assert/strict";
import { clienteIdentificado } from "./clientes";
import { SaiposClient } from "./client";

test("cliente Saipos: identidade estável, mínimo de dados e vendas anônimas", () => {
  const raw = {
    id_customer: 123,
    name: "Pessoa fictícia",
    phone: "(11) 99999-1234",
    email: "pessoa@example.invalid",
    cpf_cnpj: "descartar",
    birth_date: "descartar",
  };
  assert.deepEqual(clienteIdentificado(raw), {
    externalId: "123",
    name: raw.name,
    phone: "5511999991234",
    email: raw.email,
  });
  assert.equal(
    clienteIdentificado({ ...raw, name: "Consumidor não identificado" }),
    null,
  );
  assert.equal(clienteIdentificado({ name: raw.name }), null);
  assert.equal(
    clienteIdentificado({ ...raw, phone: "0", email: "inválido" })?.phone,
    null,
  );
  assert.equal(clienteIdentificado({ ...raw, phone: null })?.externalId, "123");
});

test("clientes são opcionais e exclusivos da consulta CRM; paginação e loja são preservadas", async () => {
  const old = process.env.SAIPOS_TOKEN;
  process.env.SAIPOS_TOKEN = "synthetic-only";
  try {
    const offsets: number[] = [];
    const client = new SaiposClient((async (url: URL) => {
      const offset = Number(url.searchParams.get("p_offset"));
      offsets.push(offset);
      return new Response(
        JSON.stringify(
          Array.from({ length: offset === 0 ? 100 : 1 }, (_, i) => ({
            id_store: i === 1 ? 2 : 1,
            id_sale: offset + i,
            total_amount: 20,
            canceled: "N",
            shift_date: "2026-10-01",
            created_at: "2026-10-01T12:00:00",
            updated_at: "2026-10-01T12:00:00",
            customer:
              i === 2
                ? { unexpected: true }
                : {
                    id_customer: 5,
                    name: "Pessoa fictícia",
                    phone: null,
                    cpf_cnpj: "descartar",
                  },
          })),
        ),
      );
    }) as typeof fetch);
    const rows = await client.salesForCrm(
      {
        start: "2026-10-01T00:00:00",
        end: "2026-10-01T23:59:59",
        column: "shift_date",
      },
      1,
    );
    assert.deepEqual(offsets, [0, 100]);
    assert.equal(rows.length, 100);
    assert.equal(rows.find((s) => s.id_sale === 2)?.customer, null);
    assert.equal("cpf_cnpj" in rows[0].customer!, false);
  } finally {
    if (old === undefined) delete process.env.SAIPOS_TOKEN;
    else process.env.SAIPOS_TOKEN = old;
  }
});
