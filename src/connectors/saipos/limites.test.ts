import test from "node:test";
import assert from "node:assert/strict";
import {
  ControleRequisicoesSaipos,
  INTERVALO_REQUISICOES_MS,
  LIMITE_REQUISICOES,
  JANELA_REQUISICOES_MS,
} from "./limites";
test("teto permite 8500 chamadas por minuto e barra a chamada 8501 na janela móvel", () => {
  const controle = new ControleRequisicoesSaipos();
  assert.equal(LIMITE_REQUISICOES, 8500);
  assert.equal(JANELA_REQUISICOES_MS, 60000);
  assert.equal(INTERVALO_REQUISICOES_MS, 7);
  for (let i = 0; i < LIMITE_REQUISICOES; i++) {
    const agora: number = i * INTERVALO_REQUISICOES_MS;
    assert.equal(controle.espera(agora), 0);
    controle.registrar(agora);
  }
  assert.equal(controle.espera(59999), 1);
  assert.equal(controle.espera(JANELA_REQUISICOES_MS), 0);
  controle.registrar(JANELA_REQUISICOES_MS);
  assert.equal(controle.espera(60001), 6);
});
test("429 bloqueia por pelo menos cinco minutos e respeita Retry-After maior", () => {
  const controle = new ControleRequisicoesSaipos();
  controle.bloquear(1000, "2");
  assert.equal(controle.bloqueada(300999), true);
  assert.equal(controle.bloqueada(301000), false);
  controle.bloquear(400000, "600");
  assert.equal(controle.bloqueada(999999), true);
  assert.equal(controle.bloqueada(1000000), false);
  const agora = Date.parse("2026-10-25T03:00:00Z");
  controle.bloquear(agora, "Sun, 25 Oct 2026 03:20:00 GMT");
  assert.equal(controle.bloqueada(agora + 1199999), true);
  assert.equal(controle.bloqueada(agora + 1200000), false);
});
