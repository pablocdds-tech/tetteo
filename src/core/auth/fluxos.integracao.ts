import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { resolverUsuarioGoogle } from "./google";
import { permitirTentativa } from "./limites";
import { criarTokenRecuperacao, hashSegredo } from "./politicas";
import {
  concluirRecuperacao,
  linkRecuperacaoValido,
  solicitarRecuperacao,
} from "./recuperacao";
import { authConfig } from "./config";

// Proteção extra, inclusive se alguém omitir o script de entrada por engano.
const bancoDeTeste = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV !== "test" ||
  !["localhost", "127.0.0.1"].includes(bancoDeTeste.hostname) ||
  !bancoDeTeste.pathname.includes("_test")
) {
  throw new Error(
    "Estes testes só rodam em banco local dedicado com _test no nome.",
  );
}

// O script de entrada recusa banco remoto ou sem _test. Não envia e-mails.
beforeEach(async () => {
  await db.recuperacaoSenha.deleteMany();
  await db.limiteAutenticacao.deleteMany();
  await db.sessao.deleteMany();
  await db.usuario.deleteMany({
    where: { email: { endsWith: "@auth-test.invalid" } },
  });
});
after(async () => {
  await db.$disconnect();
});

async function conta(email = "ana@auth-test.invalid") {
  return db.usuario.create({
    data: {
      email,
      nome: "Ana",
      status: "ATIVO",
      senhaHash: await bcrypt.hash("Senha anterior 123", 4),
    },
  });
}
async function link(usuarioId: string, expiraEm?: Date) {
  const criado = criarTokenRecuperacao();
  await db.recuperacaoSenha.create({
    data: {
      usuarioId,
      tokenHash: criado.tokenHash,
      expiraEm: expiraEm ?? criado.expiraEm,
    },
  });
  return criado.token;
}

test("link só guarda hash; dois envios concorrentes alteram senha uma única vez", async () => {
  const usuario = await conta();
  const token = await link(usuario.id);
  const outro = await link(usuario.id);
  const gravado = await db.recuperacaoSenha.findUniqueOrThrow({
    where: { tokenHash: hashSegredo(token) },
  });
  assert.notEqual(gravado.tokenHash, token);
  assert.equal(await linkRecuperacaoValido(token), true);
  const resultados = await Promise.allSettled([
    concluirRecuperacao(token, "Senha nova segura 123", "ip-a"),
    concluirRecuperacao(token, "Senha nova segura 123", "ip-b"),
  ]);
  assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
  const atual = await db.usuario.findUniqueOrThrow({
    where: { id: usuario.id },
  });
  assert.equal(atual.versaoSessao, 1);
  assert.equal(
    await bcrypt.compare("Senha nova segura 123", atual.senhaHash!),
    true,
  );
  assert.equal(
    await bcrypt.compare("Senha anterior 123", atual.senhaHash!),
    false,
  );
  assert.equal(await linkRecuperacaoValido(token), false);
  assert.equal(await linkRecuperacaoValido(outro), false);
  await assert.rejects(
    concluirRecuperacao(outro, "Outra senha segura 123", "ip-a"),
  );
});

test("links distintos simultâneos também não redefinem duas vezes", async () => {
  const usuario = await conta();
  const a = await link(usuario.id);
  const b = await link(usuario.id);
  const resultados = await Promise.allSettled([
    concluirRecuperacao(a, "Senha segura 123 A", "ip-a"),
    concluirRecuperacao(b, "Senha segura 123 B", "ip-b"),
  ]);
  assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } }))
      .versaoSessao,
    1,
  );
});

test("link expirado ou conta suspensa não muda senha nem versão", async () => {
  const usuario = await conta();
  const expirado = await link(usuario.id, new Date(Date.now() - 1_000));
  await assert.rejects(
    concluirRecuperacao(expirado, "Senha nova segura 123", "ip-a"),
  );
  const token = await link(usuario.id);
  await db.usuario.update({
    where: { id: usuario.id },
    data: { status: "SUSPENSO" },
  });
  assert.equal(await linkRecuperacaoValido(token), false);
  await assert.rejects(
    concluirRecuperacao(token, "Senha nova segura 123", "ip-a"),
  );
  const atual = await db.usuario.findUniqueOrThrow({
    where: { id: usuario.id },
  });
  assert.equal(atual.senhaHash, usuario.senhaHash);
  assert.equal(atual.versaoSessao, 0);
});

