import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { getVirtualConversation, listVirtualInbox } from "./virtual-inbox";
import { getVirtualMessagePage } from "./virtual-message-page";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
after(async () => db.$disconnect());

async function fixture() {
  const organization = await db.organizacao.create({
    data: { nome: "Paginação fictícia Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Unidade fictícia Kairu",
      codigo: "QA",
    },
  });
  const context: ContextoSessao = {
    usuario: {
      id: randomUUID(),
      nome: "Operador fictício Kairu",
      email: "operador@example.invalid",
      avatarUrl: null,
    },
    organizacao: { id: organization.id, nome: organization.nome },
    unidadeAtiva: { id: unit.id, nome: unit.nome, codigo: unit.codigo },
    unidadesVisiveis: [{ id: unit.id, nome: unit.nome, codigo: unit.codigo }],
    podeVerRedeInteira: false,
    permissoes: new Set(["crm.ver"]),
    ehDiretor: false,
  };
  const account = await db.avChannelAccount.create({
    data: {
      organizationId: organization.id,
      storeId: unit.id,
      name: "WhatsApp fictício",
      mode: "EVOLUTION",
      active: false,
    },
  });
  const scope = {
    organizationId: organization.id,
    storeId: unit.id,
    accountId: account.id,
  };
  const conversation = await db.avConversation.create({
    data: {
      ...scope,
      externalCustomerId: "+12025550123",
      displayName: "Cliente fictício Kairu",
      agentEnabled: false,
    },
  });
  return { context, unit, conversation, scope };
}

test("histórico com mais de 200 mensagens preserva preview atual e pagina sem lacunas em horários iguais", async () => {
  const f = await fixture();
  const live = await db.avMessage.create({
    data: {
      ...f.scope,
      conversationId: f.conversation.id,
      direction: "INBOUND",
      author: "CUSTOMER",
      text: "Mensagem atual fictícia",
      externalId: `message:${randomUUID()}`,
      processedAt: new Date(),
    },
  });
  const yesterday = Date.now() - 86400000;
  await db.avMessage.createMany({
    data: Array.from({ length: 250 }, (_, index) => ({
      ...f.scope,
      conversationId: f.conversation.id,
      direction: "INBOUND",
      author: "CUSTOMER",
      text: `Histórico fictício ${index}`,
      source: "HISTORY",
      externalId: `message:${randomUUID()}`,
      createdAt: new Date(yesterday + Math.floor(index / 2) * 1000),
      processedAt: new Date(),
    })),
  });
  const inbox = await listVirtualInbox(f.context, {
    storeId: f.unit.id,
    accountId: f.scope.accountId,
  });
  assert.equal(inbox.items[0].lastMessage, live.text);
  const detail = await getVirtualConversation(
    f.context,
    f.unit.id,
    f.conversation.id,
  );
  assert.equal(detail.messages.length, 200);
  assert.equal(detail.messages.at(-1)?.id, live.id);
  assert.ok(detail.olderCursor);
  const older = await getVirtualMessagePage(
    f.context,
    f.unit.id,
    f.conversation.id,
    detail.olderCursor,
  );
  assert.equal(older.messages.length, 51);
  assert.equal(older.olderCursor, null);
  assert.equal(
    older.messages.every(
      (message) => message.source === "HISTORY" && message.status === "HISTORY",
    ),
    true,
  );
  const combined = [...older.messages, ...detail.messages].map(
    (message) => message.id,
  );
  assert.equal(new Set(combined).size, 251);
  const expected = await db.avMessage.findMany({
    where: { conversationId: f.conversation.id },
    orderBy: [{ createdAt: "asc" }, { sequence: "asc" }],
    select: { id: true },
  });
  assert.deepEqual(
    combined,
    expected.map((message) => message.id),
  );
});

test("mensagens anteriores validam cursor e escopo antes de retornar conteúdo", async () => {
  const f = await fixture(),
    other = await fixture();
  await assert.rejects(
    getVirtualMessagePage(
      f.context,
      f.unit.id,
      f.conversation.id,
      "cursor-invalido",
    ),
    /Atualize a conversa/,
  );
  await assert.rejects(
    getVirtualMessagePage(
      other.context,
      other.unit.id,
      f.conversation.id,
      "cursor-invalido",
    ),
    /indisponível nesta unidade/,
  );
});
