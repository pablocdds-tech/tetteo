import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { db } from "@/server/db";
import { contextoParaNota } from "./contexto-nota";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
after(async () => db.$disconnect());

const permissoes = [
  "assistente.ver",
  "estoque.lancar",
  "financeiro.ver",
  "financeiro.lancar",
];

async function fixture() {
  const organizacao = await db.organizacao.create({
    data: { nome: "Notas fictícias de teste", slug: randomUUID() },
  });
  const unidade = await db.unidade.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Cozinha de teste",
      codigo: "QA",
    },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Responsável fictício",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const papel = await db.papel.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Lançador de teste",
      permissoes: { create: permissoes.map((chave) => ({ chave })) },
    },
  });
  const acesso = await db.acesso.create({
    data: {
      usuarioId: usuario.id,
      organizacaoId: organizacao.id,
      unidadeId: unidade.id,
      papelId: papel.id,
    },
  });
  const instancia = await db.instanciaWhatsapp.create({
    data: {
      organizacaoId: organizacao.id,
      unidadeId: unidade.id,
      nome: `notas-teste-${randomUUID()}`,
      ativa: true,
      agendamentosPausados: true,
    },
  });
  const vinculo = await db.vinculoWhatsapp.create({
    data: {
      organizacaoId: organizacao.id,
      usuarioId: usuario.id,
      remoteJid: `teste-${randomUUID()}@lid`,
      telefone: "5511987654321",
      autorizadoEm: new Date(),
    },
  });
  const resolver = () => contextoParaNota(instancia.id, vinculo.id);
  return {
    organizacao,
    unidade,
    usuario,
    papel,
    acesso,
    instancia,
    vinculo,
    resolver,
  };
}

test("nota resolve a unidade do canal e o usuário atual sem exigir baixa ou agendamento", async () => {
  const f = await fixture();
  const resultado = await f.resolver();
  assert.ok(resultado);
  assert.equal(resultado.contexto.usuario.id, f.usuario.id);
  assert.equal(resultado.contexto.organizacao.id, f.organizacao.id);
  assert.equal(resultado.contexto.unidadeAtiva?.id, f.unidade.id);
  assert.equal(resultado.destinatario, f.vinculo.telefone);
  assert.equal(resultado.contexto.permissoes.has("financeiro.quitar"), false);
});

test("vínculo de avisos não concede nenhuma das permissões de lançamento", async (t) => {
  for (const permissao of permissoes) {
    await t.test(permissao, async () => {
      const f = await fixture();
      await db.papelPermissao.deleteMany({
        where: { papelId: f.papel.id, chave: permissao },
      });
      assert.equal(await f.resolver(), null);
    });
  }
});

test("revogação e suspensão impedem continuar uma nota recebida antes", async (t) => {
  for (const mudanca of [
    "autorizacao",
    "vinculo",
    "usuario",
    "exclusao",
    "acesso",
  ] as const) {
    await t.test(mudanca, async () => {
      const f = await fixture();
      assert.ok(await f.resolver());
      if (mudanca === "autorizacao")
        await db.vinculoWhatsapp.update({
          where: { id: f.vinculo.id },
          data: { autorizadoEm: null },
        });
      if (mudanca === "vinculo")
        await db.vinculoWhatsapp.update({
          where: { id: f.vinculo.id },
          data: { excluidoEm: new Date() },
        });
      if (mudanca === "usuario")
        await db.usuario.update({
          where: { id: f.usuario.id },
          data: { status: "SUSPENSO" },
        });
      if (mudanca === "exclusao")
        await db.usuario.update({
          where: { id: f.usuario.id },
          data: { excluidoEm: new Date() },
        });
      if (mudanca === "acesso")
        await db.acesso.update({
          where: { id: f.acesso.id },
          data: { status: "SUSPENSO" },
        });
      assert.equal(await f.resolver(), null);
    });
  }
});

test("nota não usa canal desligado, rede ambígua ou unidade inativa", async (t) => {
  for (const mudanca of ["desligado", "excluido", "rede", "unidade"] as const) {
    await t.test(mudanca, async () => {
      const f = await fixture();
      if (mudanca === "desligado")
        await db.instanciaWhatsapp.update({
          where: { id: f.instancia.id },
          data: { ativa: false },
        });
      if (mudanca === "excluido")
        await db.instanciaWhatsapp.update({
          where: { id: f.instancia.id },
          data: { excluidoEm: new Date() },
        });
      if (mudanca === "rede") {
        await db.instanciaWhatsapp.update({
          where: { id: f.instancia.id },
          data: { unidadeId: null },
        });
        await db.unidade.create({
          data: {
            organizacaoId: f.organizacao.id,
            nome: "Outra unidade ativa",
            codigo: "QB",
          },
        });
      }
      if (mudanca === "unidade")
        await db.unidade.update({
          where: { id: f.unidade.id },
          data: { ativa: false },
        });
      assert.equal(await f.resolver(), null);
    });
  }
});

test("canal sem unidade usa a única unidade ativa da organização, sem adivinhar pelo usuário", async () => {
  const f = await fixture();
  await db.instanciaWhatsapp.update({
    where: { id: f.instancia.id },
    data: { unidadeId: null },
  });
  const unico = await f.resolver();
  assert.ok(unico);
  assert.equal(unico.contexto.unidadeAtiva?.id, f.unidade.id);
  const outra = await db.unidade.create({
    data: {
      organizacaoId: f.organizacao.id,
      nome: "Sem acesso para o usuário",
      codigo: "QB",
    },
  });
  // O usuário só enxerga a primeira, mas a organização tem duas: deve recusar.
  assert.equal(await f.resolver(), null);
  await db.unidade.update({ where: { id: outra.id }, data: { ativa: false } });
  assert.ok(await f.resolver());
  await db.unidade.update({
    where: { id: outra.id },
    data: { ativa: true, excluidoEm: new Date() },
  });
  assert.ok(await f.resolver());
});

test("identificadores de outra organização ou loja não transferem autorização", async () => {
  const a = await fixture();
  const b = await fixture();
  assert.equal(await contextoParaNota(a.instancia.id, b.vinculo.id), null);
  await db.instanciaWhatsapp.update({
    where: { id: a.instancia.id },
    data: { unidadeId: b.unidade.id },
  });
  assert.equal(await a.resolver(), null);
  const unidadeSemAcesso = await db.unidade.create({
    data: {
      organizacaoId: a.organizacao.id,
      nome: "Outra loja de teste",
      codigo: "QB",
    },
  });
  await db.instanciaWhatsapp.update({
    where: { id: a.instancia.id },
    data: { unidadeId: unidadeSemAcesso.id },
  });
  assert.equal(await a.resolver(), null);
});

test("destinatário inválido ou de grupo nunca recebe resumo financeiro", async () => {
  const f = await fixture();
  await db.vinculoWhatsapp.update({
    where: { id: f.vinculo.id },
    data: { telefone: "sem telefone" },
  });
  assert.equal(await f.resolver(), null);
  await db.vinculoWhatsapp.update({
    where: { id: f.vinculo.id },
    data: {
      telefone: f.vinculo.telefone,
      remoteJid: `${f.vinculo.telefone}@g.us`,
    },
  });
  assert.equal(await f.resolver(), null);
});
