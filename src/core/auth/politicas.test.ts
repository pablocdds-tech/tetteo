import assert from "node:assert/strict";
import { test } from "node:test";
import {
  criarTokenRecuperacao,
  emailDeLogin,
  hashSegredo,
  identidadeGoogle,
  senhaNova,
  tokenDeRecuperacao,
  urlPublica,
} from "./politicas";

test("recuperação usa segredo aleatório de 256 bits e expira em 30 minutos", () => {
  const agora = new Date("2026-10-24T12:00:00Z");
  const a = criarTokenRecuperacao(agora);
  const b = criarTokenRecuperacao(agora);
  assert.notEqual(a.token, b.token);
  assert.equal(a.token.length, 64);
  assert.equal(a.tokenHash, hashSegredo(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.equal(a.expiraEm.toISOString(), "2026-10-24T12:30:00.000Z");
  assert.equal(tokenDeRecuperacao.safeParse("../../conta").success, false);
});

test("senha exige 12 caracteres e respeita o limite em bytes do bcrypt", () => {
  assert.equal(senhaNova.safeParse("curta").success, false);
  assert.equal(senhaNova.safeParse("a".repeat(72)).success, true);
  assert.equal(senhaNova.safeParse("a".repeat(73)).success, false);
  assert.equal(senhaNova.safeParse("🔑".repeat(19)).success, false);
  assert.equal(senhaNova.safeParse("Minha senha segura 123").success, true);
});

test("Google exige e-mail verificado e subject imutável", () => {
  assert.equal(
    identidadeGoogle({
      sub: "g-1",
      email: "a@example.com",
      email_verified: false,
    }),
    null,
  );
  assert.equal(
    identidadeGoogle({
      sub: "g-1",
      email: "a@example.com",
      email_verified: "true",
    }),
    null,
  );
  assert.equal(
    identidadeGoogle({ email: "a@example.com", email_verified: true }),
    null,
  );
  assert.equal(
    identidadeGoogle({ sub: "g-1", email: "inválido", email_verified: true }),
    null,
  );
  assert.deepEqual(
    identidadeGoogle({
      sub: "g-1",
      email: "  Ana@Example.com ",
      email_verified: true,
      name: " Ana ",
    }),
    { subject: "g-1", email: "ana@example.com", nome: "Ana" },
  );
  assert.equal(emailDeLogin.parse("  Ana@Example.com "), "ana@example.com");
});

test("links usam APP_URL confiável, nunca Host enviado por cliente", () => {
  const anterior = process.env.APP_URL;
  try {
    process.env.APP_URL = "https://app.example.com/";
    assert.equal(urlPublica(), "https://app.example.com");
    process.env.APP_URL = "http://app.example.com";
    assert.throws(urlPublica);
    process.env.APP_URL = "https://user:senha@app.example.com";
    assert.throws(urlPublica);
    process.env.APP_URL = "http://localhost:3000";
    assert.equal(urlPublica(), "http://localhost:3000");
  } finally {
    if (anterior === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = anterior;
  }
});
