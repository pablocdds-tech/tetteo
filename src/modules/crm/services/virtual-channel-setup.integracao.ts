import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, afterEach } from "node:test";
import { contextoDeFundo } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { liveChannelConfiguration } from "@/server/atendimento-contas";
import type {
  ChannelManagementFactory,
  ChannelConnectionQr,
} from "@/server/atendimento-provedor";
import { changeVirtualChannel } from "./virtual-channels";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
const envNames = [
  "EVOLUTION_URL",
  "EVOLUTION_INSTANCIA",
  "EVOLUTION_API_KEY",
  "AV_EVOLUTION_API_KEY",
  "AV_EVOLUTION_ALLOWED_ORIGINS",
  "APP_URL",
] as const;
const prior = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]]),
);
const accounts: string[] = [];
afterEach(async () => {
  for (const name of envNames) {
    if (prior[name] === undefined) delete process.env[name];
    else process.env[name] = prior[name];
  }
  await db.avChannelAccount.updateMany({
    where: { id: { in: accounts } },
    data: { active: false },
  });
  // Connection verification also schedules read-only history jobs. Each fixture
  // must finish its own jobs before another test file runs the shared worker.
  const historyCleanup = {
    where: { accountId: { in: accounts } },
    data: {
      state: "FAILED",
      leaseOwner: null,
      leaseUntil: null,
      finishedAt: new Date(),
    },
  };
  await db.avChannelHistorySync.updateMany(historyCleanup);
  await db.avChannelHistoryRecentSync.updateMany(historyCleanup);
});
after(async () => db.$disconnect());
async function fixture() {
  const organization = await db.organizacao.create({
    data: { nome: "Conexão simples fictícia Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Unidade fictícia",
      codigo: "QA",
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
      organizacaoId: organization.id,
      nome: "Gestão fictícia",
      permissoes: {
        create: [
          "crm.ver",
          "crm.editar",
          "crm.gerenciar",
          "assistente.conectar",
        ].map((chave) => ({ chave })),
      },
    },
  });
  await db.acesso.create({
    data: {
      usuarioId: actor.id,
      organizacaoId: organization.id,
      unidadeId: unit.id,
      papelId: role.id,
    },
  });
  const context = (await contextoDeFundo(actor.id, unit.id))!;
  Object.assign(process.env, {
    EVOLUTION_URL: "http://evolution_api:8080",
    EVOLUTION_INSTANCIA: `qa-staff-${randomUUID()}`,
    EVOLUTION_API_KEY: "fixture-private-legacy-instance-key",
    AV_EVOLUTION_API_KEY: "fixture-private-managed-master-key",
    AV_EVOLUTION_ALLOWED_ORIGINS: "",
    APP_URL: "https://fixture.example.invalid",
  });
  const legacy = await db.instanciaWhatsapp.create({
    data: {
      organizacaoId: organization.id,
      unidadeId: unit.id,
      nome: process.env.EVOLUTION_INSTANCIA!,
      ativa: false,
      provedor: "EVOLUTION_BAILEYS",
    },
  });
  const calls: string[] = [];
  const behavior: {
    connected: boolean;
    qrState: ChannelConnectionQr["state"];
    webhookError?: Error;
    onEnsure?: () => Promise<void>;
    onQr?: () => Promise<void>;
  } = { connected: false, qrState: "QR" };
  const factory: ChannelManagementFactory = async (accountId) => {
    const config = await liveChannelConfiguration(accountId);
    return {
      identify: () => ({
        mode: config.provider,
        accountKey: accountId,
        revision: config.revision,
      }),
      ensureInstance: async () => {
        calls.push("ensure");
        await behavior.onEnsure?.();
      },
      webhook: async (url, replace) => {
        calls.push("webhook");
        assert.equal(
          url,
          `https://fixture.example.invalid/api/atendimento/evolution/${accountId}`,
        );
        assert.equal(replace, false);
        if (behavior.webhookError) throw behavior.webhookError;
      },
      qr: async () => {
        calls.push("qr");
        await behavior.onQr?.();
        return {
          state: behavior.qrState,
          qrDataUrl:
            behavior.qrState === "QR"
              ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX10AAAAASUVORK5CYII="
              : null,
          expiresAt: null,
          status: "Conexão de ensaio fictícia",
        };
      },
      verify: async () => {
        calls.push("verify");
        return { connected: behavior.connected };
      },
      sendText: async () => {
        throw new Error("Este ensaio não permite enviar mensagens.");
      },
      sendMedia: async () => {
        throw new Error("Este ensaio não permite enviar mídia.");
      },
      consultStatus: async () => {
        throw new Error("Este ensaio não consulta entregas.");
      },
    };
  };
  async function create() {
    const result = await changeVirtualChannel(
      context,
      { storeId: unit.id, action: "quickSetup" },
      factory,
    );
    assert.ok("createdAccountId" in result);
    assert.ok("accounts" in result);
    const account = result.accounts.find(
      (item) => item.id === result.createdAccountId,
    )!;
    accounts.push(account.id);
    return { result, account };
  }
  const act = (account: { id: string; revision: number }, action: string) =>
    changeVirtualChannel(
      context,
      {
        storeId: unit.id,
        accountId: account.id,
        revision: account.revision,
        action,
      },
      factory,
    );
  return {
    organization,
    unit,
    actor,
    context,
    legacy,
    calls,
    behavior,
    factory,
    create,
    act,
  };
}