test("solicitação envia link só para conta ativa e não expõe existência", async (t) => {
  const usuario = await conta();
  process.env.APP_URL = "https://tetteo.example.com";
  process.env.RESEND_API_KEY = "teste-nao-real";
  process.env.AUTH_EMAIL_FROM = "Tetteo <teste@example.com>";
  const entregas: { to: string[]; text: string }[] = [];
  const envio = t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, opcoes: RequestInit) => {
      entregas.push(JSON.parse(String(opcoes.body)));
      return new Response('{"id":"teste"}', { status: 200 });
    },
  );
  await solicitarRecuperacao(usuario.email, "ip-a");
  await solicitarRecuperacao("inexistente@auth-test.invalid", "ip-a");
  assert.equal(entregas.length, 1);
  assert.deepEqual(entregas[0].to, [usuario.email]);
  const url = entregas[0].text.match(/https:\/\/[^\s]+/)![0];
  assert.equal(new URL(url).origin, "https://tetteo.example.com");
  assert.equal(
    await linkRecuperacaoValido(new URL(url).searchParams.get("token")!),
    true,
  );
  envio.mock.restore();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("erro", { status: 503 }),
  );
  await assert.doesNotReject(solicitarRecuperacao(usuario.email, "ip-a"));
  assert.equal(
    await db.recuperacaoSenha.count(),
    1,
    "o token do e-mail que falhou foi removido",
  );
});

test("limite persistente é atômico e não grava IP ou e-mail em claro", async () => {
  const resultados = await Promise.all(
    Array.from({ length: 8 }, () =>
      permitirTentativa("teste", "ana@auth-test.invalid", 3),
    ),
  );
  assert.equal(resultados.filter(Boolean).length, 3);
  const gravado = await db.limiteAutenticacao.findFirstOrThrow();
  assert.equal(gravado.tentativas, 8);
  assert.match(gravado.chave, /^[a-f0-9]{64}$/);
});

test("Google cria conta sem loja e reaproveita conta existente sem mudar senha", async () => {
  const novo = await resolverUsuarioGoogle({
    sub: "google-1",
    email: "nova@auth-test.invalid",
    email_verified: true,
    name: "Nova",
  });
  assert.ok(novo);
  assert.equal(novo.senhaHash, null);
  assert.equal(await db.acesso.count({ where: { usuarioId: novo.id } }), 0);
  const existente = await conta();
  const ligado = await resolverUsuarioGoogle({
    sub: "google-2",
    email: existente.email,
    email_verified: true,
  });
  assert.equal(ligado?.id, existente.id);
  assert.equal(ligado?.senhaHash, existente.senhaHash);
  assert.equal(
    await db.usuario.count({ where: { email: existente.email } }),
    1,
  );
});

test("Google rejeita e-mail não verificado, conta suspensa e troca de identidade", async () => {
  assert.equal(
    await resolverUsuarioGoogle({
      sub: "g",
      email: "sem@auth-test.invalid",
      email_verified: false,
    }),
    null,
  );
  const usuario = await conta();
  await db.usuario.update({
    where: { id: usuario.id },
    data: { status: "SUSPENSO" },
  });
  assert.equal(
    await resolverUsuarioGoogle({
      sub: "g",
      email: usuario.email,
      email_verified: true,
    }),
    null,
  );
  await db.usuario.update({
    where: { id: usuario.id },
    data: { status: "ATIVO", googleSubject: "dono" },
  });
  assert.equal(
    await resolverUsuarioGoogle({
      sub: "outro",
      email: usuario.email,
      email_verified: true,
    }),
    null,
  );
  assert.equal(
    await resolverUsuarioGoogle({
      sub: "dono",
      email: "outra@auth-test.invalid",
      email_verified: true,
    }),
    null,
  );
});

test("sessão emitida antes da redefinição é invalidada no servidor", async () => {
  const usuario = await conta();
  const parametros = {
    token: { usuarioId: usuario.id, versaoSessao: 0 },
  } as unknown as Parameters<typeof authConfig.callbacks.jwt>[0];
  assert.ok(await authConfig.callbacks.jwt(parametros));
  const token = await link(usuario.id);
  await concluirRecuperacao(token, "Senha nova segura 123", "ip-a");
  assert.equal(await authConfig.callbacks.jwt(parametros), null);
});
