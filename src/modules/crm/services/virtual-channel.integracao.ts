import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, afterEach } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { encryptVirtualCredential } from "@/server/ia/credencial-atendimento";
import { channelRecipientHash } from "@/server/atendimento-credenciais";
import {
  liveChannelConfiguration,
  recordChannelDelivery,
  recordedChannelReceipt,
  channelServiceWindow,
  reconcileStoredChannelDeliveries,
} from "@/server/atendimento-contas";
import type {
  ChannelManagement,
  ChannelManagementFactory,
} from "@/server/atendimento-provedor";
import { setLiveBookingCapacity } from "@/server/atendimento-reservas";
import { changeVirtualChannel, virtualChannels } from "./virtual-channels";
import { changeVirtualPolicy, virtualPolicy } from "./virtual-policy";
import { virtualQuality } from "./virtual-quality";
import { bindVirtualCustomer } from "./virtual-identity";
import {
  processVirtualQueue,
  receiveVirtualInbound,
  deliverVirtualOutbox,
} from "./virtual-runtime";
import {
  claimFor,
  executeVirtualTool,
  newPendingReservation,
} from "./virtual-tools";
import { protectIdentity } from "./campaign-domain";
import type { VirtualTurnInput } from "../virtual-types";

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
const policyFields = {
  instructions: "Use linguagem simples e faça uma pergunta por vez.",
  tone: "ACOLHEDOR",
  greeting: "Olá! Como posso ajudar?",
  fallbackMessage: "Pode explicar um pouco mais?",
};
async function fixture() {
  const organization = await db.organizacao.create({
    data: { nome: "Canais fictícios Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Unidade fictícia",
      codigo: "TESTE",
    },
  });
  const actor = await db.usuario.create({
    data: {
      nome: "Gestor fictício",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const context: ContextoSessao = {
    usuario: {
      id: actor.id,
      nome: actor.nome,
      email: actor.email,
      avatarUrl: null,
    },
    organizacao: { id: organization.id, nome: organization.nome },
    unidadeAtiva: { id: unit.id, nome: unit.nome, codigo: unit.codigo },
    unidadesVisiveis: [{ id: unit.id, nome: unit.nome, codigo: unit.codigo }],
    podeVerRedeInteira: false,
    permissoes: new Set(["crm.ver", "crm.editar", "crm.gerenciar"]),
    ehDiretor: false,
  };
  let sends = 0;
  const management: ChannelManagementFactory = async (accountId) => {
    const config = await liveChannelConfiguration(accountId);
    return {
      identify: () => ({
        mode: config.provider,
        accountKey: accountId,
        revision: config.revision,
      }),
      verify: async () => ({ connected: true }),
      qr: async () => ({
        state: "CONNECTED",
        qrDataUrl: null,
        expiresAt: null,
        status: "OPEN",
      }),
      webhook: async () => {},
      sendText: async () => {
        sends++;
        return { state: "ACCEPTED", providerId: `fixture:${randomUUID()}` };
      },
      sendMedia: async () => ({ state: "FAILED", error: "MEDIA_DISABLED" }),
      consultStatus: async () => ({ state: "UNCERTAIN", error: "NO_RECEIPT" }),
    } satisfies ChannelManagement;
  };
  async function save(
    provider: "META" | "EVOLUTION",
    extra: Record<string, unknown> = {},
  ) {
    const payload =
      provider === "META"
        ? {
            phoneNumberId:
              String(Date.now()) + Math.floor(Math.random() * 100000),
            businessAccountId: "123456789",
            accessToken: "fixture-private-meta-token",
            appSecret: "fixture-private-app-secret",
            verifyToken: "fixture-private-verify-token",
          }
        : {
            url: process.env.EVOLUTION_URL ?? "http://evolution_api:8080",
            instance: `fixture-${randomUUID()}`,
            apiKey: "fixture-private-evolution-key",
            webhookSecret: "fixture-webhook-secret-with-thirty-two-characters",
          };
    const result = await changeVirtualChannel(
      context,
      {
        storeId: unit.id,
        action: "save",
        name: `Canal ${provider} fictício`,
        provider,
        ...payload,
        ...extra,
      },
      management,
    );
    assert.ok("accounts" in result);
    const account = result.accounts
      .filter(
        (a) =>
          a.provider === provider &&
          (!extra.accountId || a.id === extra.accountId),
      )
      .at(-1)!;
    if (!accounts.includes(account.id)) accounts.push(account.id);
    return account;
  }
  const op = (
    account: { id: string; revision: number },
    extra: Record<string, unknown>,
  ) =>
    changeVirtualChannel(
      context,
      {
        storeId: unit.id,
        accountId: account.id,
        revision: account.revision,
        ...extra,
      },
      management,
    );
  const inbound = (
    account: { id: string; provider: string },
    extra: Record<string, unknown> = {},
  ) =>
    receiveVirtualInbound(
      account.id,
      {
        type: "MESSAGE",
        externalId: randomUUID(),
        senderKey: phone,
        trustedPhone: phone,
        occurredAt: new Date().toISOString(),
        text: "Olá",
        ...extra,
      },
      { provider: account.provider as "META" | "EVOLUTION" },
    );
  return {
    organization,
    unit,
    actor,
    context,
    management,
    save,
    op,
    inbound,
    sends: () => sends,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const scopeOf = (f: Fixture, accountId: string) => ({
  organizationId: f.organization.id,
  storeId: f.unit.id,
  accountId,
});
async function facts(f: Fixture, accountId: string) {
  return db.avKnowledgeVersion.create({
    data: {
      ...scopeOf(f, accountId),
      version: 1,
      status: "APPROVED",
      authorId: f.actor.id,
      approvedById: f.actor.id,
      approvedAt: new Date(),
      validFrom: new Date(Date.now() - 1000),
      validUntil: new Date(Date.now() + 86_400_000),
      facts: {
        name: "Unidade fictícia Kairu",
        address: "Endereço de ensaio",
        hours: [],
        exceptions: [],
        menu: [],
        links: [],
        reservationPolicy: "Reserva fictícia por confirmação explícita",
        supportContact: "Equipe no painel",
      },
    },
  });
}
async function model(f: Fixture) {
  const scope = { organizationId: f.organization.id, storeId: f.unit.id };
  return db.avModelConfiguration.create({
    data: {
      ...scope,
      provider: "GEMINI",
      model: "gemini-fixture",
      encryptedKey: encryptVirtualCredential(
        scope,
        "fixture-private-model-key",
      ),
      ratesConfirmed: true,
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      enabled: true,
      testState: "PASSED",
      testedRevision: 1,
      testedAt: new Date(),
      updatedById: f.actor.id,
    },
  });
}
async function verified(f: Fixture, account: { id: string; revision: number }) {
  await f.op(account, { action: "verify" });
}

test("política exige gestor, mantém escopo e histórico imutável com aprovação auditada", async () => {
  const f = await fixture(),
    other = await fixture();
  await assert.rejects(
    changeVirtualPolicy(
      { ...f.context, permissoes: new Set(["crm.ver"]) },
      { storeId: f.unit.id, action: "draft", ...policyFields },
    ),
    /Sem acesso/,
  );
  const drafts = await Promise.all([
    changeVirtualPolicy(f.context, {
      storeId: f.unit.id,
      action: "draft",
      ...policyFields,
    }),
    changeVirtualPolicy(f.context, {
      storeId: f.unit.id,
      action: "draft",
      ...policyFields,
      tone: "OBJETIVO",
    }),
  ]);
  const result = await virtualPolicy(f.context, f.unit.id);
  assert.deepEqual(
    result.versions.map((v) => v.version),
    [2, 1],
  );
  const id = drafts[0].versions[0].id;
  await assert.rejects(
    changeVirtualPolicy(other.context, {
      storeId: other.unit.id,
      action: "approve",
      versionId: id,
    }),
    /indisponível/,
  );
  await changeVirtualPolicy(f.context, {
    storeId: f.unit.id,
    action: "approve",
    versionId: id,
  });
  await changeVirtualPolicy(f.context, {
    storeId: f.unit.id,
    action: "approve",
    versionId: id,
  });
  assert.equal(
    (await virtualPolicy(f.context, f.unit.id)).current?.approvedById,
    f.actor.id,
  );
  const audit = await db.avAuditEvent.findMany({
    where: { organizationId: f.organization.id },
  });
  assert.equal(audit.filter((a) => a.action === "POLICY_APPROVED").length, 1);
  assert.doesNotMatch(JSON.stringify(audit), /Use linguagem simples|Olá! Como/);
});

test("política recusa segredos, contatos inventados e confirmação de efeito em texto estático", async () => {
  const f = await fixture();
  for (const extra of [
    { instructions: "token=fixture-secret" },
    { greeting: "Veja https://inventado.invalid" },
    { fallbackMessage: "Ligue +55 11 99999-9999" },
    { greeting: "Sua reserva está confirmada" },
    { fallbackMessage: "Chamei o gerente" },
    { greeting: "A equipe foi avisada" },
  ])
    await assert.rejects(
      changeVirtualPolicy(f.context, {
        storeId: f.unit.id,
        action: "draft",
        ...policyFields,
        ...extra,
      }),
    );
  assert.equal(
    await db.avAgentPolicy.count({
      where: { organizationId: f.organization.id },
    }),
    0,
  );
});

test("qualidade agrega período/conta sem vazar falhas brutas ou dados de outra unidade", async () => {
  const f = await fixture(),
    other = await fixture();
  const account = await f.save("EVOLUTION"),
    foreign = await other.save("META");
  const id = (await f.inbound(account)).conversationId!;
  for (const [status, cost, latency, error] of [
    ["COMPLETED", 100, 1000, null],
    ["FAILED", 200, 3000, "token=fixture-secret"],
    ["FAILED", 50, 500, "EMPTY_RESPONSE"],
  ] as const)
    await db.avAgentRun.create({
      data: {
        ...scopeOf(f, account.id),
        conversationId: id,
        version: 1,
        leaseOwner: randomUUID(),
        status,
        costMicros: cost,
        tokens: 10,
        latencyMs: latency,
        error,
      },
    });
  const data = await virtualQuality(f.context, f.unit.id, account.id, 7);
  assert.equal(data.total, 3);
  assert.equal(data.completed, 1);
  assert.equal(data.failed, 2);
  assert.equal(data.emptyResponses, 1);
  assert.equal(data.costMicros, 350);
  assert.equal(data.tokens, 30);
  assert.equal(data.latencyP50, 1000);
  assert.doesNotMatch(JSON.stringify(data), /fixture-secret/);
  await assert.rejects(
    virtualQuality(f.context, f.unit.id, foreign.id, 7),
    /indisponível/,
  );
  await assert.rejects(virtualQuality(f.context, f.unit.id, account.id, 365));
});

test("configuração do canal mantém segredos cifrados, vínculo único e acesso da unidade", async () => {
  const f = await fixture(),
    other = await fixture();
  const account = await f.save("META");
  const dto = await virtualChannels(f.context, f.unit.id);
  assert.doesNotMatch(
    JSON.stringify(dto),
    /fixture-private|encryptedCredentials|accessToken|appSecret|verifyToken/,
  );
  assert.equal(account.active, false);
  assert.equal(account.credentialPresent, true);
  const row = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.doesNotMatch(row.encryptedCredentials, /fixture-private/);
  await assert.rejects(
    changeVirtualChannel(
      { ...f.context, permissoes: new Set(["crm.ver"]) },
      {
        storeId: f.unit.id,
        accountId: account.id,
        revision: 1,
        action: "verify",
      },
      f.management,
    ),
    /Sem acesso/,
  );
  await assert.rejects(
    changeVirtualChannel(
      other.context,
      {
        storeId: other.unit.id,
        accountId: account.id,
        revision: 1,
        action: "verify",
      },
      other.management,
    ),
    /não encontrada|Selecione/,
  );
  await assert.rejects(
    other.save("META", {
      phoneNumberId: (account.settings as { phoneNumberId: string })
        .phoneNumberId,
    }),
    /já está vinculado/,
  );
  await assert.rejects(
    f.save("META", { accountId: account.id, phoneNumberId: "987654321" }),
    /histórico mantém/,
  );
  assert.doesNotMatch(
    JSON.stringify(
      await db.avAuditEvent.findMany({
        where: { organizationId: f.organization.id },
      }),
    ),
    /fixture-private|encryptedCredentials/,
  );
});

test("Evolution recusa origem arbitrária e instância reservada dos avisos internos", async () => {
  const f = await fixture();
  await assert.rejects(
    f.save("EVOLUTION", { url: "https://unknown.invalid" }),
    /autorizado/,
  );
  const prior = process.env.EVOLUTION_INSTANCIA;
  process.env.EVOLUTION_INSTANCIA = "fixture-staff-only";
  try {
    await assert.rejects(
      f.save("EVOLUTION", { instance: "fixture-staff-only" }),
      /avisos internos/,
    );
  } finally {
    if (prior === undefined) delete process.env.EVOLUTION_INSTANCIA;
    else process.env.EVOLUTION_INSTANCIA = prior;
  }
  assert.equal(
    await db.avChannelAccount.count({
      where: { organizationId: f.organization.id },
    }),
    0,
  );
});

test("Meta exige janela recebida recente e teste idempotente aceito não autoriza observação nem ativação", async () => {
  const f = await fixture(),
    account = await f.save("META");
  await verified(f, account);
  await assert.rejects(
    f.op(account, {
      action: "sendTest",
      recipient: phone,
      confirmedTestNumber: true,
      requestId: randomUUID(),
    }),
    /24 horas/,
  );
  await f.inbound(account);
  assert.equal(await channelServiceWindow(account.id, phone), true);
  const requestId = randomUUID();
  await f.op(account, {
    action: "sendTest",
    recipient: phone,
    confirmedTestNumber: true,
    requestId,
  });
  await f.op(account, {
    action: "sendTest",
    recipient: phone,
    confirmedTestNumber: true,
    requestId,
  });
  assert.equal(f.sends(), 1);
  const testRow = await db.avChannelTest.findFirstOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(testRow.state, "ACCEPTED");
  assert.notEqual(testRow.encryptedRecipient, phone);
  await assert.rejects(
    f.op(account, {
      action: "ackTest",
      testId: testRow.id,
      confirmedObserved: true,
    }),
    /retorno autenticado/,
  );
  await assert.rejects(
    f.op(account, { action: "activate", enabled: true }),
    /teste|Gemini|Publique/,
  );
  await assert.rejects(
    f.op(account, {
      action: "sendTest",
      recipient: "+12025550124",
      confirmedTestNumber: true,
      requestId,
    }),
    /24 horas|outro teste/,
  );
});

test("entrega autenticada exige conta/remetente/revisão; observação humana e dados reais completam ativação", async () => {
  const f = await fixture(),
    account = await f.save("META");
  const prior = process.env.APP_URL;
  process.env.APP_URL = "https://fixture.example.invalid";
  try {
    await model(f);
    await facts(f, account.id);
    await verified(f, account);
    await f.inbound(account);
    await f.op(account, {
      action: "sendTest",
      recipient: phone,
      confirmedTestNumber: true,
      requestId: randomUUID(),
    });
    const row = await db.avChannelTest.findFirstOrThrow({
      where: { accountId: account.id },
    });
    const config = await liveChannelConfiguration(account.id);
    const delivery = {
      externalId: randomUUID(),
      providerId: row.providerId!,
      recipient: phone,
      correlationId: `test:${row.id}`,
      state: "DELIVERED" as const,
    };
    await recordChannelDelivery(config, {
      ...delivery,
      externalId: randomUUID(),
      recipient: "+12025550124",
    });
    assert.equal(
      (await db.avChannelTest.findUniqueOrThrow({ where: { id: row.id } }))
        .state,
      "ACCEPTED",
    );
    await recordChannelDelivery(
      { ...config, revision: config.revision + 1 },
      { ...delivery, externalId: randomUUID() },
    );
    assert.equal(
      (await db.avChannelTest.findUniqueOrThrow({ where: { id: row.id } }))
        .state,
      "ACCEPTED",
    );
    await recordChannelDelivery(config, delivery);
    await recordChannelDelivery(config, delivery);
    assert.equal(
      await db.avInboundEvent.count({
        where: { accountId: account.id, externalId: delivery.externalId },
      }),
      1,
    );
    await assert.rejects(
      f.op(account, { action: "activate", enabled: true }),
      /confirme a observação/,
    );
    await f.op(account, {
      action: "ackTest",
      testId: row.id,
      confirmedObserved: true,
    });
    await f.op(account, { action: "activate", enabled: true });
    assert.equal(
      (
        await db.avChannelAccount.findUniqueOrThrow({
          where: { id: account.id },
        })
      ).active,
      true,
    );
    const changed = await f.save("META", {
      accountId: account.id,
      ...(account.settings as object),
    });
    assert.equal(changed.revision, 2);
    assert.equal(changed.active, false);
    await assert.rejects(
      f.op(account, { action: "activate", enabled: true }),
      /configuração mudou/,
    );
    await assert.rejects(
      f.op(changed, { action: "activate", enabled: true }),
      /Verifique|teste/,
    );
  } finally {
    if (prior === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prior;
  }
});

test("entrada real exige atestado do provedor; conta inativa retém mensagem sem executar ou enviar", async () => {
  const f = await fixture(),
    account = await f.save("EVOLUTION");
  const input = {
    externalId: randomUUID(),
    senderKey: phone,
    type: "MESSAGE",
    text: "Olá",
  };
  await assert.rejects(
    receiveVirtualInbound(account.id, input),
    /webhook autenticado/,
  );
  await assert.rejects(
    receiveVirtualInbound(account.id, input, { provider: "META" }),
    /webhook autenticado/,
  );
  const id = (await f.inbound(account)).conversationId!;
  await db.avConversation.update({
    where: { id },
    data: { processAfter: new Date(Date.now() - 1000) },
  });
  let called = false;
  await processVirtualQueue(async () => {
    called = true;
    return { text: "fixture", tokens: 0, costMicros: 0 };
  });
  assert.equal(called, false);
  assert.equal(f.sends(), 0);
  assert.equal(
    await db.avMessage.count({
      where: { conversationId: id, processedAt: null },
    }),
    1,
  );
  const unresolved = await f.inbound(account, {
    externalId: randomUUID(),
    senderKey: "123456@lid",
    trustedPhone: undefined,
  });
  assert.equal(unresolved.conversationId, null);
  assert.equal(
    await db.avInboundEvent.count({
      where: { accountId: account.id, error: "UNRESOLVED_SENDER" },
    }),
    1,
  );
});

test("identidade PHONE verificada reconhece cliente somente na organização/unidade correta", async () => {
  const f = await fixture(),
    other = await fixture();
  const account = await f.save("EVOLUTION"),
    foreign = await other.save("META");
  const contact = await db.crmContact.create({
    data: { storeId: f.unit.id, name: "Ana fictícia", phone },
  });
  const identity = await db.crmIdentity.create({
    data: {
      storeId: f.unit.id,
      contactId: contact.id,
      type: "PHONE",
      verifiedAt: new Date(Date.now() + 60_000),
      verifiedById: f.actor.id,
      ...protectIdentity(f.unit.id, "PHONE", phone),
    },
  });
  const unknown = (await f.inbound(account)).conversationId!;
  assert.equal(
    (await db.avConversation.findUniqueOrThrow({ where: { id: unknown } }))
      .contactId,
    null,
  );
  await db.crmIdentity.update({
    where: { id: identity.id },
    data: { verifiedAt: new Date(), verifiedById: f.actor.id },
  });
  await f.inbound(account);
  assert.equal(
    (await db.avConversation.findUniqueOrThrow({ where: { id: unknown } }))
      .contactId,
    contact.id,
  );
  const otherId = (await other.inbound(foreign)).conversationId!;
  assert.equal(
    (await db.avConversation.findUniqueOrThrow({ where: { id: otherId } }))
      .contactId,
    null,
  );
  assert.notEqual(
    channelRecipientHash(scopeOf(f, account.id), phone),
    channelRecipientHash(scopeOf(other, foreign.id), phone),
  );
});

test("vínculo administrativo exige mensagem real, verificação explícita, versão e cadastro local", async () => {
  const f = await fixture(),
    other = await fixture(),
    account = await f.save("META");
  const id = (await f.inbound(account)).conversationId!;
  const current = await db.avConversation.findUniqueOrThrow({ where: { id } });
  const contact = await db.crmContact.create({
    data: { storeId: f.unit.id, name: "Cliente fictício" },
  });
  const foreign = await db.crmContact.create({
    data: {
      storeId: other.unit.id,
      name: "Outra pessoa fictícia",
    },
  });
  const input = {
    storeId: f.unit.id,
    conversationId: id,
    contactId: contact.id,
    version: current.version,
    requestId: randomUUID(),
    confirmedVerified: true,
  };
  await assert.rejects(
    bindVirtualCustomer(f.context, { ...input, confirmedVerified: false }),
  );
  await assert.rejects(
    bindVirtualCustomer(f.context, { ...input, contactId: foreign.id }),
    /indisponível/,
  );
  await assert.rejects(
    bindVirtualCustomer(f.context, { ...input, version: current.version - 1 }),
    /atendimento mudou/,
  );
  await bindVirtualCustomer(f.context, input);
  await bindVirtualCustomer(f.context, input);
  assert.equal(
    (await db.avConversation.findUniqueOrThrow({ where: { id } })).contactId,
    contact.id,
  );
  assert.equal(
    await db.crmIdentity.count({
      where: { contactId: contact.id, verifiedAt: { lte: new Date() } },
    }),
    2,
  );
});

test("dois provedores reais disputam a mesma última vaga; demonstração não consome capacidade real", async () => {
  const f = await fixture(),
    evo = await f.save("EVOLUTION"),
    meta = await f.save("META");
  const date = "2099-01-02",
    time = "19:00";
  for (const account of [evo, meta]) {
    await verified(f, account);
    await facts(f, account.id);
    await db.avChannelAccount.update({
      where: { id: account.id },
      data: { active: true },
    });
  }
  await db.$transaction((tx) =>
    setLiveBookingCapacity(tx, scopeOf(f, evo.id), {
      date,
      time,
      capacity: 2,
      enabled: true,
    }),
  );
  const demo = await db.avChannelAccount.create({
    data: {
      organizationId: f.organization.id,
      storeId: f.unit.id,
      name: "Demonstração isolada",
      mode: "DEMO",
      active: false,
    },
  });
  accounts.push(demo.id);
  const demoConversation = await db.avConversation.create({
    data: {
      ...scopeOf(f, demo.id),
      externalCustomerId: "demo:fixture",
      displayName: "Exemplo",
    },
  });
  const demoSlot = await db.avReservationSlot.create({
    data: { ...scopeOf(f, demo.id), date, time, capacity: 2 },
  });
  await db.avReservation.create({
    data: {
      ...scopeOf(f, demo.id),
      conversationId: demoConversation.id,
      externalCustomerId: "demo:fixture",
      slotId: demoSlot.id,
      partySize: 2,
      guestName: "Exemplo",
      idempotencyKey: randomUUID(),
      payloadHash: "fixture",
    },
  });
  for (const account of [evo, meta]) {
    const id = (await f.inbound(account, { text: "confirmo" })).conversationId!;
    const pending = newPendingReservation({
      type: "create",
      date,
      time,
      partySize: 2,
      guestName: "Ana fictícia",
    });
    await db.avConversation.update({
      where: { id },
      data: { state: { pending }, processAfter: new Date(Date.now() - 1000) },
    });
  }
  const reserve = async (input: VirtualTurnInput) => {
    const row = await db.avConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
    });
    const pending = (row.state as { pending: { token: string } }).pending;
    const result = await executeVirtualTool(
      input,
      "criar_reserva",
      { confirmationToken: pending.token },
      `create:${pending.token}`,
    );
    return {
      text: result.success ? "Reserva confirmada pelo serviço." : result.error!,
      tokens: 0,
      costMicros: 0,
      claims: claimFor(result, "criar_reserva"),
    };
  };
  await Promise.all([
    processVirtualQueue(reserve),
    processVirtualQueue(reserve),
  ]);
  const real = await db.avReservation.findMany({
    where: {
      organizationId: f.organization.id,
      account: { mode: { in: ["META", "EVOLUTION"] } },
    },
  });
  assert.equal(real.length, 1);
  assert.equal(real[0].partySize, 2);
  await assert.rejects(
    db.$transaction((tx) =>
      setLiveBookingCapacity(tx, scopeOf(f, evo.id), {
        date,
        time,
        capacity: 1,
        enabled: true,
      }),
    ),
    /menor que as reservas/,
  );
});

test("worker de saída recusa fábrica de outro modo/conta/revisão em canal real", async () => {
  const f = await fixture(),
    account = await f.save("EVOLUTION");
  await verified(f, account);
  await db.avChannelAccount.update({
    where: { id: account.id },
    data: { active: true },
  });
  const id = (await f.inbound(account)).conversationId!;
  const current = await db.avConversation.findUniqueOrThrow({ where: { id } });
  const out = await db.avMessageOutbox.create({
    data: {
      ...scopeOf(f, account.id),
      conversationId: id,
      version: current.version,
      requestId: randomUUID(),
      author: "HUMAN",
      text: "Mensagem fictícia",
    },
  });
  let sends = 0;
  const bad = await f.management(account.id);
  await deliverVirtualOutbox(20, () => ({
    ...bad,
    identify: () => ({ mode: "META", accountKey: account.id, revision: 1 }),
    sendText: async () => {
      sends++;
      return { state: "ACCEPTED", providerId: "invalid" };
    },
  }));
  assert.equal(sends, 0);
  assert.notEqual(
    (await db.avMessageOutbox.findUniqueOrThrow({ where: { id: out.id } }))
      .state,
    "ACCEPTED",
  );
});

test("callback anterior ao retorno HTTP é reconciliado pelo ID sem novo envio", async () => {
  const f = await fixture(),
    account = await f.save("EVOLUTION");
  await verified(f, account);
  let sends = 0;
  const providerId = `fixture:${randomUUID()}`;
  const factory: ChannelManagementFactory = async (id) => ({
    ...(await f.management(id)),
    async sendText() {
      sends++;
      await recordChannelDelivery(await liveChannelConfiguration(id), {
        externalId: randomUUID(),
        providerId,
        recipient: phone,
        state: "DELIVERED",
      });
      return { state: "ACCEPTED", providerId };
    },
  });
  const requestId = randomUUID();
  const input = {
    storeId: f.unit.id,
    accountId: account.id,
    revision: account.revision,
    action: "sendTest",
    recipient: phone,
    confirmedTestNumber: true,
    requestId,
  };
  await changeVirtualChannel(f.context, input, factory);
  const row = await db.avChannelTest.findUniqueOrThrow({
    where: { accountId_requestId: { accountId: account.id, requestId } },
  });
  assert.equal(row.state, "DELIVERED");
  assert.ok(row.deliveredAt);
  await reconcileStoredChannelDeliveries(account.id, providerId);
  await changeVirtualChannel(f.context, input, factory);
  assert.equal(sends, 1);
});

test("recibos não trocam objeto/providerId nem regridem falha ou entrega; duplicata adulterada é auditada", async () => {
  const f = await fixture(),
    account = await f.save("EVOLUTION");
  await verified(f, account);
  await f.op(account, {
    action: "sendTest",
    recipient: phone,
    confirmedTestNumber: true,
    requestId: randomUUID(),
  });
  const row = await db.avChannelTest.findFirstOrThrow({
    where: { accountId: account.id },
  });
  const config = await liveChannelConfiguration(account.id);
  const common = {
    recipient: phone,
    correlationId: `test:${row.id}`,
    providerId: row.providerId!,
  };
  await recordChannelDelivery(config, {
    ...common,
    externalId: randomUUID(),
    providerId: "contradictory",
    state: "DELIVERED",
  });
  assert.equal(
    (await db.avChannelTest.findUniqueOrThrow({ where: { id: row.id } })).state,
    "ACCEPTED",
  );
  const duplicateId = randomUUID();
  await recordChannelDelivery(config, {
    ...common,
    externalId: duplicateId,
    state: "ACCEPTED",
  });
  await recordChannelDelivery(config, {
    ...common,
    externalId: duplicateId,
    state: "DELIVERED",
  });
  assert.equal(
    (await db.avChannelTest.findUniqueOrThrow({ where: { id: row.id } })).state,
    "ACCEPTED",
  );
  await recordChannelDelivery(config, {
    ...common,
    externalId: randomUUID(),
    state: "FAILED",
  });
  await recordChannelDelivery(config, {
    ...common,
    externalId: randomUUID(),
    state: "ACCEPTED",
  });
  assert.equal(
    (await db.avChannelTest.findUniqueOrThrow({ where: { id: row.id } })).state,
    "FAILED",
  );
  await recordChannelDelivery(config, {
    ...common,
    externalId: randomUUID(),
    state: "READ",
  });
  await recordChannelDelivery(config, {
    ...common,
    externalId: randomUUID(),
    state: "FAILED",
  });
  const delivered = await db.avChannelTest.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(delivered.state, "DELIVERED");
  assert.equal(delivered.providerId, row.providerId);
  assert.ok(
    (await db.avAuditEvent.count({
      where: {
        organizationId: f.organization.id,
        action: "CHANNEL_DELIVERY_CONFLICT",
      },
    })) >= 2,
  );
  assert.equal(
    await db.avMessage.count({ where: { accountId: account.id } }),
    0,
  );
});

test("consulta de DELIVERY_ACK normalizado confirma entrega sem webhook ou observação e mantém replay monotônico", async () => {
  const f = await fixture();
  const account = await f.save("EVOLUTION");
  await verified(f, account);
  await f.op(account, {
    action: "sendTest",
    recipient: phone,
    confirmedTestNumber: true,
    requestId: randomUUID(),
  });
  const original = await db.avChannelTest.findFirstOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(original.state, "ACCEPTED");
  const config = await liveChannelConfiguration(account.id);
  // The provider adapter maps DELIVERY_ACK to ChannelDelivery.DELIVERED.
  const delivered = {
    externalId: `query:${randomUUID()}`,
    providerId: original.providerId!,
    recipient: phone,
    correlationId: `test:${original.id}`,
    state: "DELIVERED" as const,
  };
  let queries = 0;
  const queryFactory: ChannelManagementFactory = async (id) => ({
    ...(await f.management(id)),
    async consultStatus(correlationId) {
      queries++;
      assert.equal(correlationId, `test:${original.id}`);
      await recordChannelDelivery(
        await liveChannelConfiguration(id),
        delivered,
        "PROVIDER_QUERY",
      );
      return (
        (await recordedChannelReceipt(id, correlationId)) ?? {
          state: "UNCERTAIN",
          error: "NO_RECEIPT",
        }
      );
    },
  });
  const reconciled = await changeVirtualChannel(
    f.context,
    {
      storeId: f.unit.id,
      accountId: account.id,
      revision: account.revision,
      action: "reconcileTest",
    },
    queryFactory,
  );
  assert.equal(queries, 1);
  assert.ok("accounts" in reconciled);
  assert.equal(
    reconciled.accounts.find((item) => item.id === account.id)?.latestTest
      ?.state,
    "DELIVERED",
  );
  assert.equal(
    reconciled.accounts.find((item) => item.id === account.id)?.latestTest
      ?.observedAt,
    null,
  );
  await Promise.all([
    recordChannelDelivery(config, delivered, "PROVIDER_QUERY"),
    recordChannelDelivery(config, delivered, "PROVIDER_QUERY"),
  ]);
  const result = await db.avChannelTest.findUniqueOrThrow({
    where: { id: original.id },
  });
  assert.equal(result.state, "DELIVERED");
  assert.equal(result.providerId, original.providerId);
  assert.equal(result.acceptedAt?.getTime(), original.acceptedAt?.getTime());
  assert.ok(result.deliveredAt);
  assert.equal(result.observedAt, null);
  assert.equal(result.observedById, null);
  assert.equal(
    (
      await db.avChannelConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).webhookSeenAt,
    null,
  );
  const receipts = await db.avInboundEvent.findMany({
    where: { accountId: account.id, externalId: delivered.externalId },
  });
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].type, "DELIVERY");
  assert.equal(receipts[0].status, "PROCESSED");
  assert.equal(
    (receipts[0].payload as { source: string }).source,
    "PROVIDER_QUERY",
  );
  assert.equal(
    (receipts[0].payload as { revision: number }).revision,
    config.revision,
  );
  assert.equal(
    await db.avAuditEvent.count({
      where: {
        organizationId: f.organization.id,
        action: "CHANNEL_DELIVERY_QUERY_RECORDED",
      },
    }),
    1,
  );

  await recordChannelDelivery(
    config,
    { ...delivered, externalId: `query:${randomUUID()}`, state: "ACCEPTED" },
    "PROVIDER_QUERY",
  );
  const late = await db.avChannelTest.findUniqueOrThrow({
    where: { id: original.id },
  });
  assert.equal(late.state, "DELIVERED");
  assert.equal(late.deliveredAt?.getTime(), result.deliveredAt?.getTime());
  assert.equal(late.observedAt, null);
  assert.equal(
    (
      await db.avChannelConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).webhookSeenAt,
    null,
  );
  assert.equal(
    await db.avMessage.count({ where: { accountId: account.id } }),
    0,
  );
  assert.equal(f.sends(), 1);

  // Provenance does not alter the digest: a real replayed webhook can attest
  // its own reception without duplicating or downgrading the query receipt.
  await recordChannelDelivery(config, delivered);
  assert.ok(
    (
      await db.avChannelConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).webhookSeenAt,
  );
  assert.equal(
    await db.avInboundEvent.count({
      where: { accountId: account.id, externalId: delivered.externalId },
    }),
    1,
  );
});

test("consulta não promove teste com revisão antiga, outro providerId ou outro destinatário", async () => {
  const f = await fixture();
  const account = await f.save("EVOLUTION");
  await verified(f, account);
  await f.op(account, {
    action: "sendTest",
    recipient: phone,
    confirmedTestNumber: true,
    requestId: randomUUID(),
  });
  const row = await db.avChannelTest.findFirstOrThrow({
    where: { accountId: account.id },
  });
  const config = await liveChannelConfiguration(account.id);
  const receipt = {
    externalId: `query:${randomUUID()}`,
    providerId: row.providerId!,
    recipient: phone,
    correlationId: `test:${row.id}`,
    state: "DELIVERED" as const,
  };
  for (const extra of [
    { providerId: `unrelated:${randomUUID()}` },
    { recipient: "+12025550124" },
  ]) {
    await recordChannelDelivery(
      config,
      { ...receipt, ...extra, externalId: `query:${randomUUID()}` },
      "PROVIDER_QUERY",
    );
    const current = await db.avChannelTest.findUniqueOrThrow({
      where: { id: row.id },
    });
    assert.equal(current.state, "ACCEPTED");
    assert.equal(current.providerId, row.providerId);
    assert.equal(current.deliveredAt, null);
    assert.equal(current.observedAt, null);
  }
  const conflict = await db.avAuditEvent.findFirstOrThrow({
    where: {
      organizationId: f.organization.id,
      action: "CHANNEL_DELIVERY_CONFLICT",
    },
  });
  assert.equal(conflict.actorId, "CHANNEL_PROVIDER_QUERY");
  assert.equal((conflict.data as { source: string }).source, "PROVIDER_QUERY");
  const rotated = await f.save("EVOLUTION", {
    accountId: account.id,
    ...(account.settings as object),
  });
  assert.equal(rotated.revision, config.revision + 1);
  const oldId = `query:${randomUUID()}`;
  await recordChannelDelivery(
    config,
    { ...receipt, externalId: oldId },
    "PROVIDER_QUERY",
  );
  assert.equal(
    await db.avInboundEvent.count({
      where: { accountId: account.id, externalId: oldId },
    }),
    0,
  );
  await recordChannelDelivery(
    await liveChannelConfiguration(account.id),
    { ...receipt, externalId: `query:${randomUUID()}` },
    "PROVIDER_QUERY",
  );
  const unchanged = await db.avChannelTest.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(unchanged.state, "ACCEPTED");
  assert.equal(unchanged.deliveredAt, null);
  assert.equal(unchanged.observedAt, null);
  assert.equal(
    (
      await db.avChannelConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).webhookSeenAt,
    null,
  );
  assert.equal(f.sends(), 1);
});

test("serviço reconcilia query ERROR sem perder providerId nem converter falha de entrega em sucesso", async () => {
  const f = await fixture();
  const account = await f.save("EVOLUTION");
  await verified(f, account);
  await f.op(account, {
    action: "sendTest",
    recipient: phone,
    confirmedTestNumber: true,
    requestId: randomUUID(),
  });
  const row = await db.avChannelTest.findFirstOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(row.state, "ACCEPTED");
  let queries = 0;
  const queryFactory: ChannelManagementFactory = async (id) => ({
    ...(await f.management(id)),
    async consultStatus(correlationId) {
      queries++;
      assert.equal(correlationId, `test:${row.id}`);
      await recordChannelDelivery(
        await liveChannelConfiguration(id),
        {
          externalId: `query-error:${randomUUID()}`,
          providerId: row.providerId!,
          recipient: phone,
          correlationId,
          state: "FAILED",
        },
        "PROVIDER_QUERY",
      );
      return (
        (await recordedChannelReceipt(id, correlationId)) ?? {
          state: "UNCERTAIN",
          error: "NO_RECEIPT",
        }
      );
    },
  });
  const result = await changeVirtualChannel(
    f.context,
    {
      storeId: f.unit.id,
      accountId: account.id,
      revision: account.revision,
      action: "reconcileTest",
    },
    queryFactory,
  );
  assert.equal(queries, 1);
  assert.ok("accounts" in result);
  assert.equal(
    result.accounts.find((item) => item.id === account.id)?.latestTest?.state,
    "FAILED",
  );
  assert.deepEqual(await recordedChannelReceipt(account.id, `test:${row.id}`), {
    state: "ACCEPTED",
    providerId: row.providerId,
  });
  const failure = await db.avChannelTest.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(failure.state, "FAILED");
  assert.equal(failure.providerId, row.providerId);
  assert.equal(failure.error, "PROVIDER_DELIVERY_FAILED");
  assert.equal(failure.deliveredAt, null);
  assert.equal(failure.observedAt, null);
  const connection = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(connection.webhookSeenAt, null);
  assert.equal(connection.connectLeaseOwner, null);
  assert.equal(connection.connectLeaseUntil, null);
  const unaccepted = await db.avChannelTest.create({
    data: {
      ...scopeOf(f, account.id),
      revision: account.revision,
      actorId: f.actor.id,
      requestId: randomUUID(),
      encryptedRecipient: row.encryptedRecipient,
      recipientHash: row.recipientHash,
      state: "FAILED",
      error: "PROVIDER_HTTP_400",
    },
  });
  assert.equal(
    await recordedChannelReceipt(account.id, `test:${unaccepted.id}`),
    null,
  );
  const conversation = await db.avConversation.create({
    data: {
      ...scopeOf(f, account.id),
      externalCustomerId: phone,
      displayName: "Pessoa fictícia Kairu",
      agentEnabled: false,
    },
  });
  for (const providerId of [`outbox:${randomUUID()}`, null]) {
    const outbox = await db.avMessageOutbox.create({
      data: {
        ...scopeOf(f, account.id),
        conversationId: conversation.id,
        version: conversation.version,
        requestId: randomUUID(),
        author: "HUMAN",
        text: "Mensagem fictícia",
        state: "FAILED",
        providerId,
      },
    });
    assert.deepEqual(
      await recordedChannelReceipt(account.id, outbox.id),
      providerId ? { state: "ACCEPTED", providerId } : null,
    );
  }
  assert.equal(f.sends(), 1);
});

test("limite de turnos entre execuções interrompe bot-bot com pendência rastreável", async () => {
  const f = await fixture(),
    account = await f.save("EVOLUTION");
  await verified(f, account);
  await db.avChannelAccount.update({
    where: { id: account.id },
    data: { active: true },
  });
  const id = (await f.inbound(account)).conversationId!;
  await db.avConversation.update({
    where: { id },
    data: { processAfter: new Date(Date.now() - 1000) },
  });
  await db.avAgentRun.createMany({
    data: Array.from({ length: 30 }, () => ({
      ...scopeOf(f, account.id),
      conversationId: id,
      version: 1,
      leaseOwner: randomUUID(),
      status: "COMPLETED",
    })),
  });
  let called = false;
  await processVirtualQueue(async () => {
    called = true;
    return { text: "fixture", tokens: 0, costMicros: 0 };
  });
  assert.equal(called, false);
  assert.equal(
    (await db.avConversation.findUniqueOrThrow({ where: { id } })).lastError,
    "CONVERSATION_LOOP",
  );
  assert.equal(
    await db.avEscalation.count({
      where: { conversationId: id, status: "OPEN" },
    }),
    1,
  );
});
