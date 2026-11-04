import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, afterEach } from "node:test";
import { contextoDeFundo } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { managedEvolutionFor } from "./virtual-evolution-config";
import { virtualChannels } from "./virtual-channels";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
const names = [
  "EVOLUTION_URL",
  "EVOLUTION_INSTANCIA",
  "EVOLUTION_API_KEY",
  "AV_EVOLUTION_API_KEY",
  "AV_EVOLUTION_ALLOWED_ORIGINS",
] as const;
const prior = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
afterEach(() => {
  for (const name of names) {
    if (prior[name] === undefined) delete process.env[name];
    else process.env[name] = prior[name];
  }
});
after(async () => db.$disconnect());
const permissions = [
  "crm.ver",
  "crm.editar",
  "crm.gerenciar",
  "assistente.conectar",
];
async function fixture(network = false) {
  const organization = await db.organizacao.create({
    data: { nome: "Configuração fictícia Kairu", slug: randomUUID() },
  });
  const unit = await db.unidade.create({
    data: {
      organizacaoId: organization.id,
      nome: "Unidade de teste Kairu",
      codigo: "QA",
    },
  });
  const actor = await db.usuario.create({
    data: {
      nome: "Gestor de teste Kairu",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const role = await db.papel.create({
    data: {
      organizacaoId: organization.id,
      nome: "Gestão de teste",
      permissoes: { create: permissions.map((chave) => ({ chave })) },
    },
  });
  const access = await db.acesso.create({
    data: {
      usuarioId: actor.id,
      organizacaoId: organization.id,
      unidadeId: network ? null : unit.id,
      papelId: role.id,
    },
  });
  const context = (await contextoDeFundo(actor.id, unit.id))!;
  assert.ok(context);
  Object.assign(process.env, {
    EVOLUTION_URL: "http://evolution_api:8080",
    EVOLUTION_INSTANCIA: `qa-${randomUUID()}`,
    EVOLUTION_API_KEY: "fixture-private-legacy-instance-key",
    AV_EVOLUTION_API_KEY: "fixture-private-global-server-key",
    AV_EVOLUTION_ALLOWED_ORIGINS: "",
  });
  async function bind(
    unidadeId: string | null = unit.id,
    organizacaoId = organization.id,
  ) {
    return db.instanciaWhatsapp.create({
      data: {
        organizacaoId,
        unidadeId,
        nome: process.env.EVOLUTION_INSTANCIA!,
        provedor: "EVOLUTION_BAILEYS",
        ativa: false,
      },
    });
  }
  return { organization, unit, actor, role, access, context, bind };
}

test("servidor gerenciado exige vínculo único da organização e GET devolve só disponibilidade", async () => {
  const f = await fixture();
  await f.bind();
  assert.deepEqual(await managedEvolutionFor(f.context), {
    url: "http://evolution_api:8080",
    apiKey: "fixture-private-global-server-key",
  });
  const result = await virtualChannels(f.context, f.unit.id);
  assert.equal(result.managedEvolutionAvailable, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture-private-global-server-key|fixture-private-legacy-instance-key|apiKey|encryptedCredentials/,
  );
});

test("permissão de CRM, conexão e unidade visível são necessárias antes de reutilizar segredo", async () => {
  const f = await fixture();
  await f.bind();
  for (const key of ["crm.gerenciar", "assistente.conectar"]) {
    const reduced = new Set(f.context.permissoes);
    reduced.delete(key);
    assert.equal(
      await managedEvolutionFor({ ...f.context, permissoes: reduced }),
      null,
    );
  }
  assert.equal(
    await managedEvolutionFor({ ...f.context, unidadeAtiva: null }),
    null,
  );
  assert.equal(
    await managedEvolutionFor({ ...f.context, unidadesVisiveis: [] }),
    null,
  );
});

test("nome de instância estrangeiro ou ambíguo nunca disponibiliza credencial do servidor", async () => {
  const f = await fixture();
  const foreign = await db.organizacao.create({
    data: { nome: "Outra organização fictícia", slug: randomUUID() },
  });
  await f.bind(null, foreign.id);
  assert.equal(await managedEvolutionFor(f.context), null);
  await f.bind();
  assert.equal(await managedEvolutionFor(f.context), null);
});

test("gestor de outra loja precisa também de conexão autorizada na loja do vínculo legado", async () => {
  const f = await fixture();
  const legacyUnit = await db.unidade.create({
    data: {
      organizacaoId: f.organization.id,
      nome: "Outra loja Kairu",
      codigo: "OUTRA",
    },
  });
  await f.bind(legacyUnit.id);
  assert.equal(await managedEvolutionFor(f.context), null);
  const legacyAccess = await db.acesso.create({
    data: {
      usuarioId: f.actor.id,
      organizacaoId: f.organization.id,
      unidadeId: legacyUnit.id,
      papelId: f.role.id,
    },
  });
  assert.ok(await managedEvolutionFor(f.context));
  await db.acesso.update({
    where: { id: legacyAccess.id },
    data: { status: "SUSPENSO" },
  });
  assert.equal(await managedEvolutionFor(f.context), null);
});

test("vínculo de rede não empresta segredo a gestor limitado a uma unidade", async () => {
  const f = await fixture();
  await f.bind(null);
  assert.equal(await managedEvolutionFor(f.context), null);
  const role = await db.papel.create({
    data: {
      organizacaoId: f.organization.id,
      nome: "Rede de teste",
      permissoes: { create: [{ chave: "assistente.conectar" }] },
    },
  });
  await db.acesso.create({
    data: {
      usuarioId: f.actor.id,
      organizacaoId: f.organization.id,
      unidadeId: null,
      papelId: role.id,
    },
  });
  assert.ok(await managedEvolutionFor(f.context));
});

test("configuração incompleta, segredo malformado e acesso revogado falham sem rede", async () => {
  const f = await fixture();
  await f.bind();
  for (const key of ["AV_EVOLUTION_API_KEY", "EVOLUTION_INSTANCIA"] as const) {
    const saved = process.env[key];
    delete process.env[key];
    assert.equal(await managedEvolutionFor(f.context), null);
    process.env[key] = saved;
  }
  process.env.AV_EVOLUTION_API_KEY = "fixture\nprivate-key";
  assert.equal(await managedEvolutionFor(f.context), null);
  process.env.AV_EVOLUTION_API_KEY = "fixture-private-global-server-key";
  await db.acesso.update({
    where: { id: f.access.id },
    data: { excluidoEm: new Date() },
  });
  assert.equal(await managedEvolutionFor(f.context), null);
});

test("token legado sozinho nunca libera preparação; chave administrativa explícita é independente", async () => {
  const f = await fixture();
  await f.bind();
  assert.notEqual(
    process.env.AV_EVOLUTION_API_KEY,
    process.env.EVOLUTION_API_KEY,
  );
  delete process.env.AV_EVOLUTION_API_KEY;
  assert.equal(await managedEvolutionFor(f.context), null);
  assert.equal(
    (await virtualChannels(f.context, f.unit.id)).managedEvolutionAvailable,
    false,
  );
  process.env.AV_EVOLUTION_API_KEY = "   ";
  assert.equal(await managedEvolutionFor(f.context), null);
  process.env.AV_EVOLUTION_API_KEY = "fixture-private-global-server-key";
  delete process.env.EVOLUTION_API_KEY;
  assert.equal(
    (await managedEvolutionFor(f.context))?.apiKey,
    "fixture-private-global-server-key",
  );
});
