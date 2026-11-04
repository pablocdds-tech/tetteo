import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { db } from "@/server/db";
import {
  channelRecipientHash,
  encryptChannelValue,
} from "@/server/atendimento-credenciais";
import { recordChannelDelivery } from "@/server/atendimento-contas";
import { receiveVirtualInbound } from "./virtual-runtime";
import {
  runVirtualGreetingProbe,
  type GreetingProbeDependencies,
} from "./virtual-greeting-probe";
import type { LiveChannelConfig } from "@/server/atendimento-provedor";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige banco local _test.");
after(async () => db.$disconnect());
const testerPhone = "+12025550123",
  servicePhone = "+12025550124";
async function fixture() {
  const org = await db.organizacao.create({
    data: { nome: "Saudação fictícia Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Unidade fictícia Kairu",
      codigo: "PROBE",
    },
  });
  const actor = await db.usuario.create({
    data: {
      nome: "Gestor fictício",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const role = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Gestor de teste",
      permissoes: {
        create: ["crm.ver", "crm.editar", "crm.gerenciar"].map((chave) => ({
          chave,
        })),
      },
    },
  });
  await db.acesso.create({
    data: {
      usuarioId: actor.id,
      organizacaoId: org.id,
      unidadeId: unit.id,
      papelId: role.id,
    },
  });
  const account = await db.avChannelAccount.create({
    data: {
      organizationId: org.id,
      storeId: unit.id,
      name: "Teste Kairu",
      mode: "EVOLUTION",
      active: false,
    },
  });
  const scope = {
    organizationId: org.id,
    storeId: unit.id,
    accountId: account.id,
  };
  const settings = {
      url: "http://127.0.0.1:9",
      instance: `fixture-${randomUUID()}`,
    },
    secrets = { apiKey: "private-fake-key" };
  await db.avChannelConnection.create({
    data: {
      ...scope,
      settings,
      bindingKey: randomUUID(),
      encryptedCredentials: encryptChannelValue(scope, JSON.stringify(secrets)),
      connectionState: "VERIFIED",
      verifiedRevision: 1,
      verifiedAt: new Date(),
    },
  });
  const origin = await db.avChannelTest.create({
    data: {
      ...scope,
      actorId: actor.id,
      requestId: randomUUID(),
      revision: 1,
      encryptedRecipient: encryptChannelValue(scope, testerPhone),
      recipientHash: channelRecipientHash(scope, testerPhone),
      state: "DELIVERED",
      deliveredAt: new Date(),
      observedAt: new Date(),
      observedById: actor.id,
    },
  });
  const request = {
    ...scope,
    actorId: actor.id,
    testerInstanceId: "source-fixture",
    originTestId: origin.id,
    requestId: randomUUID(),
  };
  let inputs = 0,
    replies = 0,
    conversationId = "",
    replyText = "",
    attests = 0;
  let beforeReply = async () => {};
  let peer = testerPhone;
  let uncertain = false,
    earlyReceipt = false,
    inputTimeout = false,
    replyTimeout = false;
  const deps: GreetingProbeDependencies = {
    attestPair: async () => {
      attests++;
      await beforeReply();
      return { testerPhone: peer, servicePhone, revision: 1 };
    },
    sendInput: async ({ text, correlationId, recipient }) => {
      inputs++;
      assert.equal(recipient, servicePhone);
      assert.equal(text, "Oi");
      const providerId = randomUUID(),
        now = new Date().toISOString();
      const received = await receiveVirtualInbound(
        account.id,
        {
          externalId: `message:${providerId}`,
          senderKey: testerPhone,
          trustedPhone: testerPhone,
          type: "MESSAGE",
          text: `Oi\n\nProtocolo: SV-${correlationId}`,
          occurredAt: now,
          profileName: "Ana fictícia Kairu",
          profileObservedAt: now,
        },
        { provider: "EVOLUTION", revision: 1 },
      );
      conversationId = received.conversationId!;
      await db.avConversation.update({
        where: { id: conversationId },
        data: { nameLookupRevision: 1 },
      });
      if (inputTimeout) throw new Error("private-fake-key");
      return { state: "ACCEPTED", providerId };
    },
    managementFor: async () => ({
      identify: () => ({
        mode: "EVOLUTION",
        accountKey: account.id,
        revision: 1,
      }),
      verify: async () => ({ connected: true }),
      webhook: async () => {
        throw new Error("no webhook mutation");
      },
      qr: async () => {
        throw new Error("no QR");
      },
      sendMedia: async () => ({ state: "FAILED", error: "disabled" }),
      consultStatus: async () => ({
        state: "UNCERTAIN",
        error: "fake lookup unavailable",
      }),
      sendText: async ({ text, recipient, correlationId }) => {
        replies++;
        replyText = text;
        assert.equal(recipient, testerPhone);
        if (replyTimeout) throw new Error("private-fake-key");
        if (uncertain) return { state: "UNCERTAIN", error: "private-fake-key" };
        const providerId = randomUUID();
        if (earlyReceipt) {
          const config: LiveChannelConfig = {
            ...scope,
            revision: 1,
            name: "Kairu",
            active: false,
            provider: "EVOLUTION",
            settings,
            secrets,
          };
          await recordChannelDelivery(config, {
            externalId: `receipt:${providerId}`,
            providerId,
            recipient: testerPhone,
            state: "DELIVERED",
          });
        }
        assert.match(correlationId, /^test:/);
        return { state: "ACCEPTED", providerId };
      },
    }),
  };
  const run = (
    phase: "prepare" | "send_input" | "reply" | "reconcile" | "status",
    extra: Record<string, unknown> = {},
  ) => runVirtualGreetingProbe({ ...request, phase, ...extra }, deps);
  const ready = async () => {
    await run("prepare");
    await run("send_input");
  };
  return {
    ...request,
    scope,
    account,
    actor,
    origin,
    run,
    ready,
    deps,
    counts: () => ({ inputs, replies }),
    id: () => conversationId,
    text: () => replyText,
    setPeer: (value: string) => {
      peer = value;
    },
    setUncertain: () => {
      uncertain = true;
    },
    setEarly: () => {
      earlyReceipt = true;
    },
    timeoutInput: () => {
      inputTimeout = true;
    },
    timeoutReply: () => {
      replyTimeout = true;
    },
    onAttest: (fn: typeof beforeReply) => {
      beforeReply = fn;
    },
    attests: () => attests,
  };
}

