import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptVirtualCredential,
  encryptVirtualCredential,
} from "./credencial-atendimento";

const scope = {
  organizationId: "organizacao-ficticia",
  storeId: "unidade-ficticia",
};

test("credencial de modelo usa nonce aleatório e AAD por organização e unidade", () => {
  const previous = process.env.AV_CREDENTIAL_KEY;
  process.env.AV_CREDENTIAL_KEY =
    "chave-de-cifra-ficticia-de-teste-00000000000000000000";
  try {
    const credential = "credencial-ficticia-sem-acesso";
    const encrypted = encryptVirtualCredential(scope, credential);
    assert.notEqual(encrypted, encryptVirtualCredential(scope, credential));
    assert.equal(encrypted.includes(credential), false);
    assert.equal(decryptVirtualCredential(scope, encrypted), credential);
    assert.throws(
      () =>
        decryptVirtualCredential(
          { ...scope, organizationId: "outra-organizacao" },
          encrypted,
        ),
      /MODEL_CREDENTIAL_UNAVAILABLE/,
    );
    assert.throws(
      () =>
        decryptVirtualCredential(
          { ...scope, storeId: "outra-unidade" },
          encrypted,
        ),
      /MODEL_CREDENTIAL_UNAVAILABLE/,
    );
    const tampered = Buffer.from(encrypted, "base64url");
    tampered[tampered.length - 1] ^= 1;
    assert.throws(
      () => decryptVirtualCredential(scope, tampered.toString("base64url")),
      /MODEL_CREDENTIAL_UNAVAILABLE/,
    );
    assert.throws(
      () => decryptVirtualCredential(scope, "invalid"),
      /MODEL_CREDENTIAL_UNAVAILABLE/,
    );
  } finally {
    if (previous === undefined) delete process.env.AV_CREDENTIAL_KEY;
    else process.env.AV_CREDENTIAL_KEY = previous;
  }
});

test("sem segredo privado válido a credencial não é gravada nem decifrada", () => {
  const previous = {
    key: process.env.AV_CREDENTIAL_KEY,
    auth: process.env.AUTH_SECRET,
  };
  delete process.env.AV_CREDENTIAL_KEY;
  delete process.env.AUTH_SECRET;
  try {
    assert.throws(
      () => encryptVirtualCredential(scope, "ficticia"),
      /MODEL_ENCRYPTION_UNAVAILABLE/,
    );
    assert.throws(
      () => decryptVirtualCredential(scope, "invalid"),
      /MODEL_CREDENTIAL_UNAVAILABLE/,
    );
  } finally {
    if (previous.key === undefined) delete process.env.AV_CREDENTIAL_KEY;
    else process.env.AV_CREDENTIAL_KEY = previous.key;
    if (previous.auth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous.auth;
  }
});
