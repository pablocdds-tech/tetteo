import test from "node:test";
import assert from "node:assert/strict";
import { deveAtualizarPainel, diaDeslocado, horarioBrasilia } from "./tempo";
test("datas usam Brasília e atravessam a virada do mês", () => {
  assert.equal(
    horarioBrasilia(new Date("2026-10-25T02:30:00Z")),
    "2026-10-24T23:30:00",
  );
  assert.equal(diaDeslocado("2026-03-01", -1), "2026-02-28");
});

test("importação periódica espera 15 minutos e 30 após erro, sem repetir a cada tick", () => {
  const tentativa = new Date("2026-10-25T03:00:00Z");
  assert.equal(
    deveAtualizarPainel(new Date("2026-10-25T03:14:59Z"), tentativa, null),
    false,
  );
  assert.equal(
    deveAtualizarPainel(new Date("2026-10-25T03:15:00Z"), tentativa, null),
    true,
  );
  assert.equal(
    deveAtualizarPainel(new Date("2026-10-25T03:29:59Z"), tentativa, "Falha"),
    false,
  );
  assert.equal(
    deveAtualizarPainel(new Date("2026-10-25T03:30:00Z"), tentativa, "Falha"),
    true,
  );
  assert.equal(deveAtualizarPainel(tentativa, null, null), true);
});

test("falhas permanentes exigem intervenção e não criam repetição automática", () => {
  const tentativa = new Date("2026-10-25T03:00:00Z"),
    depois = new Date("2026-10-26T03:00:00Z");
  for (const erro of [
    "Token inválido ou acesso não autorizado pelo Saipos.",
    "Conta sem permissão para esta consulta.",
    "Formato de vendas mudou; revisão necessária, sem avançar cursor.",
  ])
    assert.equal(deveAtualizarPainel(depois, tentativa, erro), false);
});
