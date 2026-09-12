import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { contextoDeFundo, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { listarConexoesDeIa, revogarConexaoDeIa } from "./conexoes";

/**
 * A ponte lê e revoga no esquema `mcp`, que pertence ao servidor MCP. O teste
 * cria esse esquema com o MESMO SQL do serviço, para não inventar um formato
 * que a produção não tem.
 */

const ESQUEMA_MCP = new URL(
  "../../../servicos/mcp/sql/02-tabelas.sql",
  import.meta.url,
);

let diretor: ContextoSessao;
let gerente: ContextoSessao;

async function limpar() {
  const [{ banco }] = await db.$queryRaw<{ banco: string }[]>`
    SELECT current_database() AS banco`;
  if (!banco.includes("_test")) throw new Error(`Recusado: ${banco}`);
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS mcp CASCADE");
  await db.$executeRawUnsafe(
    `TRUNCATE "acesso", "papel_permissao", "papel", "usuario", "unidade", "organizacao", "auditoria" RESTART IDENTITY CASCADE`,
  );
}

async function montarCenario() {
  const { readFile } = await import("node:fs/promises");
  await db.$executeRawUnsafe("CREATE SCHEMA mcp");
  await db.$executeRawUnsafe(await readFile(ESQUEMA_MCP, "utf8"));

  const org = await db.organizacao.create({
    data: { nome: "Rede Exemplo", slug: `rede-${Date.now()}` },
  });
  const centro = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Centro", codigo: "CEN" },
  });
  const papelDiretor = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Diretor",
      permissoes: { create: [{ chave: "*" }] },
    },
  });
  const papelGerente = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Gerente",
      permissoes: { create: [{ chave: "financeiro.ver" }] },
    },
  });
  const dona = await db.usuario.create({
    data: { nome: "Dona", email: "dona@exemplo.test", status: "ATIVO" },
  });
  const outra = await db.usuario.create({
    data: { nome: "Gerente", email: "gerente@exemplo.test", status: "ATIVO" },
  });
  await db.acesso.create({
    data: {
      usuarioId: dona.id,
      organizacaoId: org.id,
      unidadeId: null,
      papelId: papelDiretor.id,
    },
  });
  await db.acesso.create({
    data: {
      usuarioId: outra.id,
      organizacaoId: org.id,
      unidadeId: centro.id,
      papelId: papelGerente.id,
    },
  });

  const conexao = await db.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO mcp.conexao
       (usuario_id, unidade_id, versao_senha, client_id, cliente_nome, escopos, recurso, ultimo_uso_em)
     VALUES ($1, $2, 'versao', 'https://claude.ai/oauth/claude-code-client-metadata',
             'Claude Code', ARRAY['vendas:ler'], 'https://mcp.exemplo.com.br/mcp', now())
     RETURNING id`,
    dona.id,
    centro.id,
  );
  const conexaoId = conexao[0]!.id;

  // Duas consultas recentes e uma antiga: a tela conta os últimos 7 dias.
  await db.$executeRawUnsafe(
    `INSERT INTO mcp.chamada (conexao_id, ferramenta, argumentos, resultado, duracao_ms, criada_em) VALUES
       ($1, 'vendas_do_dia', '{}'::jsonb, 'ok', 12, now()),
       ($1, 'vendas_do_dia', '{}'::jsonb, 'ok', 15, now() - interval '2 days'),
       ($1, 'vendas_do_dia', '{}'::jsonb, 'erro', 9, now() - interval '30 days')`,
    conexaoId,
  );

  diretor = (await contextoDeFundo(dona.id, centro.id))!;
  gerente = (await contextoDeFundo(outra.id, centro.id))!;
  return { conexaoId, centro, dona };
}

describe("conexões de IA", () => {
  let cenario: Awaited<ReturnType<typeof montarCenario>>;

  before(async () => {
    await limpar();
  });

  beforeEach(async () => {
    await limpar();
    cenario = await montarCenario();
  });

  after(async () => {
    await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS mcp CASCADE");
    await db.$disconnect();
  });

  it("lista com pessoa, loja, cliente e as consultas dos últimos 7 dias", async () => {
    const leitura = await listarConexoesDeIa(diretor);
    assert.equal(leitura.situacao, "ok");
    assert.ok(leitura.situacao === "ok");
    assert.equal(leitura.conexoes.length, 1);

    const linha = leitura.conexoes[0]!;
    assert.equal(linha.pessoa, "Dona");
    assert.equal(linha.email, "dona@exemplo.test");
    assert.equal(linha.unidadeNome, "Centro");
    assert.equal(linha.clienteNome, "Claude Code");
    assert.equal(linha.clienteHost, "claude.ai");
    assert.equal(linha.consultas7Dias, 2);
    assert.equal(linha.revogadaEm, null);
  });

  it("revoga, apaga as chaves, registra na auditoria e é idempotente", async () => {
    assert.equal(
      await revogarConexaoDeIa(diretor, cenario.conexaoId),
      "revogada",
    );

    const leitura = await listarConexoesDeIa(diretor);
    assert.ok(leitura.situacao === "ok");
    assert.ok(leitura.conexoes[0]!.revogadaEm instanceof Date);
    assert.match(leitura.conexoes[0]!.motivo ?? "", /Tetteo/);

    const [{ chaves }] = await db.$queryRaw<{ chaves: number }[]>`
      SELECT count(*)::int AS chaves FROM mcp.token`;
    assert.equal(chaves, 0);

    const auditoria = await db.auditoria.findFirst({
      where: { entidade: "ConexaoMcp" },
    });
    assert.equal(auditoria?.entidadeId, cenario.conexaoId);
    assert.equal(auditoria?.acao, "EXCLUIU");

    assert.equal(
      await revogarConexaoDeIa(diretor, cenario.conexaoId),
      "ja-estava",
    );
  });

  it("id desconhecido não é erro, é 'não encontrada'", async () => {
    assert.equal(
      await revogarConexaoDeIa(diretor, "id-que-nao-existe"),
      "nao-encontrada",
    );
  });

  it("sem a permissão, nem lista nem revoga", async () => {
    await assert.rejects(() => listarConexoesDeIa(gerente), SemPermissao);
    await assert.rejects(
      () => revogarConexaoDeIa(gerente, cenario.conexaoId),
      SemPermissao,
    );
  });

  it("sem o esquema mcp, a leitura avisa em vez de quebrar", async () => {
    await db.$executeRawUnsafe("DROP SCHEMA mcp CASCADE");
    const leitura = await listarConexoesDeIa(diretor);
    assert.equal(leitura.situacao, "sem-servidor");
  });
});
