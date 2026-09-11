import assert from "node:assert/strict";
import { test } from "node:test";

import { lerCentavos, reais } from "./dinheiro.mjs";

test("lê os jeitos brasileiros e o do Excel em inglês", () => {
  assert.equal(lerCentavos("1.234,56"), 123456);
  assert.equal(lerCentavos("1234,56"), 123456);
  assert.equal(lerCentavos("1234.56"), 123456);
  assert.equal(lerCentavos("R$ 1.234,5"), 123450);
  assert.equal(lerCentavos("1.234"), 123400);
  assert.equal(lerCentavos("80"), 8000);
  assert.equal(lerCentavos("-80.00"), -8000);
  assert.equal(lerCentavos("-R$ 50,00"), -5000);
});

test("recusa o que não é dinheiro", () => {
  for (const t of ["", "abc", "1,2,3", "12.345.6", "1.23.45", "12,345"]) {
    assert.equal(lerCentavos(t), null, t);
  }
});

test("formata em reais com espaço comum", () => {
  assert.equal(reais(482305), "R$ 4.823,05");
  assert.equal(reais(-5000), "-R$ 50,00");
  assert.equal(reais(0), "R$ 0,00");
});
