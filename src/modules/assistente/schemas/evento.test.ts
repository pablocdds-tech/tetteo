import assert from "node:assert/strict";
import { test } from "node:test";

import { resumoDoEvento } from "./evento";

/**
 * O RESUMO É O QUE VAI PARA O BANCO — e para o painel de saúde que o gerente
 * abre. O número é pessoal: nenhum resumo carrega telefone inteiro, texto de
 * mensagem ou identificador de contato.
 */

test("conexão: guarda só os quatro últimos do número", () => {
  const resumo = resumoDoEvento({
    tipo: "connection.update",
    idExterno: "conexao:abc",
    estado: "open",
    codigo: 200,
    numero: "5511900000001",
  });
  assert.deepEqual(resumo, {
    estado: "open",
    codigo: 200,
    numeroFinal: "0001",
  });
  assert.ok(!JSON.stringify(resumo).includes("5511900000001"));
});

test("status: id da mensagem, status e se é nossa", () => {
  assert.deepEqual(
    resumoDoEvento({
      tipo: "messages.update",
      idExterno: "status:3EB0X:READ",
      idMensagem: "3EB0X",
      status: "READ",
      deMim: true,
    }),
    { idMensagem: "3EB0X", status: "READ", deMim: true },
  );
});

test("envio: o hash do texto, nunca o texto", () => {
  const resumo = resumoDoEvento({
    tipo: "send.message",
    idExterno: "envio:3EB0Y",
    idMensagem: "3EB0Y",
    hashTexto: "a".repeat(64),
    enviadaEm: new Date("2026-09-10T23:00:00Z"),
  });
  assert.deepEqual(resumo, {
    idMensagem: "3EB0Y",
    hashTexto: "a".repeat(64),
    enviadaEm: "2026-09-10T23:00:00.000Z",
  });
});

test("entrada: sem remetente, sem texto — só o que decide ignorar", () => {
  const resumo = resumoDoEvento({
    tipo: "messages.upsert",
    idExterno: "entrada:3EB0Z",
    idMensagem: "3EB0Z",
    deMim: false,
    grupo: false,
    vinculoId: null,
  });
  assert.deepEqual(resumo, {
    idMensagem: "3EB0Z",
    deMim: false,
    grupo: false,
    remetente: "não autorizado",
  });
});
