import pg from "pg";

import type { Registro } from "../registro.js";

/**
 * O POOL DE CONEXÕES COM O BANCO.
 *
 * Pequeno e com tempos curtos. O servidor MCP responde perguntas simples; uma
 * consulta que passa de 5 s é defeito, e é melhor falhar cedo com `isError`
 * do que segurar a conversa do Claude. O papel `tetteo_mcp` também tem
 * `statement_timeout` no próprio banco — as duas travas se somam de propósito.
 */

export type Banco = pg.Pool;

export function criarBanco(url: string, registro: Registro): Banco {
  const banco = new pg.Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: "tetteo-mcp",
  });
  // Sem este ouvinte, uma conexão ociosa que cai derruba o processo inteiro.
  banco.on("error", (erro) =>
    registro.aviso("uma conexão ociosa com o banco caiu", { erro }),
  );
  return banco;
}
