import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decifrar,
  hashDoCodigo,
  novoCodigo,
  pareceCodigo,
} from "./cripto-do-link";

process.env.AUTH_SECRET ??= "segredo-apenas-de-teste";

test("o código volta igual depois de cifrado", () => {
  const { codigo, hash, cifrado } = novoCodigo();
  assert.ok(pareceCodigo(codigo));
  assert.equal(hash, hashDoCodigo(codigo));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(decifrar(cifrado), codigo);
  // O cifrado não contém o código em texto puro.
  assert.ok(!cifrado.includes(codigo));
});

test("dois códigos nunca são iguais", () => {
  assert.notEqual(novoCodigo().codigo, novoCodigo().codigo);
});

test("cifrado adulterado é recusado", () => {
  const { cifrado } = novoCodigo();
  const partes = cifrado.split(".");
  partes[3] = partes[3].slice(0, -2) + (partes[3].endsWith("A") ? "BB" : "AA");
  assert.throws(() => decifrar(partes.join(".")));
});

test("lixo não parece código", () => {
  assert.equal(pareceCodigo("../../etc/passwd"), false);
  assert.equal(pareceCodigo(""), false);
});
