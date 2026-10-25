import test from "node:test";
import assert from "node:assert/strict";
import { deveRodar, diaDeslocado, horarioBrasilia } from "./tempo";
test("relógio diário usa Brasília, recupera horário perdido e não repete falha no mesmo dia", () => {
  assert.equal(
    horarioBrasilia(new Date("2026-10-25T02:30:00Z")),
    "2026-10-24T23:30:00",
  );
  assert.equal(deveRodar(new Date("2026-10-25T08:14:59Z"), null, false), false);
  assert.equal(deveRodar(new Date("2026-10-25T08:15:00Z"), null, false), true);
  assert.equal(
    deveRodar(
      new Date("2026-10-25T20:00:00Z"),
      new Date("2026-10-25T08:15:00Z"),
      false,
    ),
    false,
  );
  assert.equal(deveRodar(new Date("2026-10-25T02:00:00Z"), null, true), true);
  assert.equal(diaDeslocado("2026-03-01", -1), "2026-02-28");
});
