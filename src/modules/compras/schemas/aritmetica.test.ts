import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NumeroInvalido,
  centavosDigitados,
  centavosDoBanco,
  dividirArredondando,
  embalagensNecessarias,
  fatorDigitado,
  milesimosDigitados,
  numeroBrDe,
  paraDecimal,
  precoPorUnidade,
  quantidadeBr,
  quantidadeDeEmbalagens,
  reais,
  reaisPorUnidade,
  totalFracionado,
  totalPorEmbalagens,
} from "./aritmetica";

describe("leitura", () => {
  test("o que a pessoa digita, do jeito brasileiro", () => {
    assert.equal(centavosDigitados("12,50"), 1250n);
    assert.equal(centavosDigitados("1.234,56"), 123456n);
    assert.equal(centavosDigitados("R$ 300"), 30000n);
    assert.equal(centavosDigitados("12.5"), 1250n);
    assert.equal(milesimosDigitados("6,5"), 6500n);
    assert.equal(fatorDigitado("10,8"), 108000n);
    assert.equal(centavosDigitados(""), null);
  });

  test("ponto com três casas é ambíguo e é recusado", () => {
    assert.throws(() => centavosDigitados("1.200"), NumeroInvalido);
  });

  test("casas a mais são recusadas, não arredondadas", () => {
    assert.throws(
      () => centavosDigitados("12,555"),
      (e: NumeroInvalido) => e.motivo === "casas",
    );
    assert.equal(centavosDigitados("12,500"), 1250n);
  });

  test("negativo é recusado", () => {
    assert.throws(
      () => centavosDigitados("-5"),
      (e: NumeroInvalido) => e.motivo === "negativo",
    );
  });

  test("o banco escreve com ponto decimal, inclusive com três casas", () => {
    assert.equal(centavosDoBanco("1.234"), 123n);
    assert.equal(centavosDoBanco(0.1 + 0.2), 30n);
    assert.equal(centavosDoBanco("300"), 30000n);
  });

  test("e volta para o banco com ponto", () => {
    assert.equal(paraDecimal(1250n, 2), "12.50");
    assert.equal(paraDecimal(5n, 3), "0.005");
    assert.equal(paraDecimal(-1250n, 2), "-12.50");
  });
});

describe("arredondamento", () => {
  test("meio para cima, uma vez", () => {
    assert.equal(dividirArredondando(5n, 10n), 1n);
    assert.equal(dividirArredondando(4n, 10n), 0n);
    assert.equal(dividirArredondando(-5n, 10n), -1n);
  });

  test("granel: 6,537 kg × R$ 31,90 = R$ 208,53", () => {
    assert.equal(totalFracionado(6537n, 3190n, 10000n), 20853n);
  });

  test("granel: R$ 0,005 vira R$ 0,01", () => {
    assert.equal(totalFracionado(5n, 100n, 10000n), 1n);
  });

  test("embalagem inteira é exata", () => {
    assert.equal(totalPorEmbalagens(2n, 30000n), 60000n);
  });
});

describe("embalagens", () => {
  test("20 kg em caixas de 10,8 kg são 2 caixas, que trazem 21,6 kg", () => {
    assert.equal(embalagensNecessarias(20000n, 108000n), 2n);
    assert.equal(quantidadeDeEmbalagens(2n, 108000n), 21600n);
  });

  test("10,8 kg cabem numa caixa só", () => {
    assert.equal(embalagensNecessarias(10800n, 108000n), 1n);
  });

  test("nada a comprar, nenhuma embalagem", () => {
    assert.equal(embalagensNecessarias(0n, 108000n), 0n);
  });

  test("caixa de 10 kg por R$ 300 é R$ 30,00 o quilo", () => {
    assert.equal(precoPorUnidade(30000n, 100000n), 30_000_000n);
  });
});

describe("formatação", () => {
  test("dinheiro e quantidade no jeito brasileiro", () => {
    assert.equal(reais(123456n), "R$ 1.234,56");
    assert.equal(reais(-500n), "R$ -5,00");
    assert.equal(quantidadeBr(10800n, "KG"), "10,8 kg");
    assert.equal(quantidadeBr(1234000n, "UN"), "1.234 un");
    assert.equal(numeroBrDe(108000n, 4), "10,8");
  });

  test("preço por unidade com 2 casas, ou 4 quando é de centavos", () => {
    assert.equal(reaisPorUnidade(30_000_000n, "KG"), "R$ 30,00/kg");
    assert.equal(reaisPorUnidade(12_345n, "UN"), "R$ 0,0123/un");
  });
});
