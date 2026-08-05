import assert from "node:assert/strict";
import { test } from "node:test";

import {
  desistiu,
  INTERVALO_MS,
  MAX_POR_RODADA,
  proximaTentativa,
} from "./ritmo";

/**
 * O número da Severina é uma conta pessoal com mais de mil contatos dentro.
 * Disparar vinte mensagens em rajada é exatamente o padrão que faz a Meta
 * bloquear — e um bloqueio aqui derruba junto conversa de família.
 *
 * Estes testes existem menos para provar que a conta está certa e mais para
 * que ninguém "otimize" o envio um dia sem entender o que está protegendo.
 */

test("o teto por rodada é conservador", () => {
  assert.ok(MAX_POR_RODADA <= 12, "rajada é o que faz banir");
  assert.ok(MAX_POR_RODADA >= 1);
});

test("existe intervalo entre uma mensagem e outra", () => {
  assert.ok(INTERVALO_MS >= 3000, "sem respiro, parece robô");
});

/**
 * Falhou porque a Evolution caiu? Tentar de novo a cada minuto, sessenta vezes
 * seguidas, transforma uma indisponibilidade curta em tempestade de requisição
 * — e é o tipo de coisa que só se percebe pela conta de rede.
 */
test("a espera cresce a cada tentativa", () => {
  const base = new Date(2026, 7, 3, 7, 0);
  const primeira = proximaTentativa(1, base);
  const segunda = proximaTentativa(2, base);
  const terceira = proximaTentativa(3, base);

  assert.ok(primeira.getTime() > base.getTime());
  assert.ok(segunda.getTime() > primeira.getTime());
  assert.ok(terceira.getTime() > segunda.getTime());
});

/**
 * A primeira espera é curta de propósito: o caso comum é a Evolution
 * reiniciando, que volta em segundos. Esperar meia hora atrasaria a cobrança
 * do dia por um soluço de infraestrutura.
 */
test("a primeira tentativa volta rápido", () => {
  const base = new Date(2026, 7, 3, 7, 0);
  const espera = proximaTentativa(1, base).getTime() - base.getTime();
  assert.ok(espera <= 2 * 60_000, "soluço curto não pode atrasar o dia");
});

test("desiste depois de um número finito de tentativas", () => {
  assert.equal(desistiu(1), false);
  assert.equal(desistiu(4), false);
  assert.equal(desistiu(5), true);
  assert.equal(desistiu(50), true);
});
