import test from "node:test";
import assert from "node:assert/strict";
import { escopoVendas, periodoVendas, resumirDias } from "./vendas";

test("unidade forjada ou lista vazia não vira consulta global", () => {
  const base = {
    organizacao: { id: "organizacao-a" },
    unidadeAtiva: null,
    unidadesVisiveis: [],
    podeVerRedeInteira: false,
  };
  assert.deepEqual(escopoVendas(base), {
    organizacaoId: "organizacao-a",
    unidadeId: { in: [] },
  });
  assert.deepEqual(
    escopoVendas({
      ...base,
      unidadeAtiva: { id: "loja-b" },
      unidadesVisiveis: [{ id: "loja-a" }],
    }).unidadeId.in,
    [],
  );
  assert.deepEqual(
    escopoVendas({
      ...base,
      unidadeAtiva: { id: "loja-a" },
      unidadesVisiveis: [{ id: "loja-a" }],
    }).unidadeId.in,
    ["loja-a"],
  );
});
test("cancelamento sai do faturamento e valores são somados em centavos", () => {
  const resumo = resumirDias([
    {
      dataTurno: "2026-10-17",
      cancelada: false,
      _count: { _all: 2 },
      _sum: { totalCentavos: 30 },
    },
    {
      dataTurno: "2026-10-17",
      cancelada: true,
      _count: { _all: 1 },
      _sum: { totalCentavos: 10000 },
    },
  ]);
  assert.equal(resumo.centavos, 30);
  assert.equal(resumo.quantidade, 2);
  assert.equal(resumo.canceladas, 1);
  assert.throws(() => periodoVendas("2026-02-30", "2026-03-01"));
  assert.throws(() => periodoVendas("2026-14-01", "2026-14-02"));
});
