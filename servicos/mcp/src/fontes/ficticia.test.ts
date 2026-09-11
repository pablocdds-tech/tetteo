import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criarFonteFicticia, pedidosFicticios } from "./ficticia.js";

const consulta = { unidadeId: "uni_centro", data: "2026-09-10" };

describe("fonte fictícia", () => {
  it("gera sempre os mesmos pedidos para a mesma loja e data", () => {
    assert.deepEqual(pedidosFicticios(consulta), pedidosFicticios(consulta));
  });

  it("muda quando muda a data ou a loja", () => {
    const base = JSON.stringify(pedidosFicticios(consulta));
    assert.notEqual(
      JSON.stringify(pedidosFicticios({ ...consulta, data: "2026-09-09" })),
      base,
    );
    assert.notEqual(
      JSON.stringify(pedidosFicticios({ ...consulta, unidadeId: "uni_sul" })),
      base,
    );
  });

  it("gera quantidades e valores plausíveis", () => {
    const pedidos = pedidosFicticios(consulta);
    assert.ok(pedidos.length >= 45 && pedidos.length < 140);
    for (const pedido of pedidos) {
      assert.ok(Number.isInteger(pedido.valorCentavos));
      assert.ok(pedido.valorCentavos >= 3500 && pedido.valorCentavos < 16000);
    }
  });

  it("devolve a soma exata dos pedidos", async () => {
    const fonte = criarFonteFicticia();
    const pedidos = pedidosFicticios(consulta);
    const resumo = await fonte.vendasDoDia(
      consulta,
      new AbortController().signal,
    );

    assert.equal(resumo.quantidade, pedidos.length);
    assert.equal(
      resumo.totalCentavos,
      pedidos.reduce((soma, pedido) => soma + pedido.valorCentavos, 0),
    );
    assert.equal(fonte.ehFicticia, true);
    assert.equal(fonte.nome, "ficticia");
  });

  it("respeita o cancelamento", async () => {
    const controle = new AbortController();
    controle.abort();
    await assert.rejects(
      criarFonteFicticia().vendasDoDia(consulta, controle.signal),
    );
  });
});
