import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { readSignedDemoWebhook } from "./atendimento-webhook";

const secret = "segredo-ficticio-apenas-de-teste-000000000000";
function request(
  body: string,
  options: { signature?: string; length?: string; contentType?: string } = {},
) {
  return new Request("https://example.invalid/api/atendimento/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": options.contentType ?? "application/json",
      "x-av-signature-256":
        options.signature ??
        `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
      ...(options.length ? { "content-length": options.length } : {}),
    },
  });
}

test("webhook valida assinatura sobre corpo original e recusa chave ausente, adulteração e escopo extra", async () => {
  const body = JSON.stringify({
    accountId: randomUUID(),
    event: { externalId: "ficticio", text: "Olá" },
  });
  assert.deepEqual(
    await readSignedDemoWebhook(request(body), secret),
    JSON.parse(body),
  );
  const denied = (e: unknown) =>
    e instanceof Error && "status" in e && e.status === 401;
  await assert.rejects(readSignedDemoWebhook(request(body), ""), denied);
  await assert.rejects(
    readSignedDemoWebhook(
      request(body, { signature: "sha256=invalida" }),
      secret,
    ),
    denied,
  );
  const oldSignature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  await assert.rejects(
    readSignedDemoWebhook(
      request(`${body} `, { signature: oldSignature }),
      secret,
    ),
    denied,
  );
  const extra = JSON.stringify({ ...JSON.parse(body), tenantId: randomUUID() });
  await assert.rejects(readSignedDemoWebhook(request(extra), secret));
});

test("webhook limita bytes lidos mesmo com tamanho declarado falso e exige JSON", async () => {
  const oversized = "x".repeat(64 * 1024 + 1);
  const tooBig = (e: unknown) =>
    e instanceof Error && "status" in e && e.status === 413;
  await assert.rejects(
    readSignedDemoWebhook(request("{}", { length: "65537" }), secret),
    tooBig,
  );
  await assert.rejects(
    readSignedDemoWebhook(request(oversized, { length: "2" }), secret),
    tooBig,
  );
  await assert.rejects(
    readSignedDemoWebhook(request("{}", { contentType: "text/plain" }), secret),
    (e: unknown) => e instanceof Error && "status" in e && e.status === 415,
  );
});
