import { contextoDeFundo, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

/**
 * O CENÁRIO DOS TESTES COM BANCO — uma rede fictícia mínima: duas lojas, uma
 * Diretora (tem `*`) e um Caixa (sem a permissão do cartão).
 *
 * `limparBanco` confere o nome do banco antes de apagar qualquer coisa, além
 * da trava de `scripts/ambiente-de-teste.ts`. (Repetido do cenário de
 * Compras de propósito: um App não importa de outro.)
 */

export async function limparBanco(): Promise<void> {
  const [{ banco }] = await db.$queryRaw<
    { banco: string }[]
  >`SELECT current_database() AS banco`;
  if (!banco.includes("_test")) {
    throw new Error(
      `Recusado: limparBanco rodaria em "${banco}", que não é banco de teste.`,
    );
  }
  const tabelas = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tabelas.length === 0) return;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tabelas.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export async function criarCenario() {
  const org = await db.organizacao.create({
    data: { nome: "Rede Exemplo", slug: `rede-exemplo-${Date.now()}` },
  });
  const centro = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja Exemplo Centro", codigo: "CEN" },
  });
  const sul = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja Exemplo Sul", codigo: "SUL" },
  });

  async function papel(nome: string, chaves: string[]) {
    return db.papel.create({
      data: {
        organizacaoId: org.id,
        nome,
        permissoes: { create: chaves.map((chave) => ({ chave })) },
      },
    });
  }
  async function pessoa(nome: string, papelId: string) {
    const usuario = await db.usuario.create({
      data: {
        nome,
        email: `${nome.toLowerCase()}.${Date.now()}@exemplo.test`,
        status: "ATIVO",
      },
    });
    await db.acesso.create({
      data: {
        usuarioId: usuario.id,
        organizacaoId: org.id,
        unidadeId: null,
        papelId,
      },
    });
    return usuario;
  }

  const diretor = await pessoa("Diretora", (await papel("Diretor", ["*"])).id);
  const caixa = await pessoa(
    "Caixa",
    (await papel("Caixa", ["financeiro.ver"])).id,
  );
  return { org, centro, sul, diretor, caixa };
}

export async function contexto(
  usuarioId: string,
  unidadeId: string,
): Promise<ContextoSessao> {
  const c = await contextoDeFundo(usuarioId, unidadeId);
  if (!c) throw new Error("o contexto do teste não montou");
  return c;
}
