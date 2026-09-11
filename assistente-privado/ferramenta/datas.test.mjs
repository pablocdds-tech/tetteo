import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dataBr,
  diasDoPeriodo,
  diasEntre,
  hojeEmSaoPaulo,
  lerData,
  somarDias,
} from "./datas.mjs";

test("hoje é o dia de São Paulo, não o de Greenwich", () => {
  // 02:30 UTC de 12/09 ainda é 11/09 em São Paulo (UTC-3).
  assert.equal(hojeEmSaoPaulo(new Date("2026-09-12T02:30:00Z")), "2026-09-11");
  assert.equal(hojeEmSaoPaulo(new Date("2026-09-12T03:30:00Z")), "2026-09-12");
});

test("lê as duas formas de data e recusa dia que não existe", () => {
  assert.equal(lerData("11/09/2026"), "2026-09-11");
  assert.equal(lerData("2026-09-11"), "2026-09-11");
  assert.equal(lerData(" 01/02/2026 "), "2026-02-01");
  assert.equal(lerData("31/02/2026"), null);
  assert.equal(lerData("2026-13-01"), null);
  assert.equal(lerData("11-09-2026"), null);
  assert.equal(lerData(""), null);
  assert.equal(lerData(undefined), null);
});

test("conta dias sem tropeçar na virada de mês", () => {
  assert.equal(diasEntre("2026-08-30", "2026-09-02"), 3);
  assert.equal(diasEntre("2026-09-02", "2026-08-30"), -3);
  assert.equal(somarDias("2026-08-31", 1), "2026-09-01");
  assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(diasDoPeriodo("2026-08-30", "2026-09-01"), [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
  ]);
  assert.equal(dataBr("2026-09-01"), "01/09/2026");
});