test("saudação isolada usa entrada LIVE e prefixo comum sem ativar conta ou tocar outras filas", async () => {
  const f = await fixture();
  await f.ready();
  await db.avConversation.update({
    where: { id: f.id() },
    data: { agentEnabled: false },
  });
  const before = await db.avConversation.findUniqueOrThrow({
    where: { id: f.id() },
  });
  const pending = await db.avMessage.create({
    data: {
      ...f.scope,
      conversationId: f.id(),
      externalId: `message:${randomUUID()}`,
      direction: "INBOUND",
      author: "CUSTOMER",
      text: "Pendência anterior fictícia Kairu",
      createdAt: new Date(before.lastMessageAt.getTime() - 1000),
    },
  });
  const other = await db.avConversation.create({
    data: {
      ...f.scope,
      externalCustomerId: "+12025550125",
      displayName: "Outro fictício",
      pendingSince: new Date(),
      processAfter: new Date(),
      agentEnabled: true,
    },
  });
  const result = await f.run("reply");
  assert.equal(result.state, "ACCEPTED");
  assert.equal(f.counts().replies, 1);
  assert.match(f.text(), /^Olá, Ana fictícia Kairu\. Sou a Severina\./);
  assert.equal(
    (
      await db.avChannelAccount.findUniqueOrThrow({
        where: { id: f.account.id },
      })
    ).active,
    false,
  );
  const after = await db.avConversation.findUniqueOrThrow({
    where: { id: f.id() },
  });
  assert.equal(after.version, before.version);
  assert.deepEqual(after.pendingSince, before.pendingSince);
  assert.deepEqual(after.processAfter, before.processAfter);
  assert.equal(after.agentEnabled, before.agentEnabled);
  assert.ok(
    (
      await db.avMessage.findFirstOrThrow({
        where: {
          conversationId: f.id(),
          text: `Oi\n\nProtocolo: SV-${f.requestId}`,
        },
      })
    ).processedAt,
  );
  assert.equal(
    (await db.avMessage.findUniqueOrThrow({ where: { id: pending.id } }))
      .processedAt,
    null,
  );
  assert.equal(
    (
      await db.avConversation.findUniqueOrThrow({ where: { id: other.id } })
    ).pendingSince?.getTime(),
    other.pendingSince?.getTime(),
  );
  assert.equal(await db.avMessageOutbox.count({ where: f.scope }), 0);
  assert.equal(await db.avAgentRun.count({ where: f.scope }), 0);
  assert.equal(await db.avReservation.count({ where: f.scope }), 0);
  assert.equal(
    await db.crmIdentity.count({ where: { storeId: f.storeId } }),
    0,
  );
  assert.equal(result.delivered, false);
  assert.equal(result.observed, false);
  assert.equal(result.nameSource, "WHATSAPP_PROFILE");
  const audit = await db.avAuditEvent.findMany({
    where: {
      organizationId: f.organizationId,
      storeId: f.storeId,
      action: { startsWith: "GREETING_PROBE_" },
    },
  });
  assert.doesNotMatch(
    JSON.stringify(audit),
    /Ana fictícia|12025550123|private-fake-key/,
  );
  for (const action of [
    "PREPARED",
    "INPUT_CLAIMED",
    "INPUT_RESULT",
    "REPLY_CLAIMED",
    "INPUT_CONSUMED",
    "REPLY_RESULT",
  ])
    assert.equal(
      audit.filter((event) => event.action === `GREETING_PROBE_${action}`)
        .length,
      1,
      action,
    );
});

