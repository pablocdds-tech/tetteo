import assert from "node:assert/strict";
import { test } from "node:test";

import { classificarFalha, entradaDoErro } from "./falhas";

/**
 * A PERGUNTA QUE DECIDE SE REPETIR É SEGURO: o pedido chegou à Evolution?
 *
 *   não chegou  → repetir não duplica nada           → pode tentar de novo
 *   incerto     → pode ter saído e a resposta sumiu  → NÃO repete sozinho
 *   recusado    → chegou e foi negado                → repetir não resolve
 *
 * Errar para o lado do "não chegou" é o que transforma um soluço de rede em
 * cinco mensagens iguais no celular do gerente.
 */

test("porta fechada ou nome que não resolve: o pedido não chegou", () => {
  for (const codigo of [
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
  ]) {
    assert.equal(
      classificarFalha({ tipo: "rede", codigo }),
      "nao-chegou",
      codigo,
    );
  }
});

test("conexão caída no meio é incerta — o pedido pode ter ido", () => {
  assert.equal(
    classificarFalha({ tipo: "rede", codigo: "ECONNRESET" }),
    "incerto",
  );
});

test("erro de rede sem código conhecido é tratado como incerto", () => {
  assert.equal(classificarFalha({ tipo: "rede" }), "incerto");
});

test("tempo esgotado é incerto", () => {
  assert.equal(classificarFalha({ tipo: "tempo" }), "incerto");
});

test("429 e 408: o provedor não chegou a processar", () => {
  assert.equal(classificarFalha({ tipo: "http", status: 429 }), "nao-chegou");
  assert.equal(classificarFalha({ tipo: "http", status: 408 }), "nao-chegou");
});

test("5xx é incerto", () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(
      classificarFalha({ tipo: "http", status }),
      "incerto",
      String(status),
    );
  }
});

test("credencial, instância ou número recusados não se repetem", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(
      classificarFalha({ tipo: "http", status }),
      "recusado",
      String(status),
    );
  }
});

test("reconhece o tempo esgotado do fetch", () => {
  const tempo = new DOMException("The operation timed out.", "TimeoutError");
  assert.deepEqual(entradaDoErro(tempo), { tipo: "tempo" });
  const abortado = new DOMException("aborted", "AbortError");
  assert.deepEqual(entradaDoErro(abortado), { tipo: "tempo" });
});

test("lê o código de rede escondido na causa do fetch", () => {
  const erro = new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
  });
  assert.deepEqual(entradaDoErro(erro), {
    tipo: "rede",
    codigo: "ECONNREFUSED",
  });
});

test("erro qualquer vira rede sem código — e portanto incerto", () => {
  const entrada = entradaDoErro(new Error("algo estranho"));
  assert.deepEqual(entrada, { tipo: "rede" });
  assert.equal(classificarFalha(entrada), "incerto");
});
