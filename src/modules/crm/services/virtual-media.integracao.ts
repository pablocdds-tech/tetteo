import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { contextoDeFundo } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type {
  ChannelManagementFactory,
  ChannelMessageMedia,
} from "@/server/atendimento-provedor";
import { readVirtualMessageMedia } from "./virtual-media";
import { CrmError } from "./campaign-domain";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
after(async () => db.$disconnect());
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ogg = Buffer.concat([
  Buffer.from("OggS"),
  Buffer.alloc(24),
  Buffer.from("OpusHead"),
  Buffer.alloc(8),
]);
const media: ChannelMessageMedia = {
  bytes: png,
  contentType: "image/png",
  extension: "png",
};
const code = (expected: string) => (error: unknown) =>
  error instanceof CrmError && error.code === expected;

async function fixture(source = "HISTORY", kind: "IMAGE" | "AUDIO" = "IMAGE") {
  const organization = await db.organizacao.create({
    data: { nome: "Mídia fictícia Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Kairu fictícia",
      codigo: "MIDIA",
    },
  });
  const actor = await db.usuario.create({
    data: {
      nome: "Operador fictício Kairu",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const role = await db.papel.create({
    data: {
      organizacaoId: organization.id,
      nome: "Operador de mídia",
      permissoes: { create: [{ chave: "crm.ver" }] },
    },
  });
  const access = await db.acesso.create({
    data: {
      usuarioId: actor.id,
      organizacaoId: organization.id,
      unidadeId: unit.id,
      papelId: role.id,
    },
  });
  const account = await db.avChannelAccount.create({
    data: {
      organizationId: organization.id,
      storeId: unit.id,
      name: "WhatsApp fictício Kairu",
      mode: "EVOLUTION",
      active: false,
    },
  });
  const scope = {
    organizationId: organization.id,
    storeId: unit.id,
    accountId: account.id,
  };
  await db.avChannelConnection.create({
    data: {
      ...scope,
      encryptedCredentials: "fake-not-used",
      settings: {},
      bindingKey: `fixture:${randomUUID()}`,
      connectionState: "VERIFIED",
      verifiedRevision: 1,
      verifiedAt: new Date(),
    },
  });
  const conversation = await db.avConversation.create({
    data: {
      ...scope,
      externalCustomerId: "+12025550123",
      displayName: "Pessoa fictícia Kairu",
      agentEnabled: false,
    },
  });
  const message = await db.avMessage.create({
    data: {
      ...scope,
      conversationId: conversation.id,
      externalId: `message:${randomUUID()}`,
      direction: "INBOUND",
      author: "CUSTOMER",
      text: "Imagem fictícia",
      kind,
      source,
    },
  });
  const context = (await contextoDeFundo(actor.id, unit.id))!;
  let reads = 0,
    reader = async (): Promise<ChannelMessageMedia> =>
      kind === "IMAGE"
        ? media
        : { bytes: ogg, contentType: "audio/ogg", extension: "ogg" };
  const factory: ChannelManagementFactory = async (id) => ({
    identify: () => ({ mode: "EVOLUTION", accountKey: id, revision: 1 }),
    verify: async () => ({ connected: true }),
    webhook: async () => {},
    qr: async () => {
      throw new Error("No QR");
    },
    sendText: async () => {
      throw new Error("No send");
    },
    sendMedia: async () => {
      throw new Error("No send");
    },
    consultStatus: async () => {
      throw new Error("No status");
    },
    readMessageMedia: async (query) => {
      reads++;
      assert.equal(query.providerMessageId, message.externalId!.slice(8));
      assert.equal(query.kind, kind);
      return reader();
    },
  });
  const read = (messageId = message.id, storeId = unit.id) =>
    readVirtualMessageMedia(context, { storeId, messageId }, factory);
  return {
    account,
    access,
    actor,
    conversation,
    context,
    unit,
    message,
    factory,
    read,
    reads: () => reads,
    setReader: (value: typeof reader) => {
      reader = value;
    },
  };
}

test("imagem LIVE e histórica abrem com canal pausado sem executar agente ou saída", async () => {
  for (const source of ["LIVE", "HISTORY"]) {
    const f = await fixture(source);
    const result = await f.read();
    assert.deepEqual(result.bytes, png);
    assert.equal(f.reads(), 1);
    assert.equal(
      (
        await db.avChannelAccount.findUniqueOrThrow({
          where: { id: f.account.id },
        })
      ).active,
      false,
    );
    assert.equal(
      await db.avAgentRun.count({ where: { accountId: f.account.id } }),
      0,
    );
    assert.equal(
      await db.avMessageOutbox.count({ where: { accountId: f.account.id } }),
      0,
    );
    assert.equal(
      await db.avAuditEvent.count({
        where: {
          conversationId: f.conversation.id,
          action: "MESSAGE_MEDIA_READ",
        },
      }),
      1,
    );
  }
});

test("áudio LIVE e histórico retornam bytes Opus sem marcar transcrição confiável", async () => {
  for (const source of ["LIVE", "HISTORY"]) {
    const f = await fixture(source, "AUDIO");
    await db.avMessage.update({
      where: { id: f.message.id },
      data: { transcriptionCertain: false },
    });
    const result = await f.read();
    assert.deepEqual(result.bytes, ogg);
    assert.equal(result.contentType, "audio/ogg");
    assert.equal(
      (await db.avMessage.findUniqueOrThrow({ where: { id: f.message.id } }))
        .transcriptionCertain,
      false,
    );
  }
});

test("ID de mensagem de outra organização/unidade e unidade não ativa falham antes do provedor", async () => {
  const a = await fixture(),
    b = await fixture();
  await assert.rejects(a.read(b.message.id), code("NOT_FOUND"));
  await assert.rejects(a.read(a.message.id, b.unit.id), code("FORBIDDEN"));
  await assert.rejects(
    readVirtualMessageMedia(
      { ...a.context, permissoes: new Set() },
      { storeId: a.unit.id, messageId: a.message.id },
      a.factory,
    ),
    code("FORBIDDEN"),
  );
  assert.equal(a.reads(), 0);
});

test("troca de revisão, revogação de acesso e usuário desativado durante download não liberam bytes", async () => {
  for (const mutate of [
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      db.avChannelConnection.update({
        where: { accountId: f.account.id },
        data: {
          revision: 2,
          connectionState: "PENDING",
          verifiedRevision: null,
          verifiedAt: null,
        },
      }),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      db.acesso.update({
        where: { id: f.access.id },
        data: { excluidoEm: new Date() },
      }),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      db.usuario.update({
        where: { id: f.actor.id },
        data: { excluidoEm: new Date() },
      }),
  ]) {
    const f = await fixture();
    f.setReader(async () => {
      await mutate(f);
      return media;
    });
    await assert.rejects(
      f.read(),
      (error: unknown) =>
        error instanceof CrmError &&
        ["FORBIDDEN", "MEDIA_CONFIGURATION_CHANGED"].includes(error.code),
    );
    assert.equal(
      await db.avAuditEvent.count({
        where: {
          conversationId: f.conversation.id,
          action: "MESSAGE_MEDIA_READ",
        },
      }),
      0,
    );
  }
});

test("conexão fechada é recusada e bytes de MIME falso não chegam ao navegador", async () => {
  const f = await fixture();
  await db.avChannelConnection.update({
    where: { accountId: f.account.id },
    data: { connectionState: "PENDING" },
  });
  await assert.rejects(f.read(), code("MEDIA_CONNECTION_REQUIRED"));
  assert.equal(f.reads(), 0);
  await db.avChannelConnection.update({
    where: { accountId: f.account.id },
    data: { connectionState: "VERIFIED" },
  });
  f.setReader(async () => ({ ...media, contentType: "image/jpeg" }));
  await assert.rejects(f.read(), code("MEDIA_TYPE"));
  await db.avMessage.update({
    where: { id: f.message.id },
    data: { kind: "TEXT" },
  });
  await assert.rejects(f.read(), code("MEDIA_UNSUPPORTED"));
});

test("erro privado do provedor é mascarado e mudança concorrente é acionável", async () => {
  const f = await fixture();
  f.setReader(async () => {
    throw new Error("token=SEGREDO_FICTICIO https://private.invalid/media");
  });
  await assert.rejects(f.read(), (error: unknown) => {
    assert.ok(error instanceof CrmError);
    assert.equal(error.code, "MEDIA_UNAVAILABLE");
    assert.doesNotMatch(error.message, /SEGREDO|private.invalid/);
    return true;
  });
  f.setReader(async () => {
    throw new Error("CHANNEL_CONFIGURATION_CHANGED");
  });
  await assert.rejects(f.read(), code("MEDIA_CONFIGURATION_CHANGED"));
});
