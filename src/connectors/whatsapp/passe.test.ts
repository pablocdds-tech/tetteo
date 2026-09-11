import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { assinarPasse, verificarPasse } from "./passe";

/**
 * O PASSE DA EVOLUTION.
 *
 * A 2.3.7 não assina o corpo do webhook. O que ela oferece é isto: com
 * `jwt_key` configurado, cada chamada leva `Authorization: Bearer <JWT>`
 * HS256, válido por 10 minutos, com `{app: "evolution", action: "webhook"}`
 * (webhook.controller.ts, generateJwtToken). Prova QUEM chamou — não que o
 * conteúdo não mudou. Por isso a trava de duplicata e o esquema estrito vêm
 * depois, e não em vez disto.
 */

const CHAVE = "senha-de-ensaio-ficticia-01";
const AGORA = new Date("2026-09-10T20:00:00-03:00");

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/** Monta um JWT à mão, para testar o que a assinatura NÃO pode aceitar. */
function jwtManual(cabecalho: unknown, corpo: unknown, chave = CHAVE): string {
  const base = `${b64(cabecalho)}.${b64(corpo)}`;
  const assinatura = createHmac("sha256", chave)
    .update(base)
    .digest("base64url");
  return `${base}.${assinatura}`;
}

const segundos = (d: Date) => Math.floor(d.getTime() / 1000);

test("aceita o passe assinado com a senha", () => {
  const passe = assinarPasse(CHAVE, AGORA);
  assert.deepEqual(verificarPasse(`Bearer ${passe}`, [CHAVE], AGORA), {
    ok: true,
  });
});

test("o passe tem o formato exato do da Evolution 2.3.7", () => {
  const [cabecalho, corpo] = assinarPasse(CHAVE, AGORA).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(cabecalho, "base64url").toString()), {
    alg: "HS256",
    typ: "JWT",
  });
  const lido = JSON.parse(Buffer.from(corpo, "base64url").toString());
  assert.equal(lido.app, "evolution");
  assert.equal(lido.action, "webhook");
  assert.equal(lido.exp - lido.iat, 600);
});

test("recusa passe assinado com outra senha", () => {
  const passe = assinarPasse("outra-senha-ficticia-0001", AGORA);
  assert.equal(verificarPasse(`Bearer ${passe}`, [CHAVE], AGORA).ok, false);
});

test("aceita a senha anterior durante a troca", () => {
  const passe = assinarPasse("senha-antiga-ficticia-01", AGORA);
  const r = verificarPasse(
    `Bearer ${passe}`,
    [CHAVE, "senha-antiga-ficticia-01"],
    AGORA,
  );
  assert.deepEqual(r, { ok: true });
});

test("recusa passe vencido", () => {
  const onzeMinutosAntes = new Date(AGORA.getTime() - 11 * 60_000);
  const passe = assinarPasse(CHAVE, onzeMinutosAntes);
  assert.equal(verificarPasse(`Bearer ${passe}`, [CHAVE], AGORA).ok, false);
});

test("recusa passe emitido no futuro", () => {
  const passe = assinarPasse(CHAVE, new Date(AGORA.getTime() + 5 * 60_000));
  assert.equal(verificarPasse(`Bearer ${passe}`, [CHAVE], AGORA).ok, false);
});

/** O ataque clássico de JWT: dizer que não há assinatura e ser acreditado. */
test('recusa "alg: none" e qualquer algoritmo que não seja HS256', () => {
  const corpo = {
    iat: segundos(AGORA),
    exp: segundos(AGORA) + 600,
    app: "evolution",
    action: "webhook",
  };
  const semAssinatura = `${b64({ alg: "none", typ: "JWT" })}.${b64(corpo)}.`;
  assert.equal(
    verificarPasse(`Bearer ${semAssinatura}`, [CHAVE], AGORA).ok,
    false,
  );
  const outro = jwtManual({ alg: "HS512", typ: "JWT" }, corpo);
  assert.equal(verificarPasse(`Bearer ${outro}`, [CHAVE], AGORA).ok, false);
});

test("recusa passe de outra origem", () => {
  const passe = jwtManual(
    { alg: "HS256", typ: "JWT" },
    {
      iat: segundos(AGORA),
      exp: segundos(AGORA) + 600,
      app: "outro",
      action: "webhook",
    },
  );
  assert.equal(verificarPasse(`Bearer ${passe}`, [CHAVE], AGORA).ok, false);
});

test("recusa cabeçalho sem Bearer, vazio ou malformado", () => {
  const passe = assinarPasse(CHAVE, AGORA);
  assert.equal(verificarPasse(passe, [CHAVE], AGORA).ok, false);
  assert.equal(verificarPasse(null, [CHAVE], AGORA).ok, false);
  assert.equal(verificarPasse("Bearer a.b", [CHAVE], AGORA).ok, false);
  assert.equal(verificarPasse("Bearer !!!.@@@.###", [CHAVE], AGORA).ok, false);
});

test("sem senha configurada, nada passa", () => {
  const passe = assinarPasse(CHAVE, AGORA);
  assert.equal(verificarPasse(`Bearer ${passe}`, [], AGORA).ok, false);
});
