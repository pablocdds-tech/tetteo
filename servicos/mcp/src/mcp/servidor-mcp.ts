import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";

import {
  registrarVendasDoDia,
  type DependenciasDaFerramenta,
} from "./vendas-do-dia.js";

/**
 * UM SERVIDOR MCP POR REQUISIÇÃO.
 *
 * `createMcpHandler` chama esta fábrica a cada requisição HTTP, com a chave já
 * validada. Nada fica guardado entre uma chamada e outra: é isso que deixa
 * publicar uma versão nova sem derrubar a conversa de ninguém.
 */

export const VERSAO = "1.0.0";

/** O que o verificador pendura na chave validada. */
export type ExtraDaChave = {
  conexaoId: string;
  usuarioId: string;
  unidadeId: string;
  unidadeNome: string;
};

export function lerExtra(authInfo: AuthInfo | undefined): ExtraDaChave | null {
  const extra = authInfo?.extra;
  if (
    !extra ||
    typeof extra.conexaoId !== "string" ||
    typeof extra.usuarioId !== "string" ||
    typeof extra.unidadeId !== "string" ||
    typeof extra.unidadeNome !== "string"
  ) {
    return null;
  }
  return {
    conexaoId: extra.conexaoId,
    usuarioId: extra.usuarioId,
    unidadeId: extra.unidadeId,
    unidadeNome: extra.unidadeNome,
  };
}

export type DependenciasDoServidorMcp = Omit<
  DependenciasDaFerramenta,
  "conexao"
>;

export function criarServidorMcp(
  authInfo: AuthInfo | undefined,
  deps: DependenciasDoServidorMcp,
): McpServer {
  const servidor = new McpServer(
    { name: "tetteo-mcp", title: "Tetteo — consultas", version: VERSAO },
    {
      instructions:
        "Ferramentas de consulta do Tetteo, o sistema da Vitaliano Pizzaria. Tudo aqui é somente leitura. As vendas são da loja escolhida quando a conexão foi autorizada.",
    },
  );

  // Sem a chave validada não há loja — e sem loja não há ferramenta. A rota
  // /mcp já exige a chave; isto é a segunda trava, não a primeira.
  const extra = lerExtra(authInfo);
  if (extra) {
    registrarVendasDoDia(servidor, {
      ...deps,
      conexao: {
        conexaoId: extra.conexaoId,
        unidadeId: extra.unidadeId,
        unidadeNome: extra.unidadeNome,
      },
    });
  }
  return servidor;
}
