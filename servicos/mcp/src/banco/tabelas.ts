import { readFile } from "node:fs/promises";

import type { Banco } from "./conexao.js";

const ARQUIVO = new URL("../../sql/02-tabelas.sql", import.meta.url);

/** Cria as tabelas do esquema `mcp`, se ainda não existirem. */
export async function prepararTabelas(banco: Banco): Promise<void> {
  const sql = await readFile(ARQUIVO, "utf8");
  const cliente = await banco.connect();
  try {
    await cliente.query("BEGIN");
    // Duas cópias do serviço subindo juntas não brigam pelo CREATE TABLE.
    await cliente.query(
      "SELECT pg_advisory_xact_lock(hashtext('tetteo_mcp.tabelas'))",
    );
    await cliente.query(sql);
    await cliente.query("COMMIT");
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}