test("duas chamadas e replay enviam uma entrada e uma resposta", async () => {
  const f = await fixture();
  await f.run("prepare");
  await Promise.all([f.run("send_input"), f.run("send_input")]);
  await Promise.all([f.run("reply"), f.run("reply")]);
  await f.run("reply");
  assert.deepEqual(f.counts(), { inputs: 1, replies: 1 });
});

test("falha incerta não reenvia e permanece rastreável", async () => {
  const f = await fixture();
  await f.ready();
  f.setUncertain();
  const first = await f.run("reply");
  assert.equal(first.state, "UNCERTAIN");
  await f.run("reply");
  await f.run("reconcile");
  assert.equal(f.counts().replies, 1);
  assert.doesNotMatch(
    JSON.stringify(await f.run("status")),
    /private-fake-key/,
  );
});

test("timeout da entrada ou da resposta mantém a intenção única sem expor o erro privado", async () => {
  const input = await fixture();
  input.timeoutInput();
  await input.run("prepare");
  const pendingInput = await input.run("send_input");
  assert.equal(pendingInput.state, "UNCERTAIN");
  await input.run("send_input");
  // O webhook autenticado chegou apesar do timeout HTTP; só ele permite responder.
  assert.equal((await input.run("reply")).state, "ACCEPTED");
  assert.deepEqual(input.counts(), { inputs: 1, replies: 1 });

  const reply = await fixture();
  await reply.ready();
  reply.timeoutReply();
  const pendingReply = await reply.run("reply");
  assert.equal(pendingReply.state, "UNCERTAIN");
  await reply.run("reply");
  await reply.run("reconcile");
  assert.deepEqual(reply.counts(), { inputs: 1, replies: 1 });
  const audit = await db.avAuditEvent.findMany({
    where: {
      organizationId: reply.organizationId,
      action: { startsWith: "GREETING_PROBE_" },
    },
  });
  assert.doesNotMatch(
    JSON.stringify({ pendingInput, pendingReply, audit }),
    /private-fake-key|12025550123|Ana fictícia/,
  );
});

test("canal ativo, falta de observação, telefone arbitrário e escopo estrangeiro bloqueiam", async () => {
  const f = await fixture();
  await assert.rejects(f.run("prepare", { recipient: "+12025550126" }));
  await assert.rejects(f.run("prepare", { organizationId: randomUUID() }));
  await db.avChannelAccount.update({
    where: { id: f.account.id },
    data: { active: true },
  });
  await assert.rejects(f.run("prepare"));
  await db.avChannelAccount.update({
    where: { id: f.account.id },
    data: { active: false },
  });
  await db.avChannelTest.update({
    where: { id: f.origin.id },
    data: { observedAt: null, observedById: null },
  });
  await assert.rejects(f.run("prepare"));
  assert.deepEqual(f.counts(), { inputs: 0, replies: 0 });
});

test("revisão antiga e mudança do vínculo preparado não autorizam novo envio", async () => {
  const revision = await fixture();
  await revision.ready();
  await db.avChannelConnection.update({
    where: { accountId: revision.accountId },
    data: { revision: 2, verifiedRevision: 2 },
  });
  await assert.rejects(revision.run("reply"), {
    code: "PROBE_CHANNEL_NOT_PAUSED",
  });
  assert.equal(revision.counts().replies, 0);

  const binding = await fixture();
  await binding.run("prepare");
  await assert.rejects(
    binding.run("send_input", { testerInstanceId: "outra-instancia-ficticia" }),
    { code: "PROBE_BINDING_CHANGED" },
  );
  assert.deepEqual(binding.counts(), { inputs: 0, replies: 0 });
});