test("configuração simples cria conta exclusiva inativa sem expor segredo, enviar ou mudar o número interno", async () => {
  const f = await fixture(),
    { result, account } = await f.create();
  assert.equal(account.active, false);
  assert.equal(account.provider, "EVOLUTION");
  assert.deepEqual(f.calls, []);
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture-private-managed-master-key|fixture-private-legacy-instance-key|webhookSecret|encryptedCredentials|apiKey/,
  );
  const config = await liveChannelConfiguration(account.id);
  assert.equal(config.provider, "EVOLUTION");
  if (config.provider !== "EVOLUTION") throw new Error("Provedor inesperado");
  assert.notEqual(config.settings.instance, f.legacy.nome);
  assert.match(config.settings.instance, /^sv-/);
  assert.equal(config.secrets.apiKey, "fixture-private-managed-master-key");
  assert.notEqual(config.secrets.apiKey, process.env.EVOLUTION_API_KEY);
  assert.ok(config.secrets.webhookSecret!.length >= 32);
  assert.deepEqual(
    await db.instanciaWhatsapp.findUniqueOrThrow({
      where: { id: f.legacy.id },
    }),
    f.legacy,
  );
  assert.equal(
    await db.avMessageOutbox.count({ where: { accountId: account.id } }),
    0,
  );
});

test("configuração simples nega operador sem conexão ou contexto de outra organização", async () => {
  const f = await fixture();
  const limited = {
    ...f.context,
    permissoes: new Set(["crm.ver", "crm.gerenciar"]),
  };
  await assert.rejects(
    changeVirtualChannel(
      limited,
      { storeId: f.unit.id, action: "quickSetup" },
      f.factory,
    ),
    /liberada pela administração/,
  );
  assert.equal(
    await db.avChannelAccount.count({
      where: { organizationId: f.organization.id },
    }),
    0,
  );
  const { account } = await f.create();
  await assert.rejects(
    changeVirtualChannel(
      { ...f.context, organizacao: { id: "foreign", nome: "Outra" } },
      {
        storeId: f.unit.id,
        accountId: account.id,
        revision: 1,
        action: "connect",
      },
      f.factory,
    ),
    /Unidade indisponível/,
  );
  await assert.rejects(
    f.act({ ...account, revision: account.revision + 1 }, "connect"),
    /configuração mudou/,
  );
  assert.deepEqual(f.calls, []);
});

test("um clique prepara instância e webhook sem substituir destino antes de pedir QR", async () => {
  const f = await fixture(),
    { account } = await f.create();
  const result = await f.act(account, "connect");
  assert.ok("state" in result);
  assert.equal(result.state, "QR");
  assert.deepEqual(f.calls, ["ensure", "webhook", "qr"]);
  const connection = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(connection.connectionState, "PENDING");
  assert.equal(connection.verifiedAt, null);
  assert.equal(
    (await db.avChannelAccount.findUniqueOrThrow({ where: { id: account.id } }))
      .active,
    false,
  );
});

