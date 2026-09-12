import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

/**
 * A PONTE COM O SERVIDOR MCP.
 *
 * O esquema `mcp` pertence ao servidor MCP, que roda em outro contêiner com um
 * papel de banco próprio. O Tetteo LÊ essas linhas para mostrar quem conectou
 * uma IA, e escreve numa única situação: revogar.
 *
 * Por que SQL direto: as tabelas não são do Prisma do Tetteo, e não devem ser.
 * Colocá-las no schema.prisma faria o Tetteo se achar dono delas — e a próxima
 * migração do Tetteo tentaria recriá-las.
 *
 * Nenhuma chave passa por aqui: o servidor MCP guarda só impressões digitais.
 */

export type ConexaoDeIa = {
  id: string;
  usuarioId: string;
  pessoa: string | null;
  email: string | null;
  unidadeNome: string | null;
  clienteNome: string;
  clienteHost: string;
  criadaEm: Date;
  ultimoUsoEm: Date | null;
  revogadaEm: Date | null;
  motivo: string | null;
  consultas7Dias: number;
};

export type LeituraDeConexoes =
  { situacao: "ok"; conexoes: ConexaoDeIa[] } | { situacao: "sem-servidor" };

const PERMISSAO = "configuracoes.integracoes";

function hostDe(clientId: string): string {
  try {
    return new URL(clientId).hostname;
  } catch {
    return clientId;
  }
}

/** O esquema existe neste banco? Em desenvolvimento, normalmente não. */
async function servidorPreparado(): Promise<boolean> {
  const [linha] = await db.$queryRaw<{ existe: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'mcp' AND table_name = 'conexao'
    ) AS existe`;
  return linha?.existe ?? false;
}

export async function listarConexoesDeIa(
  contexto: ContextoSessao,
): Promise<LeituraDeConexoes> {
  if (!pode(contexto, PERMISSAO)) {
    throw new SemPermissao("ver as conexões de IA");
  }
  if (!(await servidorPreparado())) return { situacao: "sem-servidor" };

  const linhas = await db.$queryRaw<
    {
      id: string;
      usuario_id: string;
      pessoa: string | null;
      email: string | null;
      unidade_nome: string;
      cliente_nome: string;
      client_id: string;
      criada_em: Date;
      ultimo_uso_em: Date | null;
      revogada_em: Date | null;
      motivo_revogacao: string | null;
      consultas: number;
    }[]
  >`
    SELECT x.id, x.usuario_id, u.nome AS pessoa, u.email,
           un.nome AS unidade_nome, x.cliente_nome, x.client_id,
           x.criada_em, x.ultimo_uso_em, x.revogada_em, x.motivo_revogacao,
           (SELECT count(*) FROM mcp.chamada c
             WHERE c.conexao_id = x.id
               AND c.criada_em > now() - interval '7 days')::int AS consultas
      FROM mcp.conexao x
      JOIN "unidade" un ON un.id = x.unidade_id
                       AND un."organizacaoId" = ${contexto.organizacao.id}
      LEFT JOIN "usuario" u ON u.id = x.usuario_id
     ORDER BY (x.revogada_em IS NOT NULL), x.criada_em DESC
     LIMIT 200`;

  return {
    situacao: "ok",
    conexoes: linhas.map((l) => ({
      id: l.id,
      usuarioId: l.usuario_id,
      pessoa: l.pessoa,
      email: l.email,
      unidadeNome: l.unidade_nome,
      clienteNome: l.cliente_nome,
      clienteHost: hostDe(l.client_id),
      criadaEm: l.criada_em,
      ultimoUsoEm: l.ultimo_uso_em,
      revogadaEm: l.revogada_em,
      motivo: l.motivo_revogacao,
      consultas7Dias: l.consultas,
    })),
  };
}

export type ResultadoDaRevogacao = "revogada" | "ja-estava" | "nao-encontrada";

/**
 * Revogar é o oposto de perigoso: tira acesso. Por isso vale a mesma permissão
 * de ver — exigir a permissão mais forte do sistema atrapalharia justamente na
 * hora em que se quer cortar rápido.
 */
export async function revogarConexaoDeIa(
  contexto: ContextoSessao,
  id: string,
): Promise<ResultadoDaRevogacao> {
  if (!pode(contexto, PERMISSAO)) {
    throw new SemPermissao("revogar conexões de IA");
  }
  if (!(await servidorPreparado())) return "nao-encontrada";

  const [conexao] = await db.$queryRaw<
    { id: string; revogada_em: Date | null }[]
  >`
    SELECT x.id, x.revogada_em
      FROM mcp.conexao x
      JOIN "unidade" un ON un.id = x.unidade_id
                       AND un."organizacaoId" = ${contexto.organizacao.id}
     WHERE x.id = ${id}`;
  if (!conexao) return "nao-encontrada";
  if (conexao.revogada_em) return "ja-estava";

  const motivo = `revogada no Tetteo por ${contexto.usuario.nome}`;
  await db.$executeRaw`
    UPDATE mcp.conexao
       SET revogada_em = now(), motivo_revogacao = ${motivo}
     WHERE id = ${id} AND revogada_em IS NULL`;
  // As chaves vão junto: enquanto existirem, valem até vencer.
  await db.$executeRaw`DELETE FROM mcp.token WHERE conexao_id = ${id}`;

  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade: "ConexaoMcp",
      entidadeId: id,
      acao: "EXCLUIU",
      valoresDepois: { revogada: true, motivo },
    },
  });

  return "revogada";
}