test("nome ambíguo, inválido ou de lookup antigo não é usado como saudação", async () => {
  for (const data of [
    { nameNeedsConfirmation: true },
    { displayName: "https://example.invalid" },
    { nameLookupRevision: 0 },
  ]) {
    const f = await fixture();
    await f.ready();
    await db.avConversation.update({ where: { id: f.id() }, data });
    await assert.rejects(f.run("reply"));
    assert.equal(f.counts().replies, 0);
    assert.equal(await db.avChannelTest.count({ where: f.scope }), 1);
  }
});

test("pausa durável, opt-out e escalação pendente impedem o diagnóstico", async () => {
  for (const kind of ["pause", "optout", "escalation"]) {
    const f = await fixture();
    await f.ready();
    if (kind === "pause")
      await db.avAgentPause.create({
        data: {
          ...f.scope,
          conversationId: f.id(),
          actorId: f.actor.id,
          reason: "Pausa fictícia Kairu sem prazo",
        },
      });
    if (kind === "optout")
      await db.avConversation.update({
        where: { id: f.id() },
        data: { optedOut: true },
      });
    if (kind === "escalation")
      await db.avEscalation.create({
        data: {
          ...f.scope,
          conversationId: f.id(),
          key: randomUUID(),
          reason: "Pendência fictícia Kairu",
          excerpt: "A equipe está atendendo.",
        },
      });
    await assert.rejects(f.run("reply"));
    assert.equal(f.counts().replies, 0, kind);
  }
});

test("nova mensagem, takeover ou resposta pelo aparelho impedem o envio", async () => {
  for (const kind of ["new", "pause", "phone"]) {
    const f = await fixture();
    await f.ready();
    if (kind === "new")
      await db.avMessage.create({
        data: {
          ...f.scope,
          conversationId: f.id(),
          externalId: randomUUID(),
          direction: "INBOUND",
          author: "CUSTOMER",
          text: "Outra fala",
        },
      });
    if (kind === "pause")
      await db.avConversation.update({
        where: { id: f.id() },
        data: { status: "PAUSED", assignedToId: f.actor.id },
      });
    if (kind === "phone")
      await db.avInboundEvent.create({
        data: {
          ...f.scope,
          externalId: randomUUID(),
          type: "MESSAGE",
          senderKey: testerPhone,
          payload: { fromSelf: true, group: false },
          status: "IGNORED",
        },
      });
    await assert.rejects(f.run("reply"));
    assert.equal(f.counts().replies, 0, kind);
  }
});

test("mudança de controle entre claim e HTTP cerca resposta sem liberar novo envio", async () => {
  const f = await fixture();
  await f.ready();
  const before = f.attests();
  f.onAttest(async () => {
    if (f.attests() === before + 2)
      await db.avConversation.update({
        where: { id: f.id() },
        data: { status: "PAUSED", version: { increment: 1 } },
      });
  });
  const result = await f.run("reply");
  assert.equal(result.state, "FAILED");
  await f.run("reply");
  assert.equal(f.counts().replies, 0);
});

test("callback de entrega anterior ao bind é reconciliado sem reenviar", async () => {
  const f = await fixture();
  await f.ready();
  f.setEarly();
  const result = await f.run("reply");
  assert.equal(result.delivered, true);
  assert.equal(result.observed, false);
  await f.run("reconcile");
  assert.equal(f.counts().replies, 1);
});

test("intenção expirada bloqueia novos efeitos mas permite status e reconciliação", async () => {
  const f = await fixture();
  await f.run("prepare");
  const item = await db.avAuditEvent.findFirstOrThrow({
    where: {
      organizationId: f.organizationId,
      action: "GREETING_PROBE_PREPARED",
    },
  });
  await db.avAuditEvent.update({
    where: { id: item.id },
    data: {
      data: {
        ...(item.data as object),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    },
  });
  await assert.rejects(f.run("send_input"));
  await f.run("status");
  await f.run("reconcile");
  assert.deepEqual(f.counts(), { inputs: 0, replies: 0 });
});
