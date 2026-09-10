import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sugerirCompra, type EntradaDaSugestao } from "./sugestao";

const agora = new Date("2026-09-10T12:00:00Z");
const base: EntradaDaSugestao = {
  minimo: 15000n,
  disponivel: 3500n,
  emPedidoAberto: 5000n,
  ultimaAtualizacao: new Date("2026-09-09T12:00:00Z"),
  agora,
  unidade: "KG",
};

describe("sugestão de compra", () => {
  test("mínimo – disponível – em pedido, com a conta escrita", () => {
    const s = sugerirCompra(base);
    assert.equal(s.quantidade, 6500n);
    assert.equal(
      s.formula,
      "mínimo 15 kg – disponível 3,5 kg – em pedido 5 kg = 6,5 kg",
    );
    assert.deepEqual(s.alertas, []);
  });

  test("sem pedido em aberto, a parcela some da conta", () => {
    const s = sugerirCompra({ ...base, emPedidoAberto: 0n });
    assert.equal(s.formula, "mínimo 15 kg – disponível 3,5 kg = 11,5 kg");
  });

  test("sem mínimo cadastrado não sugere — e diz por quê", () => {
    const s = sugerirCompra({ ...base, minimo: null });
    assert.equal(s.quantidade, null);
    assert.match(s.alertas.join(" "), /Sem estoque mínimo/);
  });

  test("nunca contado não é zero", () => {
    const s = sugerirCompra({ ...base, disponivel: null });
    assert.equal(s.quantidade, null);
    assert.match(s.alertas.join(" "), /desconhecido, não zero/);
  });

  test("saldo velho sugere, mas alerta", () => {
    const s = sugerirCompra({
      ...base,
      ultimaAtualizacao: new Date("2026-08-29T12:00:00Z"),
    });
    assert.equal(s.quantidade, 6500n);
    assert.match(s.alertas.join(" "), /Saldo de 12 dias atrás/);
  });

  test("conta negativa não vira compra", () => {
    const s = sugerirCompra({ ...base, disponivel: 17000n, emPedidoAberto: 0n });
    assert.equal(s.quantidade, null);
    assert.match(s.formula ?? "", /não precisa \(sobram 2 kg\)/);
  });

  test("conta zerada também não vira compra — nunca 0", () => {
    const s = sugerirCompra({ ...base, disponivel: 15000n, emPedidoAberto: 0n });
    assert.equal(s.quantidade, null);
  });
});
