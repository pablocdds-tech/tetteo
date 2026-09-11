import type { Banco } from "./conexao.js";

/**
 * O QUE O MCP LÊ DO TETTEO — e é só isto.
 *
 * Duas visões do esquema `mcp_leitura`, criadas pelo administrador. O papel
 * `tetteo_mcp` não enxerga nenhuma tabela do Tetteo. Se um dia precisar de
 * mais um dado, a visão é ampliada de propósito, com revisão — nunca "só
 * desta vez".
 */

export type UsuarioParaLogin = { id: string; nome: string; senhaHash: string };

export type Loja = { id: string; nome: string };

export async function buscarUsuarioParaLogin(
  banco: Banco,
  email: string,
): Promise<UsuarioParaLogin | null> {
  const { rows } = await banco.query<{
    id: string;
    nome: string;
    senha_hash: string;
  }>(
    "SELECT id, nome, senha_hash FROM mcp_leitura.usuario_login WHERE email = $1 LIMIT 1",
    [email.trim().toLowerCase()],
  );
  const linha = rows[0];
  return linha
    ? { id: linha.id, nome: linha.nome, senhaHash: linha.senha_hash }
    : null;
}

export async function lojasComVendasVisiveis(
  banco: Banco,
  usuarioId: string,
): Promise<Loja[]> {
  const { rows } = await banco.query<{
    unidade_id: string;
    unidade_nome: string;
  }>(
    "SELECT unidade_id, unidade_nome FROM mcp_leitura.loja_com_vendas_visiveis WHERE usuario_id = $1 ORDER BY unidade_nome",
    [usuarioId],
  );
  return rows.map((linha) => ({
    id: linha.unidade_id,
    nome: linha.unidade_nome,
  }));
}
