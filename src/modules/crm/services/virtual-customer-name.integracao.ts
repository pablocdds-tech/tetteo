import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, afterEach } from "node:test";
import { db } from "@/server/db";
import { safeVirtualCustomerName } from "@/server/atendimento-nome";
import type {
  ChannelContactNamesResult,
  ChannelManagementFactory,
} from "@/server/atendimento-provedor";
import { CrmError, protectIdentity } from "./campaign-domain";
import {
  resolveVirtualCustomerName,
  type VirtualCustomerNameInput,
} from "./virtual-customer-name";
import { receiveVirtualInbound, processVirtualQueue } from "./virtual-runtime";
import { runVirtualAgent } from "./virtual-agent";
import {
  ensureVirtualDemoKnowledge,
  relativeVirtualDate,
} from "./virtual-knowledge";
import { executeVirtualTool, newPendingReservation } from "./virtual-tools";
import type { VirtualTurnInput } from "../virtual-types";
import { applyVirtualCustomerName } from "./virtual-name-state";
import { processVirtualNameLookups } from "./virtual-name-worker";

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
const old = new Date("2026-01-01T12:00:00.000Z");
const hint = (name: string) => ({ name, updatedAt: old });
async function fixture(mode = "EVOLUTION") {
  const organization = await db.organizacao.create({
    data: { nome: "Nomes fictícios Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Unidade fictícia",
      codigo: "NOME",
    },
  });
  const account = await db.avChannelAccount.create({
    data: {
      organizationId: organization.id,
      storeId: unit.id,
      name: "Canal fictício Kairu",
      mode,
      active: false,
    },
  });
  accounts.push(account.id);
  const scope = {
    organizationId: organization.id,
    storeId: unit.id,
    accountId: account.id,
  };
  const senderKey = mode === "DEMO" ? "demo:nomes" : phone;
  const resolve = (extra: Partial<VirtualCustomerNameInput> = {}) =>
    db.$transaction((tx) =>
      resolveVirtualCustomerName(tx, { ...scope, senderKey, ...extra }),
    );
  const contact = (name: string, value: string | null = null) =>
    db.crmContact.create({
      data: {
        storeId: unit.id,
        name,
        phone: value,
        notes: "NOTAS_PRIVADAS_FICTICIAS",
        email: "privado@example.invalid",
      },
    });
  const verify = (
    contactId: string,
    type = mode === "DEMO"
      ? `AV_DEMO:${account.id}`
      : `AV_CHANNEL:${account.id}`,
    value = senderKey,
    extra = {},
  ) =>
    db.crmIdentity.create({
      data: {
        storeId: unit.id,
        contactId,
        type,
        ...protectIdentity(unit.id, type, value),
        verifiedAt: new Date(),
        verifiedById: "fixture:gestor",
        ...extra,
      },
    });
  const alias = (value: string) =>
    db.avCustomerPreference.create({
      data: {
        ...scope,
        externalCustomerId: senderKey,
        key: "name",
        value,
        source: "CUSTOMER",
      },
    });
  return {
    organization,
    unit,
    account,
    scope,
    senderKey,
    resolve,
    contact,
    verify,
    alias,
  };
}

