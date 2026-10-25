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

test("datas fora do calendário não mudam silenciosamente de turno", () => {
  assert.throws(() =>
    normalizarVenda({ ...venda, shift_date: "2026-02-30" }, 20437),
  );
  assert.throws(() =>
    normalizarVenda({ ...venda, created_at: "2026-02-30T20:00:00" }, 20437),
  );
  assert.throws(() =>
    normalizarVenda({ ...venda, updated_at: "2026-10-19T24:00:00" }, 20437),
  );
  assert.equal(
    normalizarVenda(
      { ...venda, updated_at: "2026-10-19T23:59:59.123456" },
      20437,
    ).dataTurno,
    "2026-10-17",
  );
});

test("origem usa o parceiro do pedido, nunca a marca ou o parceiro de entrega", () => {
  const r = normalizarVenda(
    { ...venda, id_sale_type: 1, partner_sale: { desc_partner_sale: "iFood" } },
    20437,
  );
  assert.equal(r.origem, "iFood");
  assert.equal(r.modalidade, 1);
  assert.equal(r.canalImportado, true);
  const direto = normalizarVenda(
    { ...venda, id_sale_type: 3, partner_sale: null },
    20437,
  );
  assert.equal(direto.origem, null);
  assert.equal(direto.canalImportado, true);
  assert.equal(normalizarVenda(venda, 20437).canalImportado, false);
});
