import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { encryptVirtualCredential } from "@/server/ia/credencial-atendimento";
import { privateVirtualModelConfiguration } from "@/server/ia/modelo-atendimento-config";
import {
  changeVirtualModel,
  getVirtualModelStatus,
  safeVirtualModelStatus,
} from "./virtual-model";
import { processVirtualQueue, receiveVirtualInbound } from "./virtual-runtime";
import { reserveModelBudget, runVirtualAgent } from "./virtual-agent";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
after(async () => db.$disconnect());

async function fixture() {
  const organization = await db.organizacao.create({
    data: { nome: "Conexão fictícia Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Modelo fictício",
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
  const credential = `fixture_Gemini_${randomUUID()}`;
  const scope = { organizationId: organization.id, storeId: unit.id };
  const save = (extra: Record<string, unknown> = {}) =>
    changeVirtualModel(context, {
      storeId: unit.id,
      action: "save",
      apiKey: credential,
      model: "gemini-fixture",
      ratesConfirmed: true,
      inputMicrosPerMillion: 1000000,
      outputMicrosPerMillion: 2000000,
      ...extra,
    });
  const probe = (revision: number, requestId = randomUUID()) =>
    changeVirtualModel(context, {
      storeId: unit.id,
      action: "test",
      revision,
      requestId,
    });
  const activate = (revision: number, enabled = true) =>
    changeVirtualModel(context, {
      storeId: unit.id,
      action: "activate",
      revision,
      enabled,
    });
  return {
    organization,
    unit,
    actor,
    context,
    credential,
    scope,
    save,
    probe,
    activate,
  };
}
const successfulResponse = () =>
  Response.json({
    candidates: [
      { content: { parts: [{ text: JSON.stringify({ intent: "hours" }) }] } },
    ],
    usageMetadata: {
      promptTokenCount: 20,
      candidatesTokenCount: 20,
      totalTokenCount: 40,
    },
  });
const statusOf = (value: unknown) =>
  value as Awaited<ReturnType<typeof getVirtualModelStatus>>;

test("configuração privada exige gestor, mantém tenant e nunca devolve chave ou cifra", async () => {
  const f = await fixture(),
    other = await fixture();
  await assert.rejects(
    changeVirtualModel(
      { ...f.context, permissoes: new Set(["crm.ver", "crm.editar"]) },
      {
        storeId: f.unit.id,
        action: "save",
        apiKey: f.credential,
        model: "gemini-fixture",
        ratesConfirmed: true,
        inputMicrosPerMillion: 0,
        outputMicrosPerMillion: 0,
      },
    ),
  );
  await assert.rejects(getVirtualModelStatus(f.context, other.unit.id));
  await assert.rejects(
    changeVirtualModel(f.context, {
      storeId: f.unit.id,
      action: "save",
      apiKey: f.credential,
      model: "gemini-fixture",
      ratesConfirmed: true,
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
      organizationId: other.organization.id,
    }),
  );
  const saved = statusOf(await f.save());
  assert.equal(saved.enabled, false);
  assert.equal(saved.test.state, "PENDING");
  assert.equal(saved.credentialPresent, true);
  const row = await db.avModelConfiguration.findUniqueOrThrow({
    where: { organizationId_storeId: f.scope },
  });
  assert.notEqual(row.encryptedKey, f.credential);
  const outputs = [
    saved,
    await getVirtualModelStatus(f.context, f.unit.id),
    await safeVirtualModelStatus(f.scope),
    await db.avAuditEvent.findMany({ where: f.scope }),
  ];
  const serialized = JSON.stringify(outputs);
  assert.equal(serialized.includes(f.credential), false);
  assert.equal(serialized.includes(row.encryptedKey), false);
  assert.doesNotMatch(serialized, /"apiKey"|"encryptedKey"/);
  assert.equal(
    (await getVirtualModelStatus(other.context, other.unit.id))
      .credentialPresent,
    false,
  );
  await assert.rejects(
    db.avModelConfiguration.create({
      data: {
        organizationId: f.organization.id,
        storeId: other.unit.id,
        encryptedKey: "invalid-fixture",
        updatedById: f.actor.id,
      },
    }),
  );
});

test("teste fictício aprovado permite ativar somente a mesma revisão e replay não chama provedor de novo", async (t) => {
  const f = await fixture();
  const saved = statusOf(await f.save());
  await assert.rejects(f.activate(saved.revision));
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options?: RequestInit) => {
      calls++;
      assert.match(
        String(url),
        /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-fixture:generateContent$/,
      );
      assert.equal(
        new Headers(options?.headers).get("x-goog-api-key"),
        f.credential,
      );
      assert.equal(options?.redirect, "error");
      assert.match(String(options?.body), /Mensagem fictícia de teste/);
      return successfulResponse();
    },
  );
  const requestId = randomUUID();
  const tested = statusOf(await f.probe(saved.revision, requestId));
  assert.equal(tested.test.state, "PASSED");
  assert.equal(tested.test.revision, saved.revision);
  assert.equal(tested.enabled, false);
  await f.probe(saved.revision, requestId);
  assert.equal(calls, 1);
  assert.equal(
    ((await f.activate(saved.revision)) as { enabled: boolean }).enabled,
    true,
  );
  assert.equal(await db.avModelProbe.count({ where: f.scope }), 1);
  const row = await db.avModelConfiguration.findUniqueOrThrow({
    where: { organizationId_storeId: f.scope },
  });
  const changed = statusOf(
    await f.save({ apiKey: undefined, model: "gemini-fixture-v2" }),
  );
  assert.equal(changed.revision, saved.revision + 1);
  assert.equal(changed.enabled, false);
  assert.equal(changed.test.state, "PENDING");
  assert.equal(changed.test.revision, null);
  assert.equal(
    (await db.avModelConfiguration.findUniqueOrThrow({ where: { id: row.id } }))
      .encryptedKey,
    row.encryptedKey,
  );
  await assert.rejects(f.activate(saved.revision));
  await assert.rejects(f.activate(changed.revision));
});

test(
  "teste antigo concorrente não aprova configuração salva depois nem duplica chamada",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture();
    const saved = statusOf(await f.save());
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      entered();
      await pending;
      return successfulResponse();
    });
    const requestId = randomUUID();
    const oldProbe = f.probe(saved.revision, requestId);
    await started;
    try {
      const replay = statusOf(await f.probe(saved.revision, requestId));
      assert.equal(replay.test.state, "TESTING");
      await assert.rejects(f.probe(saved.revision));
      const changed = statusOf(
        await f.save({ apiKey: undefined, model: "gemini-fixture-v2" }),
      );
      assert.equal(changed.revision, saved.revision + 1);
    } finally {
      release();
      await oldProbe;
    }
    const current = await getVirtualModelStatus(f.context, f.unit.id);
    assert.equal(current.revision, saved.revision + 1);
    assert.equal(current.test.state, "PENDING");
    assert.equal(current.enabled, false);
    await assert.rejects(f.activate(current.revision));
    assert.equal(calls, 1);
    assert.equal(await db.avModelProbe.count({ where: f.scope }), 1);
  },
);

