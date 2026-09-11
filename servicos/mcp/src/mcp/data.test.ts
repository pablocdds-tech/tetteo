import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { esquemaData, hojeEmSaoPaulo } from "./data.js";

// 11/09/2026 às 01h UTC ainda é 10/09 em Brasília.
const agora = () => new Date("2026-09-11T01:00:00Z");
const esquema = esquemaData(agora);

describe("esquema da data", () => {
  it("usa o dia de Brasília, não o de Greenwich", () => {
    assert.equal(hojeEmSaoPaulo(agora()), "2026-09-10");
  });

  it("aceita hoje e dias passados", () => {
    assert.equal(esquema.parse("2026-09-10"), "2026-09-10");
    assert.equal(esquema.parse("2024-02-29"), "2024-02-29");
  });

  for (const [caso, valor] of [
    ["formato brasileiro", "10/09/2026"],
    ["dia que não existe", "2026-02-31"],
    ["29 de fevereiro fora de ano bissexto", "2026-02-29"],
    ["texto solto", "ontem"],
    ["data futura", "2026-09-11"],
    ["antes de 2020", "2019-12-31"],
  ] as const) {
    it(`recusa ${caso}`, () => {
      assert.equal(esquema.safeParse(valor).success, false);
    });
  }

  it("explica o formato esperado quando recusa", () => {
    const analise = esquema.safeParse("10/09/2026");
    assert.match(String(analise.error?.issues[0]?.message), /AAAA-MM-DD/);
  });
});
