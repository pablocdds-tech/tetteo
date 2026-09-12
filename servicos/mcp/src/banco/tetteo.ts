import type { Banco } from "./conexao.js";

/**
 * O QUE O MCP LÊ DO TETTEO — e é só isto.
 *
 * Duas visões e duas funções do esquema `mcp_leitura`, criadas pelo
 * administrador. O papel `tetteo_mcp` não enxerga nenhuma tabela do Tetteo, e
 * o hash da senha só sai pela função `hash_para_login`: de uma pessoa por vez,
 * pelo e-mail exato. Se um dia precisar de mais um dado, a visão é ampliada
 * de propósito, com revisão — nunca "só desta vez".
 */

export type UsuarioParaLogin = {
  id: string;
  nome: string;
  senhaHash: string;
  /** Impressão digital do hash: muda quando a senha muda. */
  versaoSenha: string;
};

export type Loja = { id: string; nome: string };

export async function buscarUsuarioParaLogin(
  banco: Banco,
  email: string,
): Promise<UsuarioParaLogin | null> {
  const { rows } = await banco.query<{
    id: string;
    nome: string;
    senha_hash: string;
    versao_senha: string;
  }>(
    "SELECT id, nome, senha_hash, versao_senha FROM mcp_leitura.hash_para_login($1)",
    [email.trim().toLowerCase()],
  );
  const linha = rows[0];
  return linha
    ? {
        id: linha.id,
        nome: linha.nome,
        senhaHash: linha.senha_hash,
        versaoSenha: linha.versao_senha,
      }
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
