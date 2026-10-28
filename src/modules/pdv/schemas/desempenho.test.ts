import assert from "node:assert/strict";
import test from "node:test";
import { periodoDesempenho, resumirDesempenho } from "./desempenho";
import type { RegistroDesempenho } from "../desempenho-types";

test("desempenho usa dias de São Paulo, compara período equivalente e recusa consulta invertida ou excessiva", () => {
  const p = periodoDesempenho({ de: "2026-10-27", ate: "2026-10-28" });
  assert.equal(p.inicio.toISOString(), "2026-10-27T03:00:00.000Z");
  assert.equal(p.fim.toISOString(), "2026-10-29T03:00:00.000Z");
  assert.equal(p.anteriorDe, "2026-10-25");
  assert.equal(p.anteriorAte, "2026-10-26");
  assert.throws(() =>
    periodoDesempenho({ de: "2026-10-29", ate: "2026-10-28" }),
  );
  assert.throws(() =>
    periodoDesempenho({ de: "2026-01-01", ate: "2026-10-28" }),
  );
  assert.throws(() => periodoDesempenho({ de: "2026-02-30" }));
});
test("resumo distingue valor de pedido, pendência local e cancelamento sem perder a virada de dia", () => {
  const base: RegistroDesempenho = {
    criadoEm: "2026-10-27T23:00:00Z",
    totalCentavos: 1000,
    cancelado: false,
    pendente: false,
    modalidade: "RETIRADA",
    origem: "Tetteo",
    itens: [{ nome: "Pizza", quantidade: 2 }],
  };
  const p = periodoDesempenho({ de: "2026-10-27", ate: "2026-10-28" });
  const resultado = resumirDesempenho(
    [
      base,
      {
        ...base,
        criadoEm: "2026-10-28T02:59:59Z",
        origem: "Cardápio Web",
        totalCentavos: 2000,
      },
      {
        ...base,
        criadoEm: "2026-10-28T03:00:00Z",
        totalCentavos: 3000,
        pendente: true,
      },
      { ...base, totalCentavos: 9900, cancelado: true },
      { ...base, criadoEm: "2026-10-26T20:00:00Z", totalCentavos: 500 },
      { ...base, criadoEm: "2026-10-29T03:00:00Z", totalCentavos: 99999 },
    ],
    p,
  );
  assert.equal(resultado.atual.pedidos, 3);
  assert.equal(resultado.atual.valorCentavos, 6000);
  assert.equal(resultado.atual.ticketCentavos, 2000);
  assert.equal(resultado.atual.cancelados, 1);
  assert.equal(resultado.atual.valorCanceladoCentavos, 9900);
  assert.equal(resultado.atual.valorPendenteCentavos, 3000);
  assert.deepEqual(
    resultado.dias.map((d) => d.pedidos),
    [2, 1],
  );
  assert.equal(resultado.anterior.valorCentavos, 500);
  assert.deepEqual(resultado.produtos, [{ nome: "Pizza", quantidade: 6 }]);
  assert.equal(resultado.origens.length, 2);
  assert.equal(resumirDesempenho([], p).atual.ticketCentavos, null);
});

test("valores externos excessivos não geram totais financeiros arredondados silenciosamente", () => {
  const periodo = periodoDesempenho({ de: "2026-10-27", ate: "2026-10-28" });
  for (const cancelado of [true, false]) {
    const base: RegistroDesempenho = {
      criadoEm: "2026-10-27T23:00:00Z",
      totalCentavos: Number.MAX_SAFE_INTEGER,
      cancelado,
      pendente: false,
      modalidade: "ENTREGA",
      origem: "Cardápio Web",
      itens: [],
    };
    assert.throws(
      () => resumirDesempenho([base, { ...base, totalCentavos: 1 }], periodo),
      /excede o limite de cálculo/,
    );
  }
});
