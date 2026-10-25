import test from "node:test";
import assert from "node:assert/strict";
import { ControleRequisicoesSaipos } from "./limites";
import { SaiposClient, SaiposError, windows, revenue } from "./client";

test("janelas cobrem o período sem lacunas e respeitam 15 dias", () => {
  const result = windows({
    start: "2026-10-01T00:00:00",
    end: "2026-10-31T23:59:59",
    column: "updated_at",
  });
  assert.equal(result.length, 3);
  assert.equal(result[0].end, "2026-10-15T23:59:59");
  assert.equal(result[1].start, "2026-10-16T00:00:00");
  assert.equal(result[2].end, "2026-10-31T23:59:59");
  assert.throws(() =>
    windows({
      start: "2026-02-30T00:00:00",
      end: "2026-03-01T00:00:00",
      column: "shift_date",
    }),
  );
});

test("vendas deduplicam, isolam a loja e descartam dados pessoais; cursor só é proposto após sucesso", async () => {
  const old = process.env.SAIPOS_TOKEN;
  process.env.SAIPOS_TOKEN = "test-only";
  try {
    const sale = {
      id_store: 1,
      id_sale: 10,
      total_amount: 10.15,
      canceled: "N",
      shift_date: "2026-10-01",
      created_at: "2026-10-01T00:00:00",
      updated_at: "2026-10-01T00:00:00",
      customer: { name: "Dado privado" },
    };
    const urls: URL[] = [];
    const client = new SaiposClient((async (url: URL) => {
      urls.push(url);
      return new Response(
        JSON.stringify([
          sale,
          { ...sale, total_amount: 11.25, updated_at: "2026-10-02T00:00:00" },
          { ...sale, id_store: 2 },
        ]),
        { status: 200 },
      );
    }) as typeof fetch);
    const result = await client.incremental(
      { operation: "sales", storeId: 1, through: "2026-10-03T00:00:00" },
      "2026-10-04T00:00:00",
    );
    assert.equal(result.sales.length, 1);
    assert.equal(result.sales[0].total_amount, 11.25);
    assert.equal("customer" in result.sales[0], false);
    assert.equal(result.nextCursor.through, "2026-10-04T00:00:00");
    assert.equal(
      urls[0].searchParams.get("p_date_column_filter"),
      "updated_at",
    );
    assert.equal(
      revenue([
        ...result.sales,
        { ...result.sales[0], id_sale: 11, canceled: "Y" },
      ]).amount,
      "11.25",
    );
    const denied = new SaiposClient(
      (async () => new Response("{}", { status: 401 })) as typeof fetch,
    );
    await assert.rejects(
      () =>
        denied.incremental(
          { operation: "sales", storeId: 1, through: "2026-10-03T00:00:00" },
          "2026-10-04T00:00:00",
        ),
      (e: unknown) => e instanceof SaiposError && e.kind === "unauthorized",
    );
  } finally {
    if (old === undefined) delete process.env.SAIPOS_TOKEN;
    else process.env.SAIPOS_TOKEN = old;
  }
});

test("paginação percorre página cheia e encerra na última; 429 não repete", async () => {
  const old = process.env.SAIPOS_TOKEN;
  process.env.SAIPOS_TOKEN = "test-only";
  try {
    const offsets: number[] = [];
    const client = new SaiposClient((async (url: URL) => {
      const offset = Number(url.searchParams.get("p_offset"));
      offsets.push(offset);
      return new Response(
        JSON.stringify(
          Array.from({ length: offset === 0 ? 1000 : 1 }, (_, i) => ({
            id_store: 1,
            id_sale: offset + i,
            total_amount: 1,
            canceled: "N",
            shift_date: "2026-10-01",
            created_at: "2026-10-01T00:00:00",
            updated_at: "2026-10-01T00:00:00",
          })),
        ),
      );
    }) as typeof fetch);
    const period = {
      start: "2026-10-01T00:00:00",
      end: "2026-10-01T23:59:59",
      column: "shift_date" as const,
    };
    assert.equal((await client.sales(period, 1)).length, 1001);
    assert.deepEqual(offsets, [0, 1000]);
    let calls = 0;
    const limited = new SaiposClient(
      (async () => {
        calls++;
        return new Response("{}", { status: 429 });
      }) as typeof fetch,
      new ControleRequisicoesSaipos(),
    );
    await assert.rejects(
      () => limited.sales(period, 1),
      (e: unknown) => e instanceof SaiposError && e.kind === "rate_limit",
    );
    assert.equal(calls, 1);
    await assert.rejects(
      () => limited.sales(period, 1),
      (e: unknown) => e instanceof SaiposError && e.kind === "rate_limit",
    );
    assert.equal(calls, 1);
  } finally {
    if (old === undefined) delete process.env.SAIPOS_TOKEN;
    else process.env.SAIPOS_TOKEN = old;
  }
});