async function lookupFixture() {
  const f = await fixture();
  await db.avChannelConnection.create({
    data: {
      ...f.scope,
      encryptedCredentials: "fake-not-used-by-test-adapter",
      settings: { url: "http://127.0.0.1:9", instance: "fixture" },
      bindingKey: randomUUID(),
      connectionState: "VERIFIED",
      verifiedAt: new Date(),
      verifiedRevision: 1,
    },
  });
  const conversation = await db.avConversation.create({
    data: {
      ...f.scope,
      externalCustomerId: f.senderKey,
      displayName: "Cliente sem cadastro",
      agentEnabled: false,
      status: "PAUSED",
      version: 8,
    },
  });
  let reads = 0;
  let reader: () => Promise<ChannelContactNamesResult> = async () => ({
    trustedPhone: phone,
    names: [
      {
        name: "Ana contato",
        source: "PROVIDER_CONTACT",
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  const noEffect = async (): Promise<never> => {
    throw new Error("Consulta de nome não executa efeitos do canal.");
  };
  const factory: ChannelManagementFactory = async (accountId) => ({
    identify: () => ({ mode: "EVOLUTION", accountKey: accountId, revision: 1 }),
    verify: noEffect,
    qr: noEffect,
    webhook: noEffect,
    sendText: noEffect,
    sendMedia: noEffect,
    consultStatus: noEffect,
    lookupContactNames: async () => {
      reads++;
      return reader();
    },
  });
  return {
    ...f,
    conversation,
    reads: () => reads,
    setReader: (value: typeof reader) => {
      reader = value;
    },
    run: () => processVirtualNameLookups(factory, f.account.id),
    current: () =>
      db.avConversation.findUniqueOrThrow({ where: { id: conversation.id } }),
  };
}

async function noLookupEffects(f: Awaited<ReturnType<typeof lookupFixture>>) {
  assert.equal(await db.avMessage.count({ where: f.scope }), 0);
  assert.equal(await db.avMessageOutbox.count({ where: f.scope }), 0);
  assert.equal(await db.avAgentRun.count({ where: f.scope }), 0);
  assert.equal(await db.avReservation.count({ where: f.scope }), 0);
  assert.equal(
    await db.crmIdentity.count({ where: { storeId: f.unit.id } }),
    0,
  );
  assert.equal((await f.current()).processAfter, null);
}

test("nomes unicode são dados limitados; links, telefones, credenciais e placeholders não viram nome", () => {
  for (const name of [
    "A",
    "José da Silva",
    "李 明",
    "Ana 🍕",
    "D'Ávila",
    "João-Pedro",
  ])
    assert.equal(safeVirtualCustomerName(name), name);
  assert.equal(safeVirtualCustomerName("  João\nSilva\u202e "), "João Silva");
  for (const value of [
    "https://example.invalid",
    "www.example.invalid",
    "example.com",
    "+1 (202) 555-0123",
    "senha=FICTICIA",
    "Bearer FAKE_TOKEN",
    "<script>x</script>",
    "Cliente sem cadastro",
    "12345",
    "A".repeat(101),
    null,
  ])
    assert.equal(safeVirtualCustomerName(value), null);
});

test("conta e remetente são vinculados ao escopo antes de consultar nomes", async () => {
  const f = await fixture(),
    other = await fixture();
  await assert.rejects(
    f.resolve({ organizationId: other.organization.id }),
    /Conta indisponível/,
  );
  await assert.rejects(
    f.resolve({ storeId: other.unit.id }),
    /Conta indisponível/,
  );
  await assert.rejects(
    f.resolve({ accountId: other.account.id }),
    /Conta indisponível/,
  );
  for (const senderKey of [
    "2025550123",
    "123@lid",
    "grupo@g.us",
    "Meu telefone é +12025550123",
    "demo:nomes",
  ])
    await assert.rejects(f.resolve({ senderKey }), /remetente confiável/);
  const demo = await fixture("DEMO");
  await assert.rejects(
    demo.resolve({ senderKey: phone }),
    /remetente confiável/,
  );
});

test("correção explícita vence CRM, agenda e evento antigo sem alterar o cadastro", async () => {
  const f = await fixture();
  const crm = await f.contact("Ana CRM", phone);
  await f.verify(crm.id);
  const pref = await f.alias("Bia");
  const resolved = await f.resolve({
    channelContact: { ...hint("Ana agenda"), source: "DEVICE_CONTACT" },
    whatsappNickname: hint("Ana perfil"),
    historicalName: hint("Ana antiga"),
  });
  assert.equal(resolved.name, "Bia");
  assert.equal(resolved.source, "CUSTOMER_CORRECTION");
  assert.equal(resolved.updatedAt?.getTime(), pref.updatedAt.getTime());
  assert.equal(resolved.known, true);
  assert.equal(resolved.contactId, crm.id);
  assert.equal(resolved.canGreet, true);
  assert.equal(resolved.needsConfirmation, false);
  assert.equal(
    (await db.crmContact.findUniqueOrThrow({ where: { id: crm.id } })).name,
    "Ana CRM",
  );
});

test("CRM verificado vence pistas e retorna somente contexto mínimo de nome", async () => {
  const f = await fixture();
  const crm = await f.contact("Ana verificada", phone);
  await f.verify(crm.id, "PHONE", phone.slice(1));
  const resolved = await f.resolve({
    channelContact: { ...hint("Agenda"), source: "DEVICE_CONTACT" },
    whatsappNickname: hint("Nickname"),
  });
  assert.equal(resolved.name, "Ana verificada");
  assert.equal(resolved.source, "CRM_VERIFIED");
  assert.equal(resolved.contactId, crm.id);
  assert.equal(resolved.known, true);
  assert.equal(resolved.canGreet, true);
  assert.equal(resolved.updatedAt?.getTime(), crm.updatedAt.getTime());
  assert.doesNotMatch(
    JSON.stringify(resolved),
    /NOTAS_PRIVADAS|privado@example|encryptedValue|normalizedHash/,
  );
  assert.deepEqual(
    Object.keys(resolved).sort(),
    [
      "name",
      "source",
      "updatedAt",
      "known",
      "contactId",
      "needsConfirmation",
      "canGreet",
    ].sort(),
  );
});

test("agenda exata vence CRM sem prova e distingue aparelho de contato do provedor", async () => {
  const f = await fixture();
  await f.contact("CRM sem verificação", phone);
  for (const source of ["DEVICE_CONTACT", "PROVIDER_CONTACT"] as const) {
    const resolved = await f.resolve({
      channelContact: { ...hint("Ana agenda"), source },
      whatsappNickname: hint("Perfil"),
    });
    assert.equal(resolved.name, "Ana agenda");
    assert.equal(resolved.source, source);
    assert.equal(resolved.known, false);
    assert.equal(resolved.contactId, null);
    assert.equal(resolved.canGreet, true);
    assert.equal(resolved.updatedAt?.getTime(), old.getTime());
  }
});

test("cadastro único por telefone é só pista e não concede identidade ou contexto privado", async () => {
  const f = await fixture();
  await f.contact("Nome do cadastro", phone.slice(1));
  const resolved = await f.resolve();
  assert.equal(resolved.name, "Nome do cadastro");
  assert.equal(resolved.source, "CRM_PHONE_HINT");
  assert.equal(resolved.known, false);
  assert.equal(resolved.contactId, null);
  assert.equal(resolved.canGreet, false);
  assert.equal(resolved.needsConfirmation, true);
  assert.doesNotMatch(
    JSON.stringify(resolved),
    /NOTAS_PRIVADAS|privado@example|reservations|preferences/,
  );
  assert.equal(
    await db.crmIdentity.count({ where: { storeId: f.unit.id } }),
    0,
  );
});

test("perfil válido vence pista CRM não verificada sem repetir nome ou promover identidade", async () => {
  const f = await fixture();
  await f.contact("Nome de cadastro sem prova", phone);
  const resolved = await f.resolve({
    whatsappNickname: hint("Nome atual do perfil"),
  });
  assert.equal(resolved.name, "Nome atual do perfil");
  assert.equal(resolved.source, "WHATSAPP_PROFILE");
  assert.equal(resolved.canGreet, true);
  assert.equal(resolved.needsConfirmation, false);
  assert.equal(resolved.known, false);
  assert.equal(resolved.contactId, null);
  assert.equal(
    await db.crmIdentity.count({ where: { storeId: f.unit.id } }),
    0,
  );
});

test("nickname precede histórico e número mascarado substitui nomes vazios", async () => {
  const f = await fixture();
  assert.deepEqual(
    await f.resolve({
      whatsappNickname: hint("Ana perfil"),
      historicalName: hint("Antiga"),
    }),
    {
      name: "Ana perfil",
      source: "WHATSAPP_PROFILE",
      updatedAt: old,
      known: false,
      contactId: null,
      needsConfirmation: false,
      canGreet: true,
    },
  );
  assert.equal(
    (await f.resolve({ historicalName: hint("Nome histórico") })).source,
    "HISTORY",
  );
  const fallback = await f.resolve({
    whatsappNickname: hint("Cliente sem cadastro"),
    historicalName: hint(phone),
  });
  assert.equal(fallback.source, "UNKNOWN");
  assert.equal(fallback.name, "Cliente •••• 0123");
  assert.equal(fallback.canGreet, false);
  assert.equal(fallback.updatedAt, null);
  assert.ok(!fallback.name.includes(phone));
});

test("nomes iguais e pistas de outra conta ou unidade nunca vinculam cadastro", async () => {
  const f = await fixture(),
    other = await fixture();
  const crm = await other.contact("Ana", phone);
  await other.verify(crm.id, "PHONE", phone);
  await other.alias("Nome estrangeiro");
  const second = await db.avChannelAccount.create({
    data: {
      organizationId: f.organization.id,
      storeId: f.unit.id,
      name: "Outra conta fictícia",
      mode: "EVOLUTION",
      active: false,
    },
  });
  accounts.push(second.id);
  await db.avCustomerPreference.create({
    data: {
      ...f.scope,
      accountId: second.id,
      externalCustomerId: phone,
      key: "name",
      value: "Alias de outra conta",
    },
  });
  const local = await f.contact("Ana", "+12025550124");
  await f.verify(local.id, `AV_CHANNEL:${second.id}`, phone);
  const resolved = await f.resolve({ whatsappNickname: hint("Ana") });
  assert.equal(resolved.name, "Ana");
  assert.equal(resolved.source, "WHATSAPP_PROFILE");
  assert.equal(resolved.contactId, null);
  assert.equal(resolved.known, false);
});

test("cadastros ambíguos ou provas conflitantes recusam todas as identidades CRM", async () => {
  const f = await fixture();
  const first = await f.contact("Ana", phone),
    second = await f.contact("Bia", phone.slice(1));
  await f.verify(first.id);
  await f.verify(second.id, "PHONE", phone);
  const resolved = await f.resolve({
    channelContact: { ...hint("Nome agenda"), source: "DEVICE_CONTACT" },
  });
  assert.equal(resolved.name, "Nome agenda");
  assert.equal(resolved.known, false);
  assert.equal(resolved.contactId, null);
  assert.equal(resolved.needsConfirmation, true);
  assert.equal(resolved.canGreet, false);
  await f.alias("Nome confirmado");
  const corrected = await f.resolve();
  assert.equal(corrected.name, "Nome confirmado");
  assert.equal(corrected.source, "CUSTOMER_CORRECTION");
  assert.equal(corrected.known, false);
  assert.equal(corrected.contactId, null);
  assert.equal(corrected.canGreet, true);
});

test("prova futura, sem responsável, inativa ou fundida não é identidade confiável", async () => {
  for (const kind of ["future", "blank", "inactive", "merged"] as const) {
    const f = await fixture();
    const crm = await f.contact("Nome protegido");
    await f.verify(
      crm.id,
      "PHONE",
      phone,
      kind === "future"
        ? { verifiedAt: new Date(Date.now() + 60000) }
        : kind === "blank"
          ? { verifiedById: "   " }
          : {},
    );
    if (kind === "inactive")
      await db.crmContact.update({
        where: { id: crm.id },
        data: { active: false },
      });
    if (kind === "merged") {
      const destination = await f.contact("Destino protegido");
      await db.crmContact.update({
        where: { id: crm.id },
        data: { mergedIntoId: destination.id },
      });
    }
    const resolved = await f.resolve({
      whatsappNickname: hint("Perfil válido"),
    });
    assert.equal(resolved.source, "WHATSAPP_PROFILE", kind);
    assert.equal(resolved.contactId, null, kind);
    assert.equal(resolved.known, false, kind);
  }
});

test("telefone internacional é exato e não há inferência de nono dígito brasileiro", async () => {
  const f = await fixture();
  await f.contact("Número brasileiro antigo", "551198765432");
  assert.equal(
    (await f.resolve({ senderKey: "+5511998765432" })).source,
    "UNKNOWN",
  );
  assert.equal((await f.resolve()).source, "UNKNOWN");
  await f.contact("Internacional exato", phone.slice(1));
  assert.equal((await f.resolve()).source, "CRM_PHONE_HINT");
});

test("alias inseguro é ignorado sem escrita nem elevação de confiança", async () => {
  const f = await fixture();
  await f.alias("senha=FICTICIA");
  const resolved = await f.resolve({ whatsappNickname: hint("Bia") });
  assert.equal(resolved.source, "WHATSAPP_PROFILE");
  assert.equal(resolved.name, "Bia");
  assert.equal(resolved.known, false);
  assert.equal(
    await db.crmIdentity.count({ where: { storeId: f.unit.id } }),
    0,
  );
  assert.equal(await db.crmContact.count({ where: { storeId: f.unit.id } }), 0);
  assert.equal(
    (await db.avCustomerPreference.findFirstOrThrow({ where: f.scope })).value,
    "senha=FICTICIA",
  );
});

test("nome do perfil preenche a reserva sem repetir pergunta e só confirmação final cria o objeto", async () => {
  const f = await fixture("DEMO");
  await db.avChannelAccount.update({
    where: { id: f.account.id },
    data: { active: true },
  });
  await db.$transaction((tx) =>
    ensureVirtualDemoKnowledge(tx, f.scope, "fixture:gestor"),
  );
  const inbound = (text: string) =>
    receiveVirtualInbound(f.account.id, {
      externalId: randomUUID(),
      senderKey: f.senderKey,
      type: "MESSAGE",
      text,
    });
  const id = (await inbound("Quero reservar amanhã às 19h para 4 pessoas"))
    .conversationId!;
  await db.avConversation.update({
    where: { id },
    data: {
      displayName: "Ana perfil",
      nameSource: "WHATSAPP_PROFILE",
      nameUpdatedAt: old,
      nameNeedsConfirmation: false,
      nameUsableForReservation: true,
      channelNames: {
        profile: { name: "Ana perfil", updatedAt: old.toISOString() },
      },
      processAfter: new Date(Date.now() - 1000),
    },
  });
  await processVirtualQueue(runVirtualAgent);
  const conversation = await db.avConversation.findUniqueOrThrow({
    where: { id },
  });
  assert.equal(conversation.contactId, null);
  const state = conversation.state as { pending?: { guestName: string } };
  assert.equal(state.pending?.guestName, "Ana perfil");
  assert.equal(
    await db.avReservation.count({ where: { conversationId: id } }),
    0,
  );
  const draft = (
    await db.avMessage.findFirstOrThrow({
      where: { conversationId: id, author: "AGENT" },
      orderBy: { sequence: "desc" },
    })
  ).text;
  assert.match(draft, /Ana perfil/);
  assert.doesNotMatch(draft, /qual (?:é )?(?:o )?nome/i);
  await inbound("confirmo");
  await db.avConversation.update({
    where: { id },
    data: { processAfter: new Date(Date.now() - 1000) },
  });
  await processVirtualQueue(runVirtualAgent);
  assert.equal(
    await db.avReservation.count({
      where: { conversationId: id, status: "CONFIRMED" },
    }),
    1,
  );
  await inbound("Meu nome é Bia");
  await db.avConversation.update({
    where: { id },
    data: { processAfter: new Date(Date.now() - 1000) },
  });
  await processVirtualQueue(runVirtualAgent);
  const corrected = await db.avConversation.findUniqueOrThrow({
    where: { id },
  });
  assert.equal(corrected.displayName, "Bia");
  assert.equal(corrected.nameSource, "CUSTOMER_CORRECTION");
  assert.equal(corrected.contactId, null);
  assert.equal((await f.resolve()).known, false);
});

test("cache conserva perfil mais novo e controle humano; correção explícita vence consulta posterior", async () => {
  const f = await fixture();
  const recent = new Date(Date.now() - 60000);
  const conversation = await db.avConversation.create({
    data: {
      ...f.scope,
      externalCustomerId: f.senderKey,
      displayName: "Cliente sem cadastro",
      status: "PAUSED",
      agentEnabled: false,
      version: 9,
      state: { preservar: "estado humano" },
      channelNames: {
        profile: { name: "Perfil atual", updatedAt: recent.toISOString() },
      },
    },
  });
  await db.$transaction((tx) =>
    applyVirtualCustomerName(tx, conversation, {
      profileName: "Perfil antigo",
      profileObservedAt: old.toISOString(),
    }),
  );
  const current = await db.avConversation.findUniqueOrThrow({
    where: { id: conversation.id },
  });
  assert.equal(current.displayName, "Perfil atual");
  assert.equal(current.nameSource, "WHATSAPP_PROFILE");
  assert.equal(current.nameUpdatedAt?.getTime(), recent.getTime());
  assert.equal(current.nameUsableForReservation, true);
  assert.equal(current.contactId, null);
  assert.equal(current.status, "PAUSED");
  assert.equal(current.agentEnabled, false);
  assert.equal(current.version, 9);
  assert.deepEqual(current.state, conversation.state);
  assert.equal(current.pendingSince, null);
  assert.equal(current.processAfter, null);
  await f.alias("Bia corrigida");
  await db.$transaction((tx) =>
    applyVirtualCustomerName(tx, current, undefined, [
      {
        name: "Agenda posterior",
        source: "DEVICE_CONTACT",
        updatedAt: new Date().toISOString(),
      },
    ]),
  );
  const corrected = await db.avConversation.findUniqueOrThrow({
    where: { id: conversation.id },
  });
  assert.equal(corrected.displayName, "Bia corrigida");
  assert.equal(corrected.nameSource, "CUSTOMER_CORRECTION");
  assert.equal(corrected.nameNeedsConfirmation, false);
  assert.equal(corrected.contactId, null);
  const audits = await db.avAuditEvent.findMany({
    where: { conversationId: conversation.id },
    select: { data: true },
  });
  assert.equal(audits.length, 2);
  assert.doesNotMatch(
    JSON.stringify(audits),
    /Bia corrigida|Perfil atual|Agenda posterior|12025550123/,
  );
});

test("cache rejeita nome inseguro e timestamp futuro sem transformar fallback em identidade", async () => {
  const f = await fixture();
  const conversation = await db.avConversation.create({
    data: {
      ...f.scope,
      externalCustomerId: f.senderKey,
      displayName: "Cliente sem cadastro",
      agentEnabled: false,
    },
  });
  const resolved = await db.$transaction((tx) =>
    applyVirtualCustomerName(
      tx,
      conversation,
      {
        profileName: "Nome futuro",
        profileObservedAt: new Date(Date.now() + 3600000).toISOString(),
      },
      [
        {
          name: "senha=FICTICIA",
          source: "DEVICE_CONTACT",
          updatedAt: new Date().toISOString(),
        },
      ],
    ),
  );
  assert.equal(resolved.source, "UNKNOWN");
  assert.equal(resolved.canGreet, false);
  assert.equal(resolved.known, false);
  const current = await db.avConversation.findUniqueOrThrow({
    where: { id: conversation.id },
  });
  assert.deepEqual(current.channelNames, {});
  assert.equal(current.nameUsableForReservation, false);
  assert.equal(current.contactId, null);
  assert.equal(
    await db.crmIdentity.count({ where: { storeId: f.unit.id } }),
    0,
  );
});

test("consulta durável em conta inativa tem um dono entre duas réplicas e não agenda atendimento", async () => {
  const f = await lookupFixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.setReader(async () => {
    entered();
    await waiting;
    return {
      trustedPhone: phone,
      names: [
        {
          name: "Ana agenda",
          source: "DEVICE_CONTACT",
          updatedAt: new Date().toISOString(),
        },
      ],
    };
  });
  const first = f.run();
  await started;
  try {
    assert.equal(await f.run(), 0);
    assert.equal(f.reads(), 1);
  } finally {
    release();
    await first;
  }
  const current = await f.current();
  assert.equal(current.displayName, "Ana agenda");
  assert.equal(current.nameSource, "DEVICE_CONTACT");
  assert.equal(current.contactId, null);
  assert.equal(current.status, "PAUSED");
  assert.equal(current.agentEnabled, false);
  assert.equal(current.version, 8);
  assert.equal(current.nameLookupRevision, 1);
  assert.equal(current.nameLookupLeaseOwner, null);
  assert.equal(current.nameLookupAttempts, 0);
  await noLookupEffects(f);
});

test("consulta recusa outro remetente e revisão alterada durante HTTP sem registrar resposta antiga", async () => {
  for (const kind of ["phone", "revision"] as const) {
    const f = await lookupFixture();
    f.setReader(async () => {
      if (kind === "revision")
        await db.avChannelConnection.update({
          where: { accountId: f.account.id },
          data: {
            revision: 2,
            connectionState: "PENDING",
            verifiedRevision: null,
            verifiedAt: null,
          },
        });
      return {
        trustedPhone: kind === "phone" ? "+12025550124" : phone,
        names: [
          {
            name: "Nome que não deve entrar",
            source: "DEVICE_CONTACT",
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    });
    assert.equal(await f.run(), 0, kind);
    const current = await f.current();
    assert.equal(current.displayName, "Cliente sem cadastro", kind);
    assert.equal(current.nameSource, "UNKNOWN", kind);
    assert.ok(current.nameLookupError, kind);
    assert.equal(current.nameLookupLeaseOwner, null, kind);
    await noLookupEffects(f);
  }
});

test("correção do cliente durante consulta vence agenda devolvida mais tarde", async () => {
  const f = await lookupFixture();
  f.setReader(async () => {
    await f.alias("Bia corrigida durante consulta");
    return {
      trustedPhone: phone,
      names: [
        {
          name: "Ana agenda atrasada",
          source: "PROVIDER_CONTACT",
          updatedAt: new Date().toISOString(),
        },
      ],
    };
  });
  assert.equal(await f.run(), 1);
  const current = await f.current();
  assert.equal(current.displayName, "Bia corrigida durante consulta");
  assert.equal(current.nameSource, "CUSTOMER_CORRECTION");
  assert.equal(current.contactId, null);
  assert.equal(current.nameUsableForReservation, true);
  await noLookupEffects(f);
});

test("resposta de lease substituído não altera nome nem limpa trabalho de outra réplica", async () => {
  const f = await lookupFixture();
  f.setReader(async () => {
    await db.avConversation.update({
      where: { id: f.conversation.id },
      data: {
        nameLookupLeaseOwner: "outro-worker",
        nameLookupLeaseUntil: new Date(Date.now() + 60000),
        displayName: "Nome preservado",
        nameSource: "HISTORY",
      },
    });
    return {
      trustedPhone: phone,
      names: [
        {
          name: "Resposta antiga",
          source: "DEVICE_CONTACT",
          updatedAt: new Date().toISOString(),
        },
      ],
    };
  });
  assert.equal(await f.run(), 0);
  const current = await f.current();
  assert.equal(current.displayName, "Nome preservado");
  assert.equal(current.nameLookupLeaseOwner, "outro-worker");
  assert.equal(current.nameLookupError, null);
  await noLookupEffects(f);
});

test("timeout respeita backoff e três tentativas; erro e auditoria não revelam corpo ou segredo", async () => {
  const f = await lookupFixture();
  f.setReader(async () => {
    throw new Error("timeout token=SEGREDO_FICTICIO corpo=CONTEUDO_PRIVADO");
  });
  await f.run();
  assert.equal(f.reads(), 1);
  await f.run();
  assert.equal(f.reads(), 1, "Backoff deve impedir nova chamada imediata.");
  for (let attempt = 0; attempt < 3; attempt++) {
    await db.avConversation.update({
      where: { id: f.conversation.id },
      data: { nameLookupAfter: new Date(Date.now() - 1000) },
    });
    await f.run();
  }
  const current = await f.current();
  assert.equal(f.reads(), 3);
  assert.equal(current.nameLookupAttempts, 3);
  assert.doesNotMatch(
    JSON.stringify(current),
    /SEGREDO_FICTICIO|CONTEUDO_PRIVADO/,
  );
  assert.equal(current.contactId, null);
  await noLookupEffects(f);
});

test("webhook autenticado reaproveita perfil e evento antigo não desfaz correção do cliente", async () => {
  const f = await lookupFixture();
  const now = new Date().toISOString();
  await receiveVirtualInbound(
    f.account.id,
    {
      externalId: `message:${randomUUID()}`,
      senderKey: phone,
      trustedPhone: phone,
      type: "MESSAGE",
      text: "Oi",
      occurredAt: now,
      profileName: "Ana perfil recebido",
      profileObservedAt: now,
    },
    { provider: "EVOLUTION", revision: 1 },
  );
  assert.equal((await f.current()).displayName, "Ana perfil recebido");
  assert.equal((await f.current()).nameSource, "WHATSAPP_PROFILE");
  await f.alias("Bia corrigida");
  await receiveVirtualInbound(
    f.account.id,
    {
      externalId: `message:${randomUUID()}`,
      senderKey: phone,
      trustedPhone: phone,
      type: "MESSAGE",
      text: "Outra mensagem",
      occurredAt: new Date().toISOString(),
      profileName: "Ana de evento antigo",
      profileObservedAt: old.toISOString(),
    },
    { provider: "EVOLUTION", revision: 1 },
  );
  const current = await f.current();
  assert.equal(current.displayName, "Bia corrigida");
  assert.equal(current.nameSource, "CUSTOMER_CORRECTION");
  assert.equal(current.contactId, null);
  assert.equal(current.agentEnabled, false);
  assert.equal(await db.avMessageOutbox.count({ where: f.scope }), 0);
  assert.equal(await db.avReservation.count({ where: f.scope }), 0);
});

test("ferramenta entrega pista CRM sem dados privados e correção não a promove a cadastro conhecido", async () => {
  const f = await lookupFixture();
  await f.contact("Nome sem prova", phone);
  await db.$transaction((tx) => applyVirtualCustomerName(tx, f.conversation));
  await db.avChannelAccount.update({
    where: { id: f.account.id },
    data: { active: true },
  });
  const owner = randomUUID();
  const conversation = await db.avConversation.update({
    where: { id: f.conversation.id },
    data: {
      status: "OPEN",
      agentEnabled: true,
      leaseOwner: owner,
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  const run = await db.avAgentRun.create({
    data: {
      ...f.scope,
      conversationId: conversation.id,
      version: conversation.version,
      leaseOwner: owner,
    },
  });
  const input: VirtualTurnInput = {
    ...f.scope,
    conversationId: conversation.id,
    contactId: null,
    senderKey: phone,
    runId: run.id,
    version: conversation.version,
    leaseOwner: owner,
    timezone: "America/Sao_Paulo",
    customerName: conversation.displayName,
    summary: null,
    state: {},
    messages: [],
    limits: { maxTokens: 4000, maxCostMicros: 100000, timeoutMs: 10000 },
    now: new Date(),
  };
  const result = await executeVirtualTool(
    input,
    "buscar_cliente",
    {},
    randomUUID(),
  );
  const data = result.data as {
    known: boolean;
    name: string;
    nameSource: string;
    nameNeedsConfirmation: boolean;
    nameUsableForReservation: boolean;
  };
  assert.equal(result.success, true);
  assert.equal(result.id, undefined);
  assert.equal(data.name, "Nome sem prova");
  assert.equal(data.nameSource, "CRM_PHONE_HINT");
  assert.equal(data.known, false);
  assert.equal(data.nameNeedsConfirmation, true);
  assert.equal(data.nameUsableForReservation, false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /NOTAS_PRIVADAS|privado@example|encryptedValue|normalizedHash/,
  );
  await executeVirtualTool(
    input,
    "registrar_preferencia",
    { key: "name", value: "Bia explícita" },
    randomUUID(),
  );
  const corrected = await executeVirtualTool(
    input,
    "buscar_cliente",
    {},
    randomUUID(),
  );
  assert.equal((corrected.data as { name: string }).name, "Bia explícita");
  assert.equal((corrected.data as { known: boolean }).known, false);
  assert.equal((await f.current()).contactId, null);
  assert.equal(
    await db.crmIdentity.count({ where: { storeId: f.unit.id } }),
    0,
  );
});

test("nome inseguro em resumo legado não cria reserva nem reaparece na resposta de confirmação", async () => {
  const f = await fixture("DEMO");
  await db.avChannelAccount.update({
    where: { id: f.account.id },
    data: { active: true },
  });
  await db.$transaction((tx) =>
    ensureVirtualDemoKnowledge(tx, f.scope, "fixture:gestor"),
  );
  const id = (
    await receiveVirtualInbound(f.account.id, {
      externalId: randomUUID(),
      senderKey: f.senderKey,
      type: "MESSAGE",
      text: "confirmo",
    })
  ).conversationId!;
  const pending = newPendingReservation({
    type: "create",
    date: relativeVirtualDate("amanhã", new Date(), "America/Sao_Paulo"),
    time: "19:00",
    partySize: 4,
    guestName: "https://example.invalid",
  });
  await db.avConversation.update({
    where: { id },
    data: { state: { pending }, processAfter: new Date(Date.now() - 1000) },
  });
  await processVirtualQueue(runVirtualAgent);
  assert.equal(
    await db.avReservation.count({ where: { conversationId: id } }),
    0,
  );
  const reply = (
    await db.avMessage.findFirstOrThrow({
      where: { conversationId: id, author: "AGENT" },
      orderBy: { sequence: "desc" },
    })
  ).text;
  assert.doesNotMatch(reply, /https:\/\/example.invalid|reserva confirmada/i);
  assert.match(reply, /nome/i);
});

test("mudança de identidade cerca turno antigo e alias não restaura acesso ao CRM anterior", async () => {
  const f = await lookupFixture();
  const crm = await f.contact("Nome verificado anterior", phone);
  const proof = await f.verify(crm.id, "PHONE", phone);
  await db.$transaction((tx) => applyVirtualCustomerName(tx, f.conversation));
  await db.avChannelAccount.update({
    where: { id: f.account.id },
    data: { active: true },
  });
  const owner = randomUUID();
  const before = await db.avConversation.update({
    where: { id: f.conversation.id },
    data: {
      status: "OPEN",
      agentEnabled: true,
      leaseOwner: owner,
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  const run = await db.avAgentRun.create({
    data: {
      ...f.scope,
      conversationId: before.id,
      version: before.version,
      leaseOwner: owner,
    },
  });
  const input: VirtualTurnInput = {
    ...f.scope,
    conversationId: before.id,
    contactId: crm.id,
    senderKey: phone,
    runId: run.id,
    version: before.version,
    leaseOwner: owner,
    timezone: "America/Sao_Paulo",
    customerName: before.displayName,
    summary: null,
    state: {},
    messages: [],
    limits: { maxTokens: 4000, maxCostMicros: 100000, timeoutMs: 10000 },
    now: new Date(),
  };
  await db.crmIdentity.update({
    where: { id: proof.id },
    data: { verifiedAt: new Date(Date.now() + 60000) },
  });
  await db.$transaction((tx) => applyVirtualCustomerName(tx, before));
  const after = await f.current();
  assert.equal(after.contactId, null);
  assert.equal(after.version, before.version + 1);
  assert.equal(after.leaseOwner, null);
  assert.equal(after.status, before.status);
  assert.equal(after.agentEnabled, before.agentEnabled);
  const stale = (error: unknown) =>
    error instanceof CrmError && error.code === "STALE_TURN";
  await assert.rejects(
    executeVirtualTool(input, "buscar_cliente", {}, randomUUID()),
    stale,
  );
  const nextOwner = randomUUID();
  const current = await db.avConversation.update({
    where: { id: before.id },
    data: { leaseOwner: nextOwner, leaseUntil: new Date(Date.now() + 60000) },
  });
  const nextRun = await db.avAgentRun.create({
    data: {
      ...f.scope,
      conversationId: current.id,
      version: current.version,
      leaseOwner: nextOwner,
    },
  });
  const staleContact = {
    ...input,
    runId: nextRun.id,
    version: current.version,
    leaseOwner: nextOwner,
  };
  await f.alias("Bia explícita");
  await db.$transaction((tx) => applyVirtualCustomerName(tx, current));
  await assert.rejects(
    executeVirtualTool(staleContact, "buscar_cliente", {}, randomUUID()),
    stale,
  );
  await assert.rejects(
    executeVirtualTool(
      staleContact,
      "criar_reserva",
      { confirmationToken: randomUUID() },
      randomUUID(),
    ),
    stale,
  );
  const result = await executeVirtualTool(
    { ...staleContact, contactId: null },
    "buscar_cliente",
    {},
    randomUUID(),
  );
  assert.equal(result.id, undefined);
  assert.equal((result.data as { known: boolean }).known, false);
  assert.equal((result.data as { name: string }).name, "Bia explícita");
  assert.equal(await db.avReservation.count({ where: f.scope }), 0);
  assert.doesNotMatch(JSON.stringify(result), /NOTAS_PRIVADAS|privado@example/);
});

test("telefone mascarado continua fallback após resolver o cache novamente", async () => {
  const f = await fixture();
  assert.equal(safeVirtualCustomerName("Cliente •••• 0123"), null);
  assert.equal(safeVirtualCustomerName("Cliente Feliz"), "Cliente Feliz");
  const conversation = await db.avConversation.create({
    data: {
      ...f.scope,
      externalCustomerId: phone,
      displayName: "Cliente sem cadastro",
      agentEnabled: false,
    },
  });
  for (let round = 0; round < 2; round++) {
    const current = await db.avConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    const resolved = await db.$transaction((tx) =>
      applyVirtualCustomerName(tx, current),
    );
    assert.equal(resolved.name, "Cliente •••• 0123");
    assert.equal(resolved.source, "UNKNOWN");
    assert.equal(resolved.canGreet, false);
    assert.equal(resolved.contactId, null);
    assert.equal(
      (
        await db.avConversation.findUniqueOrThrow({
          where: { id: conversation.id },
        })
      ).nameUsableForReservation,
      false,
    );
  }
});
