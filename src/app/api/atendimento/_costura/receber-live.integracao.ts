import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test, { after, afterEach } from "node:test";
import { db } from "@/server/db";
import { encryptChannelValue } from "@/server/atendimento-credenciais";
import { assinarPasse } from "@/connectors/whatsapp/passe";
import {
  receiveEvolutionChannel,
  receiveMetaChannel,
  verifyMetaChannel,
} from "./receber-live";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
const accounts: string[] = [];
afterEach(async () => {
  await db.avChannelAccount.updateMany({
    where: { id: { in: accounts } },
    data: { active: false },
  });
});
after(async () => db.$disconnect());
const phone = "+12025550123";
async function fixture() {
  const organization = await db.organizacao.create({
    data: { nome: "Webhook fictício Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Unidade fictícia",
      codigo: "TESTE",
    },
  });
  async function save(provider: "META" | "EVOLUTION") {
    const id = randomUUID(),
      scope = {
        organizationId: organization.id,
        storeId: unit.id,
        accountId: id,
      };
    const settings =
      provider === "META"
        ? {
            phoneNumberId:
              String(Date.now()) + Math.floor(Math.random() * 100000),
            businessAccountId: "123456789",
            apiVersion: "v26.0",
          }
        : {
            url: "http://evolution_api:8080",
            instance: "fixture-" + randomUUID(),
          };
    const secrets =
      provider === "META"
        ? {
            accessToken: "fixture-private-meta-token",
            appSecret: "fixture-private-app-secret",
            verifyToken: "fixture-private-verify-token",
          }
        : {
            apiKey: "fixture-private-evolution-key",
            webhookSecret: "fixture-webhook-secret-with-thirty-two-characters",
          };
    await db.avChannelAccount.create({
      data: {
        id,
        organizationId: organization.id,
        storeId: unit.id,
        name: "Webhook de ensaio Kairu",
        mode: provider,
        active: false,
      },
    });
    await db.avChannelConnection.create({
      data: {
        ...scope,
        settings,
        bindingKey: "fixture:" + id,
        encryptedCredentials: encryptChannelValue(
          scope,
          JSON.stringify(secrets),
        ),
      },
    });
    accounts.push(id);
    return { id, provider, revision: 1, settings };
  }
  return { organization, unit, save };
}

