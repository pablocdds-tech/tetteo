import assert from "node:assert/strict";
import test from "node:test";
import {
  acumularVenda,
  pagamentosLiquidos,
  totaisVazios,
} from "./resumo-caixa";

test("caixa soma pagamentos divididos e desconta troco uma única vez", () => {
  const pagamentos = [
    { forma: "DINHEIRO" as const, valorCentavos: 2000 },
    { forma: "PIX" as const, valorCentavos: 1500 },
    { forma: "DINHEIRO" as const, valorCentavos: 1000 },
  ];
  const liquido = pagamentosLiquidos(pagamentos, 500);
  assert.deepEqual(liquido, {
    DINHEIRO: 2500,
    PIX: 1500,
    CREDITO: 0,
    DEBITO: 0,
  });
  assert.equal(pagamentos[0].valorCentavos, 2000);
});

test("resumo reconcilia produtos, descontos, acréscimos e frete sem compartilhar estado", () => {
  const totais = totaisVazios();
  const outro = totaisVazios();
  acumularVenda(
    totais,
    {
      subtotalCentavos: 5000,
      descontoCentavos: 500,
      taxaCentavos: 100,
      freteCentavos: 400,
      totalCentavos: 5000,
    },
    pagamentosLiquidos(
      [
        { forma: "CREDITO", valorCentavos: 3000 },
        { forma: "DINHEIRO", valorCentavos: 5000 },
      ],
      3000,
    ),
  );
  acumularVenda(
    totais,
    {
      subtotalCentavos: 1000,
      descontoCentavos: 0,
      taxaCentavos: 0,
      freteCentavos: 0,
      totalCentavos: 1000,
    },
    pagamentosLiquidos([{ forma: "PIX", valorCentavos: 1000 }], 0),
  );
  assert.equal(totais.totalCentavos, 6000);
  assert.equal(
    Object.values(totais.pagamentos).reduce((a, b) => a + b, 0),
    totais.totalCentavos,
  );
  assert.equal(
    totais.subtotalCentavos -
      totais.descontoCentavos +
      totais.taxaCentavos +
      totais.freteCentavos,
    totais.totalCentavos,
  );
  assert.equal(outro.totalCentavos, 0);
  assert.equal(outro.pagamentos.DINHEIRO, 0);
});
