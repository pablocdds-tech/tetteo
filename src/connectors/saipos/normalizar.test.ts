import test from "node:test";
import assert from "node:assert/strict";
import { normalizarVenda } from "./normalizar";
import type { SaiposSale } from "./client";
const venda: SaiposSale = {
  id_store: 20437,
  id_sale: 123,
  total_amount: 64.44,
  canceled: "N",
  created_at: "2026-10-18T00:30:00",
  shift_date: "2026-10-17",
  updated_at: "2026-10-19T12:15:00",
};
test("turno após meia-noite continua no dia anterior; cancelamento conserva a chave", () => {
  const registro = normalizarVenda(venda, 20437);
  assert.equal(
    registro.criadaNoSaiposEm.toISOString(),
    "2026-10-18T03:30:00.000Z",
  );
  assert.equal(registro.dataTurno, "2026-10-17");
  assert.equal(registro.totalCentavos, 6444);
  const cancelada = normalizarVenda({ ...venda, canceled: "Y" }, 20437);
  assert.equal(cancelada.vendaExternaId, registro.vendaExternaId);
  assert.equal(cancelada.cancelada, true);
  assert.throws(() => normalizarVenda(venda, 999));
});
