import { config } from "dotenv";

/**
 * O AMBIENTE DOS TESTES COM BANCO.
 *
 * Carregado antes de qualquer teste de integração (`--import`), e antes de
 * qualquer import do `db` — o cliente do Prisma lê `DATABASE_URL` no momento
 * em que nasce, então trocar a variável depois não adiantaria nada.
 *
 * Duas travas, e as duas existem porque estes testes APAGAM tabelas inteiras:
 *
 *   sem `DATABASE_URL_TESTE`  → recusa. Nunca cai no banco de desenvolvimento
 *                               por omissão.
 *   fora de localhost         → recusa. Um teste que trunca `pedido` não pode
 *                               ter como alvo, nem por engano, o banco da VPS.
 */

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL_TESTE;

if (!url) {
  console.error(
    "Falta DATABASE_URL_TESTE no .env.local. Os testes de integração apagam dados e só rodam num banco próprio para isso.",
  );
  process.exit(1);
}

const { hostname, pathname } = new URL(url);

if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  console.error(
    `Recusado: DATABASE_URL_TESTE aponta para ${hostname}. Testes de integração só rodam em banco local.`,
  );
  process.exit(1);
}

if (!/_test/.test(pathname)) {
  console.error(
    "Recusado: o nome do banco de teste precisa conter _test (ex.: tetteo_compras_teste).",
  );
  process.exit(1);
}

process.env.DATABASE_URL = url;

// Nenhuma mensagem real sai de um teste: o canal é o simulador, e o conector
// de WhatsApp recusa com NODE_ENV=test mesmo que alguém mude a variável.
Object.assign(process.env, { NODE_ENV: "test", COMPRAS_CANAL: "simulador" });
