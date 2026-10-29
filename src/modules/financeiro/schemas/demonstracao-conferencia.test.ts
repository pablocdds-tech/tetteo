import assert from "node:assert/strict";
import { test } from "node:test";
import { demonstrarConferencia } from "./demonstracao-conferencia";

test("o exemplo usa a diferença de 625 centavos do motor real", () => {
  const { resultados, totais } = demonstrarConferencia("taxa");
  assert.equal(resultados[0].estado, "FEE_DIFFERENCE");
  assert.equal(resultados[0].diferencaTaxaCentavos, 625);
  assert.equal(totais.previstoCentavos, 121250);
  assert.equal(totais.creditadoCentavos, 120625);
});
test("a demonstração preserva a incerteza das fontes", () => {
  const parcial = demonstrarConferencia("parcial");
  assert.equal(parcial.cobertura.BANCO.completa, false);
  assert.notEqual(parcial.resultados[0].estado, "RECONCILED");
  assert.equal(
    demonstrarConferencia("semBanco").resultados[0].estado,
    "WAITING_BANK",
  );
  assert.equal(
    demonstrarConferencia("duplicado").resultados[0].estado,
    "AMBIGUOUS",
  );
});
test("o depósito agregado do exemplo é distribuído sem reutilizar crédito integral", () => {
  const { resultados, lotes, totais } = demonstrarConferencia("lote");
  assert.deepEqual(
    resultados.map((r) => r.creditoAlocadoCentavos),
    [120625, 48500],
  );
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].liquidoCentavos, 169125);
  assert.equal(totais.creditadoCentavos, 169125);
  assert.equal(resultados[1].estado, "RECONCILED");
  assert.deepEqual(
    demonstrarConferencia("taxa"),
    demonstrarConferencia("taxa"),
  );
});
