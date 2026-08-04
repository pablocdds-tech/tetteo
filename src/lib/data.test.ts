import assert from "node:assert/strict";
import { test } from "node:test";

import { agoraParaCampo, hojeParaCampo, lerDataLocal } from "./data";

/**
 * Este arquivo existe por causa de um bug real: a nota digitada em 4 de agosto
 * aparecia na lista como 3 de agosto. `new Date("2026-08-04")` é meia-noite em
 * UTC, que no Brasil ainda é o dia anterior — e um dia de diferença joga a
 * compra para outro período de CMV sem ninguém perceber.
 */

test("data pura é lida no fuso local, não em UTC", () => {
  const d = lerDataLocal("2026-08-04")!;
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 4);
  assert.equal(d.getHours(), 0);
});

test("primeiro dia do ano não escorrega para o ano anterior", () => {
  const d = lerDataLocal("2026-01-01")!;
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 1);
});

test("data com horário continua sendo lida como local", () => {
  const d = lerDataLocal("2026-08-04T07:30")!;
  assert.equal(d.getDate(), 4);
  assert.equal(d.getHours(), 7);
  assert.equal(d.getMinutes(), 30);
});

test("vazio e lixo devolvem nulo, sem inventar data", () => {
  assert.equal(lerDataLocal(""), null);
  assert.equal(lerDataLocal("   "), null);
  assert.equal(lerDataLocal("ontem"), null);
});

test("ida e volta fecha: o que sai para o campo volta como o mesmo dia", () => {
  const agora = new Date(2026, 7, 4, 23, 45);
  const noCampo = hojeParaCampo(agora);
  assert.equal(noCampo, "2026-08-04");
  assert.equal(lerDataLocal(noCampo)!.getDate(), 4);
});

test("agoraParaCampo preserva a hora local, não a de Londres", () => {
  const agora = new Date(2026, 7, 4, 14, 9);
  assert.equal(agoraParaCampo(agora), "2026-08-04T14:09");
});
