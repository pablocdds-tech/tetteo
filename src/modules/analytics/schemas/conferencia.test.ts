import test from "node:test";
import assert from "node:assert/strict";
import {
  centavosInformados,
  conferirTotal,
  detalharCanais,
  referenciaSchema,
} from "./conferencia";
test("referência em reais é convertida exatamente e recusa formato ambíguo", () => {
  for (const v of ["10.457,38", "10457,38", "10457.38", "R$ 10.457,38"])
    assert.equal(centavosInformados(v), 1045738);
  assert.equal(centavosInformados("0,00"), 0);
  for (const v of [
    "-1",
    "1e3",
    "1.234",
    "1,234",
    "10.457,380",
    "",
    "21474836,48",
  ])
    assert.equal(centavosInformados(v), null);
  assert.equal(
    referenciaSchema.safeParse({
      de: "2026-02-30",
      ate: "2026-03-01",
      total: "10,00",
      versao: 0,
    }).success,
    false,
  );
});
test("igualdade em centavos não é confundida com ausência de cobertura ou referência", () => {
  assert.equal(conferirTotal(1045738, 1045738, false).estado, "bateu");
  assert.deepEqual(conferirTotal(1045737, 1045738, false), {
    estado: "divergente",
    diferenca: -1,
  });
  assert.equal(conferirTotal(1045738, 1045738, true).estado, "sem_cobertura");
  assert.equal(conferirTotal(0, null, false).estado, "sem_referencia");
  assert.equal(conferirTotal(0, 0, false).estado, "bateu");
  // Cancelamento tardio altera o total e reabre a divergência, sem estado verde persistido.
  assert.equal(
    conferirTotal(1045738 - 14400, 1045738, false).estado,
    "divergente",
  );
});
test("origem e modalidade são visões distintas; canceladas e origem ausente não são inventadas", () => {
  const linhas = [
    {
      origem: "iFood",
      modalidade: 1,
      canalImportado: true,
      cancelada: false,
      _count: { _all: 56 },
      _sum: { totalCentavos: 382792 },
    },
    {
      origem: "Cardápio Web",
      modalidade: 1,
      canalImportado: true,
      cancelada: false,
      _count: { _all: 37 },
      _sum: { totalCentavos: 298206 },
    },
    {
      origem: null,
      modalidade: 3,
      canalImportado: true,
      cancelada: false,
      _count: { _all: 40 },
      _sum: { totalCentavos: 364740 },
    },
    {
      origem: "Cardápio Web",
      modalidade: 2,
      canalImportado: true,
      cancelada: true,
      _count: { _all: 3 },
      _sum: { totalCentavos: 14400 },
    },
  ];
  const r = detalharCanais(linhas);
  for (const grupos of [r.origens, r.modalidades]) {
    assert.equal(
      grupos.reduce((s, g) => s + g.centavos, 0),
      1045738,
    );
    assert.equal(
      grupos.reduce((s, g) => s + g.quantidade, 0),
      133,
    );
    assert.equal(
      grupos.reduce((s, g) => s + g.canceladas, 0),
      3,
    );
  }
  assert.ok(r.origens.some((g) => g.nome === "Não informado"));
  assert.equal(
    r.origens.some((g) => g.nome === "Telefone"),
    false,
  );
  const antigo = detalharCanais([
    { ...linhas[0], canalImportado: false, origem: null, modalidade: null },
  ]);
  assert.equal(antigo.semDetalhamento, 56);
  assert.equal(antigo.origens[0].nome, "Histórico ainda sem detalhamento");
});