test("falha de provedor e timeout conservam custo reservado sem vazar corpo, erro ou credencial", async (t) => {
  const f = await fixture();
  const saved = statusOf(await f.save());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1)
      return Response.json(
        { error: `corpo reservado ${f.credential}` },
        { status: 403 },
      );
    if (calls === 2)
      throw new DOMException(
        `timeout reservado ${f.credential}`,
        "TimeoutError",
      );
    return Response.json({
      candidates: [
        { content: { parts: [{ text: JSON.stringify({ intent: "menu" }) }] } },
      ],
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 20,
        totalTokenCount: 40,
      },
    });
  });
  for (let i = 0; i < 3; i++) {
    const failed = statusOf(await f.probe(saved.revision));
    assert.equal(failed.test.state, "FAILED");
    assert.equal(failed.enabled, false);
    assert.ok(failed.test.costMicros > 0);
    assert.equal(JSON.stringify(failed).includes(f.credential), false);
    await assert.rejects(f.activate(saved.revision));
  }
  await assert.rejects(
    f.probe(saved.revision),
    (e: unknown) => e instanceof Error && "status" in e && e.status === 429,
  );
  const probes = await db.avModelProbe.findMany({ where: f.scope });
  assert.equal(probes.length, 3);
  assert.equal(calls, 3);
  assert.ok(probes.every((p) => p.state === "FAILED" && p.costMicros > 0));
  assert.equal(
    JSON.stringify(await db.avAuditEvent.findMany({ where: f.scope })).includes(
      f.credential,
    ),
    false,
  );
});

test("cifra copiada de outra unidade é ilegível e não pode ativar o modelo", async () => {
  const f = await fixture(),
    other = await fixture();
  const saved = statusOf(await f.save());
  const cipherFromOtherStore = encryptVirtualCredential(
    other.scope,
    other.credential,
  );
  await db.avModelConfiguration.update({
    where: { organizationId_storeId: f.scope },
    data: {
      encryptedKey: cipherFromOtherStore,
      testState: "PASSED",
      testedRevision: saved.revision,
      testedAt: new Date(),
    },
  });
  const status = await getVirtualModelStatus(f.context, f.unit.id);
  assert.equal(status.credentialPresent, false);
  assert.equal(status.enabled, false);
  assert.match(status.blockers.join(" "), /chave privada/);
  assert.equal(JSON.stringify(status).includes(other.credential), false);
  assert.equal(JSON.stringify(status).includes(cipherFromOtherStore), false);
  await assert.rejects(f.activate(saved.revision));
  assert.equal(
    (
      await db.avModelConfiguration.findUniqueOrThrow({
        where: { organizationId_storeId: f.scope },
      })
    ).enabled,
    false,
  );
});

