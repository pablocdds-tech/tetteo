import pg from "pg";

/**
 * UM BACKUP LÓGICO DOS DADOS — só para o cenário 12 do ensaio.
 *
 * Em produção o backup do banco do Tetteo é o `pg_dump` (ver
 * docs/operacao/whatsapp). Nesta máquina não há `pg_dump`: o PostgreSQL do
 * ensaio é o `embedded-postgres`, que só traz o servidor. Este arquivo faz o
 * equivalente para o que o cenário precisa provar — que TODOS os dados do
 * banco, copiados para fora e devolvidos a um banco novo, trazem a
 * configuração de volta e NÃO trazem segredo nenhum, porque segredo não mora
 * no banco.
 */

// Horário sem fuso volta como texto: convertê-lo para Date aplicaria o fuso
// desta máquina e o devolveria três horas deslocado.
pg.types.setTypeParser(1114, (valor: string) => valor);

async function comCliente<T>(url: string, fazer: (c: pg.Client) => Promise<T>) {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    return await fazer(cliente);
  } finally {
    await cliente.end();
  }
}

export async function exportarBanco(url: string): Promise<string> {
  return comCliente(url, async (c) => {
    const { rows: tabelas } = await c.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
          and table_name <> '_prisma_migrations'
        order by table_name`,
    );
    const copia: Record<string, unknown[]> = {};
    for (const { table_name } of tabelas) {
      copia[table_name] = (await c.query(`select * from "${table_name}"`)).rows;
    }
    return JSON.stringify(copia);
  });
}

export async function restaurarBanco(
  url: string,
  texto: string,
): Promise<void> {
  const copia = JSON.parse(texto) as Record<string, unknown[]>;
  await comCliente(url, async (c) => {
    await c.query("begin");
    // Chaves estrangeiras desligadas só dentro desta transação: a ordem das
    // tabelas deixa de importar.
    await c.query("set local session_replication_role = replica");
    // Esvazia TUDO antes de devolver qualquer coisa. Esvaziar tabela por
    // tabela, com CASCADE, apagava de novo o que acabara de voltar numa
    // tabela filha — os avisos sumiam quando chegava a vez das conexões.
    const tabelas = Object.keys(copia).map((t) => `"${t}"`);
    if (tabelas.length > 0) {
      await c.query(`truncate ${tabelas.join(", ")} cascade`);
    }
    for (const [tabela, linhas] of Object.entries(copia)) {
      if (linhas.length === 0) continue;
      await c.query(
        `insert into "${tabela}" select * from json_populate_recordset(null::"${tabela}", $1)`,
        [JSON.stringify(linhas)],
      );
    }
    await c.query("commit");
  });
}

export async function consultar<T extends pg.QueryResultRow>(
  url: string,
  sql: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  return comCliente(url, async (c) => (await c.query<T>(sql, parametros)).rows);
}
