import assert from "node:assert/strict";
import { test } from "node:test";

import { provedorPara } from "./index";

/**
 * QUEM FALA POR UMA CONEXÃO — e o que ele diz quando não pode falar.
 *
 * A tela mostra o motivo que sai daqui. "Falta configurar" só vale quando
 * falta mesmo; um nome que não bate é outro problema, com outra solução, e
 * precisa de outra frase.
 */

const conexao = { provedor: "EVOLUTION_BAILEYS" as const, nome: "severina" };

test("sem as variáveis, é pendente — pelo nome do que falta", async () => {
  const r = await provedorPara(conexao, {}).consultarConexao();
  assert.deepEqual(r, {
    tipo: "pendente",
    faltando: ["EVOLUTION_INSTANCIA", "EVOLUTION_API_KEY"],
  });
});

test("nome da instância diferente do cadastro é um ERRO que diz os dois nomes", async () => {
  const r = await provedorPara(conexao, {
    EVOLUTION_INSTANCIA: "loja-real",
    EVOLUTION_API_KEY: "chave-ficticia-0001",
  }).consultarConexao();
  assert.equal(r.tipo, "erro");
  if (r.tipo !== "erro") return;
  assert.match(r.motivo, /"loja-real"/);
  assert.match(r.motivo, /"severina"/);
  assert.ok(!r.motivo.includes("chave-ficticia-0001"));
});

test("o simulado é recusado em produção", async () => {
  const r = await provedorPara(
    { provedor: "SIMULADO", nome: "loja-ensaio" },
    { NODE_ENV: "production" },
  ).consultarConexao();
  assert.equal(r.tipo, "erro");
});
