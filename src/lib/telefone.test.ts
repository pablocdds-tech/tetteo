import assert from "node:assert/strict";
import { test } from "node:test";

import { ehGrupo, normalizarTelefone, telefoneDoJid } from "./telefone";

/**
 * O mesmo número chega de cinco jeitos: digitado pelo dono no cadastro,
 * colado de uma planilha do sistema antigo, ou entregue pela Evolution.
 *
 * Se cada forma virar uma linha de vínculo, a Severina responde a um cadastro
 * e ignora o outro — e ninguém entende por quê, porque na tela os dois
 * parecem o mesmo telefone.
 */

test("aceita as formas que uma pessoa digita", () => {
  assert.equal(normalizarTelefone("84 98133-6549"), "5584981336549");
  assert.equal(normalizarTelefone("(84) 98133-6549"), "5584981336549");
  assert.equal(normalizarTelefone("+55 84 98133-6549"), "5584981336549");
  assert.equal(normalizarTelefone("5584981336549"), "5584981336549");
});

test("não inventa número a partir de lixo", () => {
  assert.equal(normalizarTelefone(""), null);
  assert.equal(normalizarTelefone("abc"), null);
  assert.equal(normalizarTelefone("123"), null);
});

/**
 * O NONO DÍGITO.
 *
 * O WhatsApp entrega celular brasileiro antigo com 12 dígitos (55 + DDD + 8),
 * e o cadastro tem 13. São a MESMA pessoa. Sem esta regra, a cobrança da
 * contagem simplesmente não chega em quem tem número anterior a 2016 — e o
 * sintoma seria "a Severina ignora o seu Zé", sem erro em lugar nenhum.
 */
test("completa o nono dígito de celular brasileiro", () => {
  assert.equal(normalizarTelefone("558481336549"), "5584981336549");
});

test("não mexe em fixo nem em número estrangeiro", () => {
  // Fixo de Natal: 55 + 84 + 8 dígitos começando por 3. Fixo não leva o 9.
  assert.equal(normalizarTelefone("558432116549"), "558432116549");
  // Portugal
  assert.equal(normalizarTelefone("+351912345678"), "351912345678");
});

test("extrai telefone de JID antigo e recusa LID", () => {
  assert.equal(telefoneDoJid("558481336549@s.whatsapp.net"), "5584981336549");
  assert.equal(telefoneDoJid("223170845999336@lid"), null);
  assert.equal(telefoneDoJid("120363@g.us"), null);
});

test("reconhece grupo", () => {
  assert.equal(ehGrupo("120363@g.us"), true);
  assert.equal(ehGrupo("558481336549@s.whatsapp.net"), false);
});
