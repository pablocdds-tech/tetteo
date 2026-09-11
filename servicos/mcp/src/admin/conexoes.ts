import { existsSync } from "node:fs";

import { criarBanco } from "../banco/conexao.js";
import {
  listarConexoes,
  revogarConexao,
  revogarConexoesDoUsuario,
} from "../oauth/armazem.js";
import { criarRegistro } from "../registro.js";

/**
 * AS CONEXÕES, PELO TERMINAL.
 *
 *   node dist/admin/conexoes.js listar
 *   node dist/admin/conexoes.js revogar <id-da-conexão>
 *   node dist/admin/conexoes.js revogar-usuario <e-mail>
 *
 * Roda dentro do contêiner (terminal do Dokploy), com a mesma DATABASE_URL do
 * serviço. Não mostra chave nenhuma — o banco nem as tem em claro.
 */

if (process.env.NODE_ENV !== "production" && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const [comando, argumento] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const banco = criarBanco(
  url,
  criarRegistro((linha) => process.stderr.write(`${linha}\n`)),
);

try {
  if (comando === "listar") {
    const conexoes = await listarConexoes(banco);
    if (conexoes.length === 0) console.log("Nenhuma conexão.");
    for (const conexao of conexoes) {
      console.log(
        [
          conexao.id,
          conexao.revogadaEm ? `REVOGADA (${conexao.motivo})` : "ativa",
          conexao.email ?? "(pessoa sem acesso)",
          conexao.unidadeNome ?? "-",
          conexao.clienteNome,
          `criada ${conexao.criadaEm.toISOString()}`,
          conexao.ultimoUsoEm
            ? `último uso ${conexao.ultimoUsoEm.toISOString()}`
            : "nunca usada",
        ].join(" · "),
      );
    }
  } else if (comando === "revogar" && argumento) {
    await revogarConexao(banco, argumento, "revogada pelo administrador");
    console.log(`Conexão ${argumento}: revogada (se existia).`);
  } else if (comando === "revogar-usuario" && argumento) {
    const quantas = await revogarConexoesDoUsuario(banco, argumento);
    console.log(`${quantas} conexão(ões) revogada(s).`);
  } else {
    console.log(
      "Uso: conexoes listar | revogar <id> | revogar-usuario <e-mail>",
    );
    process.exitCode = 1;
  }
} finally {
  await banco.end();
}
