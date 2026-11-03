import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedEvolutionUrl,
  allowedEvolutionOrigins,
  channelRecipientHash,
  decryptChannelValue,
  encryptChannelValue,
  reservedEvolutionInstance,
} from "./atendimento-credenciais";

test("credencial do canal exige AAD de organização/unidade/conta e recusa bytes adulterados", () => {
  const prior = process.env.AV_CREDENTIAL_KEY;
  process.env.AV_CREDENTIAL_KEY =
    "fixture-channel-key-with-thirty-two-characters";
  try {
    const scope = {
      organizationId: "org-fixture",
      storeId: "unit-fixture",
      accountId: "account-fixture",
    };
    const encrypted = encryptChannelValue(scope, "fictitious-private-value");
    assert.equal(
      decryptChannelValue(scope, encrypted),
      "fictitious-private-value",
    );
    assert.notEqual(
      encrypted,
      encryptChannelValue(scope, "fictitious-private-value"),
    );
    for (const field of ["organizationId", "storeId", "accountId"] as const)
      assert.throws(
        () => decryptChannelValue({ ...scope, [field]: "foreign" }, encrypted),
        /CHANNEL_CREDENTIAL_UNAVAILABLE/,
      );
    const changed = Buffer.from(encrypted, "base64url");
    changed[changed.length - 1] ^= 1;
    assert.throws(
      () => decryptChannelValue(scope, changed.toString("base64url")),
      /CHANNEL_CREDENTIAL_UNAVAILABLE/,
    );
    assert.equal(
      channelRecipientHash(scope, "+12025550123"),
      channelRecipientHash(scope, "+12025550123"),
    );
    assert.notEqual(
      channelRecipientHash(scope, "+12025550123"),
      channelRecipientHash({ ...scope, accountId: "foreign" }, "+12025550123"),
    );
  } finally {
    if (prior === undefined) delete process.env.AV_CREDENTIAL_KEY;
    else process.env.AV_CREDENTIAL_KEY = prior;
  }
});

test("Evolution aceita apenas origem explicitamente configurada no servidor", () => {
  const prior = {
    url: process.env.EVOLUTION_URL,
    origins: process.env.AV_EVOLUTION_ALLOWED_ORIGINS,
    staff: process.env.EVOLUTION_INSTANCIA,
    purchasing: process.env.COMPRAS_EVOLUTION_INSTANCIA,
  };
  Object.assign(process.env, {
    EVOLUTION_URL: "http://evolution_api:8080",
    EVOLUTION_INSTANCIA: "staff-ficticia",
    COMPRAS_EVOLUTION_INSTANCIA: "compras-ficticia",
    AV_EVOLUTION_ALLOWED_ORIGINS:
      "https://evolution.example.invalid/base,https://user:pass@blocked.invalid,ftp://blocked.invalid",
  });
  try {
    assert.equal(
      reservedEvolutionInstance("http://EVOLUTION_API:8080/", "staff-ficticia"),
      true,
    );
    assert.equal(
      reservedEvolutionInstance(
        "http://evolution_api:8080",
        "compras-ficticia",
      ),
      true,
    );
    assert.equal(
      reservedEvolutionInstance(
        "http://evolution_api:8080",
        "clientes-ficticia",
      ),
      false,
    );
    assert.equal(
      reservedEvolutionInstance("https://other.invalid", "staff-ficticia"),
      false,
    );
    assert.deepEqual(allowedEvolutionOrigins(), [
      "http://evolution_api:8080",
      "https://evolution.example.invalid/base",
    ]);
    assert.equal(acceptedEvolutionUrl("http://evolution_api:8080/"), true);
    assert.equal(
      acceptedEvolutionUrl("https://evolution.example.invalid/base"),
      true,
    );
    for (const value of [
      "https://unknown.invalid",
      "http://169.254.169.254",
      "https://evolution.example.invalid/base/other",
      "http://evolution_api:8080?secret=x",
      "http://evolution_api:8080#fragment",
      "http://user:pass@evolution_api:8080",
      "http://evolution_api:8080.evil.invalid",
    ])
      assert.equal(acceptedEvolutionUrl(value), false, value);
  } finally {
    if (prior.url === undefined) delete process.env.EVOLUTION_URL;
    else process.env.EVOLUTION_URL = prior.url;
    if (prior.origins === undefined)
      delete process.env.AV_EVOLUTION_ALLOWED_ORIGINS;
    else process.env.AV_EVOLUTION_ALLOWED_ORIGINS = prior.origins;
    if (prior.staff === undefined) delete process.env.EVOLUTION_INSTANCIA;
    else process.env.EVOLUTION_INSTANCIA = prior.staff;
    if (prior.purchasing === undefined)
      delete process.env.COMPRAS_EVOLUTION_INSTANCIA;
    else process.env.COMPRAS_EVOLUTION_INSTANCIA = prior.purchasing;
  }
});