test("tarifa zero explicitamente confirmada pode ser testada sem presumir preço e catálogo não devolve chave", async (t) => {
  const f = await fixture();
  const saved = statusOf(
    await f.save({ inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 }),
  );
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes(":generateContent")) return successfulResponse();
    return Response.json({
      models: [
        {
          name: "models/gemini-fixture",
          displayName: "Gemini fictício",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/text-embedding-fixture",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
  });
  const catalog = await changeVirtualModel(f.context, {
    storeId: f.unit.id,
    action: "models",
  });
  assert.deepEqual(catalog, {
    models: [{ name: "gemini-fixture", displayName: "Gemini fictício" }],
  });
  assert.equal(JSON.stringify(catalog).includes(f.credential), false);
  const tested = statusOf(await f.probe(saved.revision));
  assert.equal(tested.test.state, "PASSED");
  assert.equal(tested.test.costMicros, 0);
  assert.equal(statusOf(await f.activate(saved.revision)).enabled, true);
});

test("banco recusa ativação sem revisão testada e orçamento impede probe antes da rede", async (t) => {
  const f = await fixture();
  const saved = statusOf(
    await f.save({
      inputMicrosPerMillion: 1000000000,
      outputMicrosPerMillion: 1000000000,
    }),
  );
  await assert.rejects(
    db.avModelConfiguration.update({
      where: { organizationId_storeId: f.scope },
      data: {
        enabled: true,
        testState: "PASSED",
        testedRevision: null,
        testedAt: new Date(),
      },
    }),
  );
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("O orçamento deveria impedir a rede.");
  });
  await assert.rejects(
    f.probe(saved.revision),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "MODEL_TEST_BUDGET",
  );
  assert.equal(calls, 0);
  assert.equal(await db.avModelProbe.count({ where: f.scope }), 0);
  assert.equal(
    (await getVirtualModelStatus(f.context, f.unit.id)).enabled,
    false,
  );
});

