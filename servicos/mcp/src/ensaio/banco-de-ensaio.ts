import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

/**
 * UM BANCO DESCARTÁVEL PARA OS TESTES DE INTEGRAÇÃO.
 *
 * Cria um banco novo (com `_test` no nome) e aplica as MIGRAÇÕES REAIS do
 * Tetteo — as mesmas SQL que o Prisma roda em produção —, depois o
 * `01-preparar-banco.sql` como administrador. O teste enxerga as colunas de
 * verdade: se uma migração futura mudar `usuario`, a visão quebra aqui antes
 * de quebrar em produção.
 *
 * Duas travas, como no ambiente de teste do app principal: sem
 * MCP_ENSAIO_PG_URL não roda, e fora de localhost recusa.
 */

export type BancoDeEnsaio = {
  /** Conecta como `tetteo_mcp` — o mesmo papel que o serviço usa. */
  urlDoServico: string;
  /** Conexão de administrador, para montar e bagunçar cenários. */
  admin: pg.Client;
  encerrar(): Promise<void>;
};

const MIGRACOES = fileURLToPath(
  new URL("../../../../prisma/schema/migrations/", import.meta.url),
);
const PREPARAR = fileURLToPath(
  new URL("../../sql/01-preparar-banco.sql", import.meta.url),
);

export function urlDeEnsaio(): string | null {
  const url = process.env.MCP_ENSAIO_PG_URL;
  if (!url) return null;
  const { hostname } = new URL(url);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `Recusado: MCP_ENSAIO_PG_URL aponta para ${hostname}. Testes só rodam em banco local.`,
    );
  }
  return url;
}

export async function criarBancoDeEnsaio(): Promise<BancoDeEnsaio> {
  const base = urlDeEnsaio();
  if (!base) throw new Error("Falta MCP_ENSAIO_PG_URL.");
  const nome = `mcp_ensaio_${randomBytes(4).toString("hex")}_test`;

  const raiz = new pg.Client({ connectionString: base });
  await raiz.connect();
  await raiz.query(`CREATE DATABASE ${nome}`);
  await raiz.end();

  const urlAdmin = new URL(base);
  urlAdmin.pathname = `/${nome}`;
  const admin = new pg.Client({ connectionString: urlAdmin.href });
  await admin.connect();

  const pastas = (await readdir(MIGRACOES, { withFileTypes: true }))
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();
  for (const pasta of pastas) {
    await admin.query(
      await readFile(join(MIGRACOES, pasta, "migration.sql"), "utf8"),
    );
  }
  await admin.query(await readFile(PREPARAR, "utf8"));

  // base64url: sem aspas nem barras, seguro dentro do literal SQL e da URL.
  const senha = randomBytes(18).toString("base64url");
  await admin.query(`ALTER ROLE tetteo_mcp PASSWORD '${senha}'`);
  const urlDoServico = new URL(urlAdmin.href);
  urlDoServico.username = "tetteo_mcp";
  urlDoServico.password = senha;

  return {
    urlDoServico: urlDoServico.href,
    admin,
    async encerrar() {
      await admin.end();
      const final = new pg.Client({ connectionString: base });
      await final.connect();
      await final.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
      await final.end();
    },
  };
}