test("vendas aceitam null observado em página vazia e rejeitam objeto inesperado", async () => {
  const old = process.env.SAIPOS_TOKEN;
  process.env.SAIPOS_TOKEN = "test-only";
  try {
    const period = {
      start: "2026-10-25T00:00:00",
      end: "2026-10-25T00:06:39",
      column: "shift_date" as const,
    };
    const empty = new SaiposClient(
      (async () => new Response("null")) as typeof fetch,
    );
    assert.deepEqual(await empty.sales(period, 1), []);
    const invalid = new SaiposClient(
      (async () => new Response("{}")) as typeof fetch,
    );
    await assert.rejects(
      () => invalid.sales(period, 1),
      (e: unknown) => e instanceof SaiposError && e.kind === "format",
    );
  } finally {
    if (old === undefined) delete process.env.SAIPOS_TOKEN;
    else process.env.SAIPOS_TOKEN = old;
  }
});

test("financeiro limita tentativas temporárias, deduplica e separa seu cursor", async () => {
  const old = process.env.SAIPOS_TOKEN;
  process.env.SAIPOS_TOKEN = "test-only";
  try {
    let calls = 0;
    const record = {
      id_store: 1,
      id_store_fin_transaction: 2,
      amount: -10.25,
      paid: "Y",
      date: "2026-10-01",
      created_at: "2026-10-01T00:00:00",
      updated_at: "2026-10-01T00:00:00",
      notes: "privado",
      children: [{ id_store_fin_transaction: 99, amount: -10.25 }],
    };
    const client = new SaiposClient((async () => {
      calls++;
      return calls < 3
        ? new Response("{}", { status: 504 })
        : new Response(
            JSON.stringify([record, record, { ...record, id_store: 3 }]),
          );
    }) as typeof fetch);
    const result = await client.incrementalFinancial(
      { operation: "financial", storeId: 1, through: "2026-10-03T00:00:00" },
      "2026-10-04T00:00:00",
    );
    assert.equal(calls, 3);
    assert.equal(result.records.length, 1);
    assert.equal("notes" in result.records[0], false);
    assert.equal("children" in result.records[0], false);
    assert.equal(result.records[0].amount, -10.25);
    assert.equal(result.nextCursor.operation, "financial");
    calls = 0;
    const unavailable = new SaiposClient((async () => {
      calls++;
      return new Response("{}", { status: 503 });
    }) as typeof fetch);
    await assert.rejects(
      () =>
        unavailable.financial(
          {
            start: "2026-10-01T00:00:00",
            end: "2026-10-01T23:59:59",
            column: "date",
          },
          1,
        ),
      (e: unknown) => e instanceof SaiposError && e.kind === "temporary",
    );
    assert.equal(calls, 3);
  } finally {
    if (old === undefined) delete process.env.SAIPOS_TOKEN;
    else process.env.SAIPOS_TOKEN = old;
  }
});

test("financeiro vazio não comprova acesso; prova de acesso isola loja e recusa filtro incorreto", async () => {
  const old = process.env.SAIPOS_TOKEN;
  process.env.SAIPOS_TOKEN = "test-only";
  try {
    let calls = 0;
    const client = new SaiposClient((async () => {
      calls++;
      return new Response("null");
    }) as typeof fetch);
    const period = {
      start: "2000-01-01T00:00:00",
      end: "2000-01-01T23:59:59",
      column: "date" as const,
    };
    const result = await client.probeFinancial(period, 1);
    assert.equal(result.count, 0);
    assert.match(result.status, /não comprovadas/);
    await assert.rejects(
      () => client.probeFinancial({ ...period, column: "shift_date" }, 1),
      (e: unknown) => e instanceof SaiposError && e.kind === "period",
    );
    assert.equal(calls, 1);
    const invalid = new SaiposClient(
      (async () =>
        new Response(
          JSON.stringify([
            {
              id_store: 1,
              id_store_fin_transaction: 2,
              amount: 1,
              paid: "yes",
              date: "2026-10-17",
              created_at: "2026-10-17T00:00:00",
              updated_at: "2026-10-17T00:00:00",
            },
          ]),
        )) as typeof fetch,
    );
    await assert.rejects(
      () => invalid.financial(period, 1),
      (e: unknown) => e instanceof SaiposError && e.kind === "format",
    );
  } finally {
    if (old === undefined) delete process.env.SAIPOS_TOKEN;
    else process.env.SAIPOS_TOKEN = old;
  }
});