test("consulta de estado não gera QR e conexão confirmada não ativa atendimento automaticamente", async () => {
  const f = await fixture(),
    { account } = await f.create();
  await f.act(account, "status");
  assert.equal(
    (
      await db.avChannelConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).connectionState,
    "PENDING",
  );
  f.behavior.connected = true;
  await f.act(account, "status");
  const row = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(row.connectionState, "VERIFIED");
  assert.equal(row.verifiedRevision, account.revision);
  assert.ok(row.verifiedAt);
  assert.deepEqual(f.calls, ["verify", "verify"]);
  assert.equal(
    (await db.avChannelAccount.findUniqueOrThrow({ where: { id: account.id } }))
      .active,
    false,
  );
});

test("webhook já associado a outro sistema bloqueia QR e preserva erro acionável", async () => {
  const f = await fixture(),
    { account } = await f.create();
  f.behavior.webhookError = new Error("EXISTING_WEBHOOK_CONFIRMATION_REQUIRED");
  await assert.rejects(f.act(account, "connect"), /outro sistema/);
  assert.deepEqual(f.calls, ["ensure", "webhook"]);
  const row = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(row.connectionState, "FAILED");
  assert.match(row.lastError!, /não foi substituído/);
});

test("mudança de revisão durante preparação cerca webhook e QR da revisão antiga", async () => {
  const f = await fixture(),
    { account } = await f.create();
  f.behavior.onEnsure = async () => {
    await db.avChannelConnection.update({
      where: { accountId: account.id },
      data: { revision: { increment: 1 } },
    });
  };
  await assert.rejects(f.act(account, "connect"), /configuração mudou/);
  assert.deepEqual(f.calls, ["ensure"]);
  assert.equal(
    (
      await db.avChannelConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).revision,
    2,
  );
});

test("retorno já conectado grava prova de conexão sem QR vazio ou novo envio", async () => {
  const f = await fixture(),
    { account } = await f.create();
  f.behavior.qrState = "CONNECTED";
  const result = await f.act(account, "connect");
  assert.ok("state" in result);
  assert.equal(result.state, "CONNECTED");
  assert.equal(result.qrDataUrl, null);
  assert.equal(
    (
      await db.avChannelConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).connectionState,
    "VERIFIED",
  );
  assert.equal(
    await db.avMessageOutbox.count({ where: { accountId: account.id } }),
    0,
  );
});

test("duas réplicas preparando a mesma conexão executam um único fluxo externo", async () => {
  const f = await fixture(),
    { account } = await f.create();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.behavior.onEnsure = async () => {
    entered();
    await waiting;
  };
  const first = f.act(account, "connect");
  await started;
  try {
    const row = await db.avChannelConnection.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    assert.ok(row.connectLeaseOwner);
    assert.ok(row.connectLeaseUntil);
    await assert.rejects(f.act(account, "connect"), (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "CONNECTION_BUSY" &&
        "status" in error &&
        error.status === 409,
      ),
    );
    assert.deepEqual(f.calls, ["ensure"]);
  } finally {
    release();
    await first;
  }
  assert.deepEqual(f.calls, ["ensure", "webhook", "qr"]);
  const row = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(row.connectLeaseOwner, null);
  assert.equal(row.connectLeaseUntil, null);
});

test("lease de processo interrompido expira e outra execução recupera a conexão", async () => {
  const f = await fixture(),
    { account } = await f.create();
  await assert.rejects(
    db.avChannelConnection.update({
      where: { accountId: account.id },
      data: { connectLeaseOwner: "inconsistent-owner" },
    }),
  );
  await db.avChannelConnection.update({
    where: { accountId: account.id },
    data: {
      connectLeaseOwner: "interrupted-worker",
      connectLeaseUntil: new Date(Date.now() - 5000),
    },
  });
  const result = await f.act(account, "connect");
  assert.ok("state" in result);
  assert.equal(result.state, "QR");
  assert.deepEqual(f.calls, ["ensure", "webhook", "qr"]);
  const row = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(row.connectLeaseOwner, null);
  assert.equal(row.connectLeaseUntil, null);
});

