import assert from "node:assert/strict";
import { test } from "node:test";

import { dentroDaJanela, deveDispararAgora } from "./gatilho";

/**
 * O relógio bate 1.440 vezes por dia. Cada erro aqui é uma mensagem repetida
 * sessenta vezes ou uma cobrança que nunca sai — e nenhuma das duas se
 * descobre lendo o código.
 *
 * Segunda-feira, 3 de agosto de 2026. Domingo, 2 de agosto.
 */
const seg = (hora: number, minuto = 0) => new Date(2026, 7, 3, hora, minuto);
const dom = (hora: number, minuto = 0) => new Date(2026, 7, 2, hora, minuto);

const seteDaManha = { horario: "07:00", diasDaSemana: [1, 2, 3, 4, 5] };

test("dispara quando a hora chega, num dia escolhido", () => {
  assert.equal(deveDispararAgora(seteDaManha, null, seg(7, 0)), true);
  assert.equal(deveDispararAgora(seteDaManha, null, seg(7, 3)), true);
});

test("não dispara antes da hora", () => {
  assert.equal(deveDispararAgora(seteDaManha, null, seg(6, 59)), false);
});

/**
 * Sem esta regra a equipe receberia a mesma cobrança sessenta vezes entre 7h e
 * 8h — e desligaria a Severina no primeiro dia. É o erro mais provável de
 * todos, porque só aparece quando o relógio já está no ar.
 */
test("não repete no mesmo dia depois de já ter disparado", () => {
  assert.equal(deveDispararAgora(seteDaManha, seg(7, 0), seg(7, 1)), false);
  assert.equal(deveDispararAgora(seteDaManha, seg(7, 0), seg(23, 0)), false);
});

test("volta a disparar no dia seguinte", () => {
  assert.equal(deveDispararAgora(seteDaManha, dom(7, 0), seg(7, 0)), true);
});

test("respeita os dias escolhidos", () => {
  assert.equal(deveDispararAgora(seteDaManha, null, dom(7, 0)), false);
});

/**
 * Agente criado às 10h com horário de 7h não pode cuspir a cobrança de hoje: o
 * horário já passou, e "bom dia, hora da contagem" às três da tarde é pior do
 * que silêncio.
 */
test("não dispara retroativo no mesmo dia", () => {
  assert.equal(deveDispararAgora(seteDaManha, null, seg(10, 0)), false);
});

test("lista de dias vazia significa todo dia", () => {
  const todoDia = { horario: "07:00", diasDaSemana: [] };
  assert.equal(deveDispararAgora(todoDia, null, dom(7, 0)), true);
});

test("horário mal formado não dispara nunca", () => {
  assert.equal(
    deveDispararAgora({ horario: "7h", diasDaSemana: [] }, null, seg(7, 0)),
    false,
  );
  assert.equal(
    deveDispararAgora({ horario: "25:00", diasDaSemana: [] }, null, seg(7, 0)),
    false,
  );
});

test("a janela de horário barra o que está fora dela", () => {
  const limites = { janelaInicio: "06:00", janelaFim: "22:00" };
  assert.equal(dentroDaJanela(limites, seg(7, 0)), true);
  assert.equal(dentroDaJanela(limites, seg(5, 59)), false);
  assert.equal(dentroDaJanela(limites, seg(22, 1)), false);
});

test("sem janela configurada, qualquer hora vale", () => {
  assert.equal(dentroDaJanela({}, seg(3, 0)), true);
});
