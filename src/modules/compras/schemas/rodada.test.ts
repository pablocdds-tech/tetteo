import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  aberturaDaSemana,
  ocorrenciaDaSemana,
  proximoEstado,
  transicaoPermitida,
} from "./rodada";

const SP = "America/Sao_Paulo";

describe("transições da rodada", () => {
  test("avança em ordem, sem motivo", () => {
    assert.deepEqual(transicaoPermitida("RASCUNHO", "COLETANDO"), {
      ok: true,
      exigeMotivo: false,
      reabertura: false,
    });
    assert.equal(proximoEstado("COTANDO"), "REVISAO");
    assert.equal(proximoEstado("FECHADA"), null);
  });

  test("não pula etapa", () => {
    assert.equal(transicaoPermitida("RASCUNHO", "COTANDO").ok, false);
  });

  test("reabrir exige motivo", () => {
    const r = transicaoPermitida("REVISAO", "COTANDO");
    assert.ok(r.ok && r.exigeMotivo && r.reabertura);
    const f = transicaoPermitida("FECHADA", "DESPACHANDO");
    assert.ok(f.ok && f.exigeMotivo);
  });

  test("cancelar exige motivo, e rodada fechada não se cancela", () => {
    const c = transicaoPermitida("COTANDO", "CANCELADA");
    assert.ok(c.ok && c.exigeMotivo);
    assert.equal(transicaoPermitida("FECHADA", "CANCELADA").ok, false);
  });

  test("ficar no mesmo estado não é transição", () => {
    assert.equal(transicaoPermitida("COTANDO", "COTANDO").ok, false);
  });
});

describe("a semana da rodada automática", () => {
  test("1º de janeiro de 2026 (quinta) é a semana 1", () => {
    assert.equal(
      ocorrenciaDaSemana(new Date("2026-01-01T12:00:00Z"), SP),
      "2026-W01",
    );
  });

  test("31 de dezembro de 2026 é a semana 53", () => {
    assert.equal(
      ocorrenciaDaSemana(new Date("2026-12-31T12:00:00Z"), SP),
      "2026-W53",
    );
  });

  test("domingo 23h30 em São Paulo ainda é a semana do domingo", () => {
    // Em UTC já é segunda (02h30) — e seria a semana seguinte.
    const domingoNoite = new Date("2026-09-14T02:30:00Z");
    assert.equal(ocorrenciaDaSemana(domingoNoite, SP), "2026-W37");
    assert.equal(ocorrenciaDaSemana(domingoNoite, "UTC"), "2026-W38");
  });

  test("a abertura de segunda às 07:00 cai no instante certo", () => {
    // Quinta, 10/09/2026 → a segunda da mesma semana é 07/09.
    const abertura = aberturaDaSemana(
      { diaDaSemana: 1, horaAbertura: "07:00" },
      new Date("2026-09-10T15:00:00Z"),
      SP,
    );
    assert.equal(abertura.toISOString(), "2026-09-07T10:00:00.000Z");
  });

  test("domingo é o último dia da semana ISO", () => {
    const abertura = aberturaDaSemana(
      { diaDaSemana: 0, horaAbertura: "20:00" },
      new Date("2026-09-10T15:00:00Z"),
      SP,
    );
    assert.equal(abertura.toISOString(), "2026-09-13T23:00:00.000Z");
  });
});
