import test from "node:test";
import assert from "node:assert/strict";
import { deslocarDia, resumirHoras, variacao } from "./pulso";
test("horas usam Brasília, excluem canceladas e somam centavos", () => {
  const horas = resumirHoras([
    {
      criadaNoSaiposEm: new Date("2026-10-25T02:30:00Z"),
      totalCentavos: 1001,
      cancelada: false,
    },
    {
      criadaNoSaiposEm: new Date("2026-10-25T03:10:00Z"),
      totalCentavos: 2002,
      cancelada: false,
    },
    {
      criadaNoSaiposEm: new Date("2026-10-25T03:11:00Z"),
      totalCentavos: 99999,
      cancelada: true,
    },
  ]);
  assert.equal(horas[23].centavos, 1001);
  assert.equal(horas[0].centavos, 2002);
  assert.equal(horas[0].quantidade, 1);
  assert.equal(horas.length, 24);
  assert.equal(
    resumirHoras([]).reduce((s, h) => s + h.centavos, 0),
    0,
  );
});
test("comparação usa sete dias, atravessa mês e não inventa percentual com base zero", () => {
  assert.equal(deslocarDia("2026-11-01", -7), "2026-10-25");
  assert.equal(variacao(150, 100), 50);
  assert.equal(variacao(0, 100), -100);
  assert.equal(variacao(100, 0), null);
});
