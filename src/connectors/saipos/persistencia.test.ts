import test from "node:test";
import assert from "node:assert/strict";
import { SaiposClient, SaiposError, type SaiposSale } from "./client";

test("upsert conserva chave e cancelamento; falha não confirma cursor; segundo worker é recusado", async () => {
  process.env.DATABASE_URL ??=
    "postgresql://teste:teste@localhost:5432/saipos_test";
  const { sincronizarVendas } = await import("./sincronizar");
  type Estado = {
    id: string;
    organizacaoId: string;
    unidadeId: string;
    lojaSaiposId: number;
    cursor: string | null;
    coberturaDesde: string | null;
    concessaoDono: string | null;
    concessaoAte: Date | null;
    ultimoErro?: string | null;
    canaisAte?: string | null;
    ultimoErroCanais?: string | null;
  };
  type Venda = {
    id: string;
    vendaExternaId: string;
    totalCentavos: number;
    cancelada: boolean;
    dataTurno: string;
    alteradaNoSaiposEm: Date;
    origem?: string | null;
    modalidade?: number | null;
    canalImportado?: boolean;
  };
  let estado: Estado = {
    id: "vinculo",
    organizacaoId: "rede-a",
    unidadeId: "matriz-a",
    lojaSaiposId: 20437,
    cursor: null,
    coberturaDesde: null,
    concessaoDono: null,
    concessaoAte: null,
  };
  let linhas = new Map<string, Venda>();
  let falhar = false,
    cancelada: "Y" | "N" = "N",
    auditorias = 0;
  let detalhado = false,
    falharHistorico = false,
    valor = 64.44;
  const venda = (): SaiposSale => ({
    id_store: 20437,
    id_sale: 10,
    total_amount: valor,
    ...(detalhado
      ? { id_sale_type: 1, partner_sale: { desc_partner_sale: "iFood" } }
      : {}),
    canceled: cancelada,
    shift_date: "2026-10-17",
    created_at: "2026-10-17T23:00:00",
    updated_at:
      cancelada === "Y" ? "2026-10-20T01:00:00" : "2026-10-18T01:00:00",
  });
  const cliente = {
    sales: async (periodo: { start: string }) => {
      if (falharHistorico && periodo.start < "2026-10-01")
        throw new SaiposError("temporary", "Falha histórica controlada.");
      return [venda()];
    },
    incremental: async () => ({ sales: [venda()] }),
  } as unknown as SaiposClient;
  const repositorio = {
    saiposVinculo: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { concessaoDono?: string };
        data: Partial<Estado>;
      }) => {
        if (
          where.concessaoDono
            ? where.concessaoDono !== estado.concessaoDono
            : !!estado.concessaoDono
        )
          return { count: 0 };
        estado = { ...estado, ...data };
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ ...estado }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      let rascunho = { ...estado };
      const vendas = new Map(linhas);
      let novasAuditorias = 0;
      const tx = {
        saiposVinculo: {
          updateMany: async ({
            where,
            data,
          }: {
            where: { concessaoDono: string };
            data: Partial<Estado>;
          }) => {
            assert.equal(where.concessaoDono, rascunho.concessaoDono);
            rascunho = { ...rascunho, ...data };
            return { count: 1 };
          },
          update: async ({ data }: { data: Partial<Estado> }) => {
            rascunho = { ...rascunho, ...data };
          },
        },
        saiposVenda: {
          findUnique: async ({
            where,
          }: {
            where: { organizacaoId_unidadeId_vendaExternaId: object };
          }) =>
            vendas.get(
              JSON.stringify(where.organizacaoId_unidadeId_vendaExternaId),
            ) ?? null,
          upsert: async ({
            where,
            create,
            update,
          }: {
            where: {
              organizacaoId_unidadeId_vendaExternaId: {
                organizacaoId: string;
                unidadeId: string;
              };
            };
            create: Venda;
            update: Venda;
          }) => {
            if (falhar) throw new Error("Falha controlada");
            assert.equal(
              where.organizacaoId_unidadeId_vendaExternaId.organizacaoId,
              "rede-a",
            );
            assert.equal(
              where.organizacaoId_unidadeId_vendaExternaId.unidadeId,
              "matriz-a",
            );
            const chave = JSON.stringify(
              where.organizacaoId_unidadeId_vendaExternaId,
            );
            const salva = {
              ...(vendas.get(chave) ?? create),
              ...update,
              id: "venda-interna",
            };
            vendas.set(chave, salva);
            return salva;
          },
        },
        auditoria: {
          create: async () => {
            novasAuditorias++;
          },
        },
      };
      await fn(tx);
      estado = rascunho;
      linhas = vendas;
      auditorias += novasAuditorias;
    },
  } as unknown as NonNullable<Parameters<typeof sincronizarVendas>[4]>;
  await sincronizarVendas("vinculo", cliente, false, undefined, repositorio);
  assert.equal(linhas.size, 1);
  assert.ok(auditorias >= 2);
  estado.cursor = "2026-10-23T00:00:00";
  detalhado = true;
  valor = 70;
  await sincronizarVendas("vinculo", cliente, false, undefined, repositorio);
  assert.equal(linhas.size, 1);
  assert.equal([...linhas.values()][0].origem, "iFood");
  assert.equal([...linhas.values()][0].totalCentavos, 6444);
  estado.cursor = "2026-10-23T00:00:00";
  estado.canaisAte = "2026-09-24";
  estado.coberturaDesde = "2026-09-25";
  falharHistorico = true;
  await sincronizarVendas("vinculo", cliente, false, undefined, repositorio);
  assert.equal(estado.canaisAte, "2026-09-24");
  assert.match(estado.ultimoErroCanais ?? "", /Falha histórica/);
  assert.ok(estado.cursor > "2026-10-23T00:00:00");
  falharHistorico = false;
  valor = 64.44;
  estado.cursor = "2026-10-23T00:00:00";
  cancelada = "Y";
  await sincronizarVendas("vinculo", cliente, false, undefined, repositorio);
  assert.equal(linhas.size, 1);
  assert.equal([...linhas.values()][0].cancelada, true);
  estado.cursor = "2026-10-23T00:00:00";
  cancelada = "N";
  falhar = true;
  // Versão mais antiga é ignorada: força uma escrita nova para verificar falha.
  linhas.clear();
  await assert.rejects(() =>
    sincronizarVendas("vinculo", cliente, false, undefined, repositorio),
  );
  assert.equal(estado.cursor, "2026-10-23T00:00:00");
  assert.equal(estado.concessaoDono, null);
  estado.concessaoDono = "outro-worker";
  assert.deepEqual(
    await sincronizarVendas("vinculo", cliente, false, undefined, repositorio),
    { ignorada: true },
  );
});
