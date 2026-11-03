import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  demoChannel,
  maskVirtualSecrets,
  normalizeChannelPhone,
  verifyChannelSignature,
} from "./atendimento-canal";

test("canal de demonstração recusa destinatários reais inclusive internacionais e não simula entrega", async () => {
  const channel = demoChannel("fixture-account");
  for (const recipient of [
    "+5511999999999",
    "12025550123",
    "demo:+5511999999999",
    "demo:cliente@grupo",
  ])
    assert.equal(
      (
        await channel.sendText({
          recipient,
          text: "Ensaio",
          correlationId: "fixture",
        })
      ).state,
      "FAILED",
    );
  const receipt = await channel.sendText({
    recipient: "demo:cliente",
    text: "Ensaio fictício Kairu",
    correlationId: "fixture",
  });
  assert.equal(receipt.state, "ACCEPTED");
  assert.deepEqual(await channel.consultStatus("fixture"), receipt);
});
test("normalização mantém código internacional e recusa telefone ambíguo", () => {
  assert.equal(normalizeChannelPhone("+1 (202) 555-0123"), "+12025550123");
  assert.equal(normalizeChannelPhone("0055 84 99999-1234"), "+5584999991234");
  assert.equal(normalizeChannelPhone("(84) 99999-1234"), "+5584999991234");
  assert.throws(() => normalizeChannelPhone("2025550123", "1"));
  assert.throws(() => normalizeChannelPhone("+0123"));
});
test("assinatura falha se corpo ou segredo mudar; credenciais são removidas do texto", () => {
  const body = JSON.stringify({ message: "Fictício" }),
    secret = "fixture-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyChannelSignature(body, signature, secret), true);
  assert.equal(verifyChannelSignature(`${body} `, signature, secret), false);
  assert.equal(verifyChannelSignature(body, signature, "other"), false);
  assert.equal(verifyChannelSignature(body, signature, ""), false);
  assert.equal(
    maskVirtualSecrets("senha: ficticia token=valor Bearer abc.def"),
    "[credencial removida] [credencial removida] [credencial removida]",
  );
});