test("chave de ambiente exige vínculo explícito e não faz chamada nem é adotada por outra unidade", async (t) => {
  const f = await fixture(),
    other = await fixture();
  const keys = [
    "AV_MODEL_ENABLED",
    "AV_MODEL_ORGANIZATION_ID",
    "AV_MODEL_STORE_ID",
    "AV_GEMINI_API_KEY",
    "AV_GEMINI_MODEL",
    "AV_GEMINI_INPUT_MICROS_PER_MILLION",
    "AV_GEMINI_OUTPUT_MICROS_PER_MILLION",
  ] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    AV_MODEL_ENABLED: "true",
    AV_GEMINI_API_KEY: f.credential,
    AV_GEMINI_MODEL: "gemini-fixture",
    AV_GEMINI_INPUT_MICROS_PER_MILLION: "1000000",
    AV_GEMINI_OUTPUT_MICROS_PER_MILLION: "1000000",
  });
  delete process.env.AV_MODEL_ORGANIZATION_ID;
  delete process.env.AV_MODEL_STORE_ID;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return successfulResponse();
  });
  const account = await db.avChannelAccount.create({
    data: {
      ...other.scope,
      name: "Canal fictício sem vínculo de modelo",
      mode: "DEMO",
      debounceMs: 0,
      maxWaitMs: 1000,
    },
  });
  try {
    const unbound = await privateVirtualModelConfiguration(f.scope);
    assert.equal(unbound.enabled, false);
    assert.equal(unbound.apiKey, undefined);
    Object.assign(process.env, {
      AV_MODEL_ORGANIZATION_ID: f.organization.id,
      AV_MODEL_STORE_ID: f.unit.id,
    });
    assert.equal(
      (await privateVirtualModelConfiguration(f.scope)).apiKey,
      f.credential,
    );
    assert.equal(
      (await privateVirtualModelConfiguration(other.scope)).apiKey,
      undefined,
    );
    assert.equal(
      (await getVirtualModelStatus(other.context, other.unit.id))
        .credentialPresent,
      false,
    );
    await assert.rejects(
      f.save({ apiKey: undefined }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "MODEL_KEY_MISSING",
    );
    await receiveVirtualInbound(account.id, {
      externalId: randomUUID(),
      senderKey: "demo:visitante",
      type: "MESSAGE",
      text: "Qual o horário de funcionamento?",
    });
    await processVirtualQueue(runVirtualAgent);
    assert.equal(calls, 0);
    assert.equal(await db.avModelConfiguration.count({ where: f.scope }), 0);
  } finally {
    await db.avChannelAccount.update({
      where: { id: account.id },
      data: { active: false },
    });
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("snapshot privado antigo é bloqueado antes da rede mesmo sem invalidação visível da conversa", async (t) => {
  const f = await fixture();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return successfulResponse();
  });
  const saved = statusOf(await f.save());
  await f.probe(saved.revision);
  await f.activate(saved.revision);
  calls = 0;
  const account = await db.avChannelAccount.create({
    data: {
      ...f.scope,
      name: "Canal fictício para corrida de revisão",
      mode: "DEMO",
      debounceMs: 0,
      maxWaitMs: 1000,
    },
  });
  const inbound = await receiveVirtualInbound(account.id, {
    externalId: randomUUID(),
    senderKey: "demo:revisao",
    type: "MESSAGE",
    text: "Qual o horário de funcionamento?",
  });
  try {
    let checked = false;
    await processVirtualQueue(async (input) => {
      const snapshot = await privateVirtualModelConfiguration(f.scope);
      assert.equal(snapshot.enabled, true);
      // Simula uma revisão gravada entre a leitura da configuração e a reserva
      // do orçamento, sem depender de a transação ter enxergado o lease novo.
      await db.avModelConfiguration.update({
        where: { organizationId_storeId: f.scope },
        data: {
          revision: { increment: 1 },
          enabled: false,
          testState: "PENDING",
          testedRevision: null,
          testedAt: null,
        },
      });
      await assert.rejects(
        reserveModelBudget(input, 100, snapshot),
        /MODEL_CONFIGURATION_CHANGED/,
      );
      checked = true;
      return {
        text: "Configuração mudou; ensaio encerrado sem chamar o provedor.",
        tokens: 0,
        costMicros: 0,
      };
    });
    assert.equal(checked, true);
    assert.equal(calls, 0);
    assert.equal(
      (
        await db.avAgentRun.findFirstOrThrow({
          where: { conversationId: inbound.conversationId! },
        })
      ).costMicros,
      0,
    );
  } finally {
    await db.avChannelAccount.update({
      where: { id: account.id },
      data: { active: false },
    });
  }
});

test("retry da mesma prova após morte do processo registra timeout sem nova chamada e mantém custo reservado", async (t) => {
  const f = await fixture();
  const saved = statusOf(await f.save());
  const config = await db.avModelConfiguration.findUniqueOrThrow({
    where: { organizationId_storeId: f.scope },
  });
  const requestId = randomUUID();
  const reservedCost = 4096;
  const interrupted = await db.avModelProbe.create({
    data: {
      ...f.scope,
      configurationId: config.id,
      revision: saved.revision,
      actorId: f.actor.id,
      requestId,
      state: "RUNNING",
      costMicros: reservedCost,
      createdAt: new Date(Date.now() - 61000),
    },
  });
  await db.avModelConfiguration.update({
    where: { id: config.id },
    data: {
      testState: "TESTING",
      testedRevision: saved.revision,
      testedAt: null,
      testCostMicros: reservedCost,
      enabled: false,
    },
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return successfulResponse();
  });
  const recovered = statusOf(await f.probe(saved.revision, requestId));
  assert.equal(calls, 0);
  assert.equal(recovered.test.state, "FAILED");
  assert.equal(recovered.test.errorCode, "MODEL_TEST_TIMEOUT");
  assert.equal(recovered.test.costMicros, reservedCost);
  assert.equal(recovered.enabled, false);
  const failed = await db.avModelProbe.findUniqueOrThrow({
    where: { id: interrupted.id },
  });
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.errorCode, "MODEL_TEST_TIMEOUT");
  assert.equal(failed.costMicros, reservedCost);
  assert.ok(failed.completedAt);
  await f.probe(saved.revision, requestId);
  assert.equal(calls, 0);
  assert.equal(await db.avModelProbe.count({ where: f.scope }), 1);
  const fresh = statusOf(await f.probe(saved.revision));
  assert.equal(fresh.test.state, "PASSED");
  assert.equal(calls, 1);
  assert.equal(await db.avModelProbe.count({ where: f.scope }), 2);
  assert.equal(
    (await db.avModelProbe.findUniqueOrThrow({ where: { id: interrupted.id } }))
      .costMicros,
    reservedCost,
  );
});
