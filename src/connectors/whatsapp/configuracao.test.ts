import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chavesDoWebhook,
  configuracaoEvolution,
  configuracaoWebhook,
} from "./configuracao";

/**
 * "Configuração pendente" é um estado que a tela precisa dizer em voz alta —
 * e dizer O QUE falta, pelo nome da variável. Nunca o valor: a tela é vista
 * por gente que não deve conhecer a chave, e o print dela vai parar em grupo.
 */

test("sem nada configurado, diz quais variáveis faltam", () => {
  const r = configuracaoEvolution({});
  assert.deepEqual(r, {
    tipo: "pendente",
    faltando: ["EVOLUTION_INSTANCIA", "EVOLUTION_API_KEY"],
  });
});

test("espaço em branco conta como vazio", () => {
  const r = configuracaoEvolution({
    EVOLUTION_INSTANCIA: "  ",
    EVOLUTION_API_KEY: "chave-ficticia",
  });
  assert.deepEqual(r, { tipo: "pendente", faltando: ["EVOLUTION_INSTANCIA"] });
});

test("a lista do que falta nunca carrega um valor", () => {
  const r = configuracaoEvolution({
    EVOLUTION_API_KEY: "valor-que-nao-pode-vazar",
  });
  assert.ok(!JSON.stringify(r).includes("valor-que-nao-pode-vazar"));
});

test("completa, usa a rede interna quando a URL não foi dada", () => {
  const r = configuracaoEvolution({
    EVOLUTION_INSTANCIA: "loja-ensaio",
    EVOLUTION_API_KEY: "chave-ficticia",
  });
  assert.deepEqual(r, {
    tipo: "ok",
    url: "http://evolution_api:8080",
    instancia: "loja-ensaio",
    chave: "chave-ficticia",
  });
});

test("tira a barra do fim da URL", () => {
  const r = configuracaoEvolution({
    EVOLUTION_URL: "http://evolution_api:8080/",
    EVOLUTION_INSTANCIA: "loja-ensaio",
    EVOLUTION_API_KEY: "chave-ficticia",
  });
  assert.equal(r.tipo === "ok" && r.url, "http://evolution_api:8080");
});

test("URL que não é http vira pendência, não uma chamada para o nada", () => {
  const r = configuracaoEvolution({
    EVOLUTION_URL: "ftp://evolution",
    EVOLUTION_INSTANCIA: "loja-ensaio",
    EVOLUTION_API_KEY: "chave-ficticia",
  });
  assert.deepEqual(r, { tipo: "pendente", faltando: ["EVOLUTION_URL"] });
});

/**
 * A senha do webhook assina o passe que prova que foi a Evolution quem
 * chamou. Curta, ela é adivinhável — e aí qualquer um "é" a Evolution.
 */
test("webhook sem endereço e sem senha é pendência", () => {
  assert.deepEqual(configuracaoWebhook({}), {
    tipo: "pendente",
    faltando: ["WHATSAPP_WEBHOOK_URL", "WHATSAPP_WEBHOOK_CHAVE"],
  });
});

test("senha curta demais conta como ausente", () => {
  const r = configuracaoWebhook({
    WHATSAPP_WEBHOOK_URL: "http://tetteo:3000/api/whatsapp/webhook",
    WHATSAPP_WEBHOOK_CHAVE: "curta",
  });
  assert.deepEqual(r, {
    tipo: "pendente",
    faltando: ["WHATSAPP_WEBHOOK_CHAVE"],
  });
  assert.deepEqual(chavesDoWebhook({ WHATSAPP_WEBHOOK_CHAVE: "curta" }), []);
});

test("durante a troca, aceita a senha atual e a anterior — a atual primeiro", () => {
  const env = {
    WHATSAPP_WEBHOOK_URL: "http://tetteo:3000/api/whatsapp/webhook",
    WHATSAPP_WEBHOOK_CHAVE: "senha-atual-ficticia-0001",
    WHATSAPP_WEBHOOK_CHAVE_ANTERIOR: "senha-antiga-ficticia-0001",
  };
  assert.deepEqual(chavesDoWebhook(env), [
    "senha-atual-ficticia-0001",
    "senha-antiga-ficticia-0001",
  ]);
  const r = configuracaoWebhook(env);
  assert.equal(r.tipo === "ok" && r.chave, "senha-atual-ficticia-0001");
});
