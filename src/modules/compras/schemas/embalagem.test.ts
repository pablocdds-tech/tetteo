import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fatorDaEmbalagem, type Embalagem } from "./embalagem";

const caixa = (
  pecas: number,
  conteudo: bigint | null,
  unidadeConteudo: Embalagem["unidadeConteudo"],
  fracionavel = false,
): Embalagem => ({ pecas, conteudo, unidadeConteudo, fracionavel });

describe("fator da embalagem", () => {
  test("caixa 12 × 900 g num insumo em kg são 10,8 kg — não 12", () => {
    const r = fatorDaEmbalagem("KG", caixa(12, 9_000_000n, "G"));
    assert.ok(r.ok);
    assert.equal(r.fator, 108_000n);
    assert.equal(r.descricao, "12 × 900 g = 10,8 kg");
  });

  test("a mesma caixa num insumo contado em un são 12 peças", () => {
    const r = fatorDaEmbalagem("UN", caixa(12, 9_000_000n, "G"));
    assert.ok(r.ok);
    assert.equal(r.fator, 120_000n);
  });

  test("caixa com 100 un num insumo em un", () => {
    const r = fatorDaEmbalagem("UN", caixa(100, null, null));
    assert.ok(r.ok);
    assert.equal(r.fator, 1_000_000n);
  });

  test("10 pacotes × 50 un num insumo em un são 500", () => {
    const r = fatorDaEmbalagem("UN", caixa(10, 500_000n, "UN"));
    assert.ok(r.ok);
    assert.equal(r.fator, 5_000_000n);
  });

  test("caixa com 12, sem peso, num insumo em kg é desconhecido", () => {
    const r = fatorDaEmbalagem("KG", caixa(12, null, null));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "desconhecido");
  });

  test("12 × 1 un num insumo em kg também é desconhecido", () => {
    const r = fatorDaEmbalagem("KG", caixa(12, 10_000n, "UN"));
    assert.equal(!r.ok && r.motivo, "desconhecido");
  });

  test("fardo 6 × 2 L num insumo em kg é incompatível", () => {
    const r = fatorDaEmbalagem("KG", caixa(6, 20_000n, "L"));
    assert.equal(!r.ok && r.motivo, "incompativel");
  });

  test("fardo 6 × 2 L num insumo em L são 12 L", () => {
    const r = fatorDaEmbalagem("L", caixa(6, 20_000n, "L"));
    assert.ok(r.ok);
    assert.equal(r.fator, 120_000n);
  });

  test("saco de 25 kg num insumo em g são 25.000 g", () => {
    const r = fatorDaEmbalagem("G", caixa(1, 250_000n, "KG"));
    assert.ok(r.ok);
    assert.equal(r.fator, 250_000_000n);
    assert.equal(r.descricao, "25 kg = 25.000 g");
  });

  test("a granel vale uma unidade de estoque", () => {
    const r = fatorDaEmbalagem("KG", caixa(1, null, null, true));
    assert.ok(r.ok);
    assert.equal(r.fator, 10_000n);
    assert.equal(r.descricao, "a granel (kg) = 1 kg");
  });

  test("zero peças é inválido", () => {
    const r = fatorDaEmbalagem("KG", caixa(0, 9_000_000n, "G"));
    assert.equal(!r.ok && r.motivo, "invalido");
  });
});
