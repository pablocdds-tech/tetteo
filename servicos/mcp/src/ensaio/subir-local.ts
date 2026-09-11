import { writeFileSync } from "node:fs";

import { criarBancoDeEnsaio } from "./banco-de-ensaio.js";
import { semear } from "./semente.js";

/**
 * PREPARA UM BANCO DE ENSAIO PARA RODAR O SERVIDOR DE VERDADE NA MÁQUINA.
 *
 * Cria o banco (com as migrações reais do Tetteo e o 01-preparar-banco.sql),
 * semeia as pessoas de ensaio e escreve `servicos/mcp/.env.local` (fora do
 * git) com a DATABASE_URL do papel tetteo_mcp. Não imprime a URL.
 * O banco some quando o Postgres de ensaio for desligado.
 */

const porta = process.argv[2] ?? "8787";
const ensaio = await criarBancoDeEnsaio();
await semear(ensaio.admin);
await ensaio.admin.end();

writeFileSync(
  ".env.local",
  [
    `DATABASE_URL=${ensaio.urlDoServico}`,
    `MCP_URL_PUBLICA=http://127.0.0.1:${porta}`,
    `PORT=${porta}`,
    "",
  ].join("\n"),
);
console.log(
  `Banco de ensaio pronto e .env.local escrito. Rode: npm run dev (porta ${porta}).`,
);
