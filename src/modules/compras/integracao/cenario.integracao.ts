import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { pode } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

import { criarCenario, limparBanco } from "./cenario";

after(async () => {
  await db.$disconnect();
});

describe("o cenário de teste", () => {
  test("apaga e recria sem sobras", async () => {
    await limparBanco();
    await criarCenario();
    await limparBanco();
    const c = await criarCenario();

    assert.equal(await db.unidade.count(), 2);
    assert.equal(await db.fornecedor.count(), 3);

    const gerente = await c.ctx(c.gerenteCentro, c.centro);
    assert.equal(gerente.unidadeAtiva?.id, c.centro.id);
    assert.ok(pode(gerente, "compras.requisitar"));
    assert.ok(!pode(gerente, "compras.aprovar"));

    // O gerente do Centro não enxerga o Sul: o contexto nem é montado.
    await assert.rejects(() => c.ctx(c.gerenteCentro, c.sul));

    const diretor = await c.ctx(c.diretor, null);
    assert.ok(pode(diretor, "compras.aprovar"));
    assert.equal(diretor.unidadesVisiveis.length, 2);
  });
});