const metaEnvelope = (
  settings: { phoneNumberId: string; businessAccountId: string },
  messageId = randomUUID(),
) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: settings.businessAccountId,
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: settings.phoneNumberId },
            messages: [
              {
                id: messageId,
                from: phone.slice(1),
                type: "text",
                timestamp: String(Math.floor(Date.now() / 1000)),
                text: { body: "Exemplo Kairu" },
              },
            ],
          },
        },
      ],
    },
  ],
});
const jsonRequest = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://fixture.example.invalid/api/atendimento/callback", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
const metaSignature = (body: string, secret = "fixture-private-app-secret") =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("rotas Meta recusam ausência/adulteração de HMAC; desafio correto não substitui assinatura POST", async () => {
  const f = await fixture(),
    account = await f.save("META");
  const settings = account.settings as {
    phoneNumberId: string;
    businessAccountId: string;
  };
  const body = JSON.stringify(metaEnvelope(settings));
  const challenge = await verifyMetaChannel(
    new Request(
      "https://fixture.invalid/?hub.mode=subscribe&hub.verify_token=fixture-private-verify-token&hub.challenge=fixture-challenge",
    ),
    account.id,
  );
  assert.equal(challenge.status, 200);
  assert.equal(await challenge.text(), "fixture-challenge");
  assert.equal(
    (
      await verifyMetaChannel(
        new Request(
          "https://fixture.invalid/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=fixture",
        ),
        account.id,
      )
    ).status,
    403,
  );
  assert.equal(
    (await receiveMetaChannel(jsonRequest(body), account.id)).status,
    401,
  );
  assert.equal(
    (
      await receiveMetaChannel(
        jsonRequest(`${body} `, { "x-hub-signature-256": metaSignature(body) }),
        account.id,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await receiveMetaChannel(
        jsonRequest(body, {
          "x-hub-signature-256": metaSignature(body, "foreign-secret"),
        }),
        account.id,
      )
    ).status,
    401,
  );
  for (const value of [
    { ...settings, phoneNumberId: "111111111" },
    { ...settings, businessAccountId: "111111111" },
  ]) {
    const wrong = JSON.stringify(metaEnvelope(value));
    const result = await receiveMetaChannel(
      jsonRequest(wrong, { "x-hub-signature-256": metaSignature(wrong) }),
      account.id,
    );
    assert.equal(result.status, 200);
    assert.equal((await result.json()).events, 0);
  }
  assert.equal(
    await db.avInboundEvent.count({ where: { accountId: account.id } }),
    0,
  );
  assert.equal(
    await db.avMessage.count({ where: { accountId: account.id } }),
    0,
  );
});

test("callback Meta distribui somente vínculos exatos da mesma organização, mesmo com App Secret compartilhado", async () => {
  const f = await fixture(),
    foreign = await fixture();
  const anchor = await f.save("META"),
    second = await f.save("META"),
    other = await foreign.save("META");
  const settings = (account: typeof anchor) =>
    account.settings as { phoneNumberId: string; businessAccountId: string };
  const entries = [anchor, second, other].flatMap(
    (account) => metaEnvelope(settings(account)).entry,
  );
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: entries,
  });
  for (let i = 0; i < 2; i++) {
    const result = await receiveMetaChannel(
      jsonRequest(body, { "x-hub-signature-256": metaSignature(body) }),
      anchor.id,
    );
    assert.equal(result.status, 200);
  }
  assert.equal(
    await db.avMessage.count({ where: { accountId: anchor.id } }),
    1,
  );
  assert.equal(
    await db.avMessage.count({ where: { accountId: second.id } }),
    1,
  );
  assert.equal(
    await db.avInboundEvent.count({ where: { accountId: other.id } }),
    0,
  );
  assert.equal(
    (await db.avChannelAccount.findUniqueOrThrow({ where: { id: anchor.id } }))
      .active,
    false,
  );
});

test("rota Evolution exige JWT válido da conta e instância correta; replay não cria fala duplicada", async () => {
  const f = await fixture(),
    account = await f.save("EVOLUTION");
  const settings = account.settings as { instance: string };
  const envelope = {
    event: "messages.upsert",
    instance: settings.instance,
    data: {
      key: {
        id: randomUUID(),
        remoteJid: `${phone.slice(1)}@s.whatsapp.net`,
        fromMe: false,
      },
      message: { conversation: "Exemplo Kairu" },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
  const body = JSON.stringify(envelope),
    secret = "fixture-webhook-secret-with-thirty-two-characters";
  for (const authorization of [
    undefined,
    `Bearer ${assinarPasse("wrong-secret", new Date())}`,
    `Bearer ${assinarPasse(secret, new Date(Date.now() - 700_000))}`,
  ]) {
    const response = await receiveEvolutionChannel(
      jsonRequest(body, authorization ? { authorization } : {}),
      account.id,
    );
    assert.equal(response.status, 401);
  }
  assert.equal(
    await db.avInboundEvent.count({ where: { accountId: account.id } }),
    0,
  );
  const authorization = `Bearer ${assinarPasse(secret, new Date())}`;
  assert.equal(
    (
      await receiveEvolutionChannel(
        jsonRequest(
          JSON.stringify({ ...envelope, instance: "foreign-instance" }),
          { authorization },
        ),
        account.id,
      )
    ).status,
    403,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await receiveEvolutionChannel(
          jsonRequest(body, { authorization }),
          account.id,
        )
      ).status,
      200,
    );
  assert.equal(
    await db.avMessage.count({ where: { accountId: account.id } }),
    1,
  );
  assert.equal(
    await db.avInboundEvent.count({ where: { accountId: account.id } }),
    1,
  );
});
