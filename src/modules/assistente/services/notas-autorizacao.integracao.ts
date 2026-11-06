import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { db } from "@/server/db";
import { contextoDeFundo } from "@/core/sessao/nucleo";
import { alterarAutorizacaoNota, obterPainelNotas } from "./notas-autorizacao";
import { contextoParaNota } from "./contexto-nota";
import { removerVinculo, criarVinculo, revogarAutorizacao } from "./vinculos";
import { enfileirarNotaWhatsapp } from "./notas-fila";
const destino = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(destino.hostname) &&
    destino.pathname.includes("_test"),
);
after(() => db.$disconnect());
async function fixture() {
  const org = await db.organizacao.create({
    data: { nome: "Autorizações sintéticas", slug: randomUUID() },
  });
  const unidade = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Unidade sintética",
      codigo: randomUUID(),
    },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Responsável sintético",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const papel = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Gestor sintético",
      permissoes: {
        create: [
          "assistente.ver",
          "assistente.vincular",
          "assistente.autorizar",
          "assistente.autorizar_notas",
          "estoque.lancar",
          "financeiro.ver",
          "financeiro.lancar",
        ].map((chave) => ({ chave })),
      },
    },
  });
  await db.acesso.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      usuarioId: usuario.id,
      papelId: papel.id,
    },
  });
  const instancia = await db.instanciaWhatsapp.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      nome: process.env.EVOLUTION_INSTANCIA ?? "severina",
      numeroProprio: "5511900000010",
      estado: "CONECTADO",
      provedor: "SIMULADO",
    },
  });
  const vinculo = await db.vinculoWhatsapp.create({
    data: {
      organizacaoId: org.id,
      usuarioId: usuario.id,
      telefone: "5511900000021",
      remoteJid: "5511900000021@s.whatsapp.net",
      autorizadoEm: new Date(),
    },
  });
  const ctx = await contextoDeFundo(usuario.id, unidade.id);
  assert.ok(ctx);
  const alterar = (autorizar: boolean, versao: number) =>
    alterarAutorizacaoNota(ctx, {
      vinculoId: vinculo.id,
      unidadeId: unidade.id,
      usuarioId: usuario.id,
      telefone: vinculo.telefone,
      autorizar,
      versao,
    });
  return {
    org,
    unidade,
    usuario,
    papel,
    instancia,
    vinculo,
    ctx,
    alterar,
    resolver: () => contextoParaNota(instancia.id, vinculo.id),
  };
}
test("avisos não liberam notas; grant e revogação de notas são independentes", async () => {
  const f = await fixture();
  assert.equal(await f.resolver(), null);
  assert.equal(
    await enfileirarNotaWhatsapp(f.instancia.id, f.vinculo.id, {
      idMensagem: randomUUID(),
      foto: true,
      recebidaEm: new Date(),
    }),
    false,
  );
  let p = await obterPainelNotas(f.ctx);
  assert.equal(p.conexao.numero, "5511900000010");
  assert.equal(p.pessoas[0].autorizada, false);
  assert.equal(p.pessoas[0].recebeAvisos, true);
  await f.alterar(true, 0);
  assert.ok(await f.resolver());
  await revogarAutorizacao(f.ctx, f.vinculo.id);
  assert.ok(await f.resolver());
  assert.equal((await obterPainelNotas(f.ctx)).pessoas[0].recebeAvisos, false);
  await f.alterar(false, 1);
  assert.equal(await f.resolver(), null);
  p = await obterPainelNotas(f.ctx);
  assert.equal(p.pessoas[0].autorizada, false);
  assert.equal(
    await db.auditoria.count({
      where: { organizacaoId: f.org.id, entidade: "AutorizacaoNotaWhatsapp" },
    }),
    2,
  );
});
test("permissão de avisos e contexto antigo não permitem autorizar notas", async () => {
  const f = await fixture();
  await db.papelPermissao.deleteMany({
    where: { papelId: f.papel.id, chave: "assistente.autorizar_notas" },
  });
  await assert.rejects(f.alterar(true, 0), /autorizar notas/);
  assert.equal(
    await db.autorizacaoNotaWhatsapp.count({
      where: { organizacaoId: f.org.id },
    }),
    0,
  );
});
test("formulário de outra unidade ou de telefone alterado não autoriza um vínculo diferente", async () => {
  const f = await fixture();
  await assert.rejects(
    alterarAutorizacaoNota(f.ctx, {
      vinculoId: f.vinculo.id,
      unidadeId: "outra-unidade",
      usuarioId: f.usuario.id,
      telefone: f.vinculo.telefone,
      autorizar: true,
      versao: 0,
    }),
    /unidade mudou/,
  );
  await db.vinculoWhatsapp.update({
    where: { id: f.vinculo.id },
    data: { telefone: "5511900000099" },
  });
  await assert.rejects(f.alterar(true, 0), /telefone do vínculo mudou/);
  assert.equal(
    await db.autorizacaoNotaWhatsapp.count({
      where: { organizacaoId: f.org.id },
    }),
    0,
  );
});
test("autorização respeita organização, unidade e versão concorrente", async () => {
  const a = await fixture(),
    b = await fixture();
  await assert.rejects(
    alterarAutorizacaoNota(a.ctx, {
      vinculoId: b.vinculo.id,
      unidadeId: a.unidade.id,
      usuarioId: b.usuario.id,
      telefone: b.vinculo.telefone,
      autorizar: true,
      versao: 0,
    }),
    /não encontrada/,
  );
  await a.alterar(true, 0);
  await assert.rejects(a.alterar(false, 0), /mudou/);
  assert.ok(await a.resolver());
  assert.equal(
    (await obterPainelNotas(a.ctx)).pessoas.some((p) => p.id === b.vinculo.id),
    false,
  );
  const outra = await db.unidade.create({
    data: {
      organizacaoId: a.org.id,
      nome: "Outra sintética",
      codigo: randomUUID(),
    },
  });
  await assert.rejects(
    alterarAutorizacaoNota(
      {
        ...a.ctx,
        unidadeAtiva: outra,
        unidadesVisiveis: [...a.ctx.unidadesVisiveis, outra],
      },
      {
        vinculoId: a.vinculo.id,
        unidadeId: outra.id,
        usuarioId: a.usuario.id,
        telefone: a.vinculo.telefone,
        autorizar: true,
        versao: 0,
      },
    ),
    /autorizar notas/,
  );
  const canal = await db.instanciaWhatsapp.create({
    data: { organizacaoId: a.org.id, unidadeId: outra.id, nome: randomUUID() },
  });
  assert.equal(await contextoParaNota(canal.id, a.vinculo.id), null);
});
test("mudança de identidade, suspensão e remoção do vínculo exigem liberação nova", async () => {
  const f = await fixture();
  await f.alterar(true, 0);
  await db.vinculoWhatsapp.update({
    where: { id: f.vinculo.id },
    data: { telefone: "5511900000022" },
  });
  assert.equal(await f.resolver(), null);
  await db.vinculoWhatsapp.update({
    where: { id: f.vinculo.id },
    data: { telefone: f.vinculo.telefone },
  });
  await removerVinculo(f.ctx, f.vinculo.id);
  assert.equal(await f.resolver(), null);
  await criarVinculo(f.ctx, {
    usuarioId: f.usuario.id,
    telefone: f.vinculo.telefone,
  });
  assert.equal(await f.resolver(), null);
  await db.usuario.update({
    where: { id: f.usuario.id },
    data: { status: "SUSPENSO" },
  });
  await assert.rejects(f.alterar(true, 2), /autorizar notas/);
});
test("usuário sem permissões não pode ganhar notas e seu painel não expõe telefones da equipe", async () => {
  const f = await fixture();
  const outro = await db.usuario.create({
    data: {
      nome: "Outra pessoa sintética",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  await db.acesso.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      usuarioId: outro.id,
      papelId: f.papel.id,
    },
  });
  await db.vinculoWhatsapp.create({
    data: {
      organizacaoId: f.org.id,
      usuarioId: outro.id,
      telefone: "5511900000031",
      remoteJid: "5511900000031@s.whatsapp.net",
    },
  });
  await db.papelPermissao.deleteMany({
    where: { papelId: f.papel.id, chave: "financeiro.lancar" },
  });
  await assert.rejects(f.alterar(true, 0), /precisa estar ativo/);
  await db.papelPermissao.deleteMany({
    where: {
      papelId: f.papel.id,
      chave: { in: ["assistente.vincular", "assistente.autorizar_notas"] },
    },
  });
  const atual = await contextoDeFundo(f.usuario.id, f.unidade.id);
  assert.ok(atual);
  const p = await obterPainelNotas(atual);
  assert.equal(p.pessoas.length, 1);
  assert.equal(p.pessoas[0].id, f.vinculo.id);
  assert.equal(p.podeAutorizar, false);
});
