import {
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import type { Banco } from "../banco/conexao.js";
import type { Config } from "../config.js";
import type { ExtraDaChave } from "../mcp/servidor-mcp.js";
import type { Registro } from "../registro.js";
import { buscarChaveDeAcesso, marcarUso } from "./armazem.js";

/**
 * A PORTA DO /mcp: confere a chave a cada requisição.
 *
 * Consulta o banco toda vez, de propósito. Custa uma consulta indexada e
 * compra revogação na hora: suspender alguém no Tetteo, tirar a permissão ou
 * revogar a conexão vale já na chamada seguinte, sem esperar a chave vencer.
 *
 * Chave inválida vira `OAuthError(invalid_token)` → 401 com o cabeçalho que
 * leva o Claude ao login. Banco fora do ar vira erro comum → 500: não é
 * "faça login de novo", é "tente mais tarde".
 */
export function criarVerificador(deps: {
  banco: Banco;
  config: Config;
  registro: Registro;
}): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      const chave = await buscarChaveDeAcesso(
        deps.banco,
        token,
        deps.config.urlMcp.href,
      );
      if (!chave) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Chave inválida, vencida ou revogada.",
        );
      }
      marcarUso(deps.banco, chave.conexaoId).catch((erro) =>
        deps.registro.aviso("não consegui marcar o uso da conexão", { erro }),
      );
      const extra: ExtraDaChave = {
        conexaoId: chave.conexaoId,
        usuarioId: chave.usuarioId,
        unidadeId: chave.unidadeId,
        unidadeNome: chave.unidadeNome,
      };
      return {
        token,
        clientId: chave.clientId,
        scopes: chave.escopos,
        expiresAt: Math.floor(chave.expiraEm.getTime() / 1000),
        resource: new URL(deps.config.urlMcp.href),
        extra,
      };
    },
  };
}