test("salvar revisão durante HTTP preserva exclusão até a execução antiga finalizar", async () => {
  const f = await fixture(),
    { account } = await f.create();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.behavior.onEnsure = async () => {
    entered();
    await waiting;
  };
  const first = f.act(account, "connect");
  await started;
  const original = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  let updated!: { id: string; revision: number };
  try {
    const settings = account.settings as { url: string; instance: string };
    const result = await changeVirtualChannel(
      f.context,
      {
        storeId: f.unit.id,
        action: "save",
        accountId: account.id,
        provider: "EVOLUTION",
        name: "Nome atualizado fictício",
        url: settings.url,
        instance: settings.instance,
      },
      f.factory,
    );
    assert.ok("accounts" in result);
    updated = result.accounts.find((item) => item.id === account.id)!;
    assert.equal(updated.revision, account.revision + 1);
    const saved = await db.avChannelConnection.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    assert.equal(saved.connectLeaseOwner, original.connectLeaseOwner);
    await assert.rejects(f.act(updated, "connect"), (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "CONNECTION_BUSY",
      ),
    );
    assert.deepEqual(f.calls, ["ensure"]);
  } finally {
    release();
    await assert.rejects(first, /configuração mudou|expirou/);
  }
  const released = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(released.revision, updated.revision);
  assert.equal(released.connectLeaseOwner, null);
  assert.equal(released.connectionState, "PENDING");
  await f.act(updated, "connect");
  assert.deepEqual(f.calls, ["ensure", "ensure", "webhook", "qr"]);
});

test("execução antiga não altera estado nem limpa lease que já pertence a outra réplica", async () => {
  const f = await fixture(),
    { account } = await f.create();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.behavior.onEnsure = async () => {
    entered();
    await waiting;
  };
  const first = f.act(account, "connect");
  await started;
  const replacement = randomUUID();
  await db.avChannelConnection.update({
    where: { accountId: account.id },
    data: {
      connectLeaseOwner: replacement,
      connectLeaseUntil: new Date(Date.now() + 120000),
    },
  });
  release();
  await assert.rejects(first, /configuração mudou|expirou/);
  const row = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(row.connectLeaseOwner, replacement);
  assert.equal(row.connectionState, "PENDING");
  assert.equal(row.lastError, null);
  assert.deepEqual(f.calls, ["ensure"]);
  await db.avChannelConnection.update({
    where: { accountId: account.id },
    data: { connectLeaseOwner: null, connectLeaseUntil: null },
  });
});

test("QR tardio não sobrescreve prova de conexão nem libera lease assumido durante HTTP", async () => {
  const f = await fixture(),
    { account } = await f.create();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.behavior.qrState = "CONNECTING";
  f.behavior.onQr = async () => {
    entered();
    await waiting;
  };
  const first = f.act(account, "connect");
  await started;
  const replacement = randomUUID(),
    verifiedAt = new Date(),
    error = "Evidência da nova execução deve ser preservada";
  await db.avChannelConnection.update({
    where: { accountId: account.id },
    data: {
      connectLeaseOwner: replacement,
      connectLeaseUntil: new Date(Date.now() + 120000),
      connectionState: "VERIFIED",
      verifiedRevision: account.revision,
      verifiedAt,
      lastError: error,
    },
  });
  release();
  await assert.rejects(first, /preparação expirou|configuração mudou/i);
  const row = await db.avChannelConnection.findUniqueOrThrow({
    where: { accountId: account.id },
  });
  assert.equal(row.connectLeaseOwner, replacement);
  assert.equal(row.connectionState, "VERIFIED");
  assert.equal(row.verifiedRevision, account.revision);
  assert.equal(row.verifiedAt?.getTime(), verifiedAt.getTime());
  assert.equal(row.lastError, error);
  assert.deepEqual(f.calls, ["ensure", "webhook", "qr"]);
  await db.avChannelConnection.update({
    where: { accountId: account.id },
    data: { connectLeaseOwner: null, connectLeaseUntil: null },
  });
});
