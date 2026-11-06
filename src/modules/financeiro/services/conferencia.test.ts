import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { conciliar, type LinhaMotor } from "../schemas/conferencia";

const ctx: ContextoSessao = {
  usuario: {
    id: "diretor",
    nome: "Diretor",
    email: "diretor@example.test",
    avatarUrl: null,
  },
  organizacao: { id: "org-teste", nome: "Organização de teste" },
  unidadeAtiva: { id: "matriz", nome: "Matriz", codigo: "A" },
  unidadesVisiveis: [{ id: "matriz", nome: "Matriz", codigo: "A" }],
  podeVerRedeInteira: false,
  ehDiretor: true,
  permissoes: new Set(["financeiro.ver"]),
};
const escopo = { organizacaoId: "org-teste", unidadeId: "matriz" };
const periodo = { de: "2026-10-19", ate: "2026-10-20" };
const bancoAte = new Date(Date.parse(periodo.de) + 730 * 86400000)
  .toISOString()
  .slice(0, 10);

async function servicos() {
  process.env.DATABASE_URL ??=
    "postgresql://teste:teste@localhost:5432/conferencia_test";
  // Prisma expõe os delegates via proxy. Um cliente local permite substituições
  // do node:test sem conexão, mantendo o código real de consulta/exportação.
  const globalTeste = globalThis as unknown as { prisma?: unknown };
  const inesperado = async () => {
    throw new Error("Consulta não prevista no teste");
  };
  globalTeste.prisma ??= {
    $transaction: inesperado,
    conferenciaExecucao: { findFirst: inesperado, findMany: inesperado },
    conferenciaImportacao: { findMany: inesperado },
    conferenciaContrato: { findMany: inesperado },
    conferenciaCorrespondencia: {
      count: inesperado,
      findMany: inesperado,
      groupBy: inesperado,
    },
  };
  const { db } = await import("@/server/db");
  return { db, ...(await import("./conferencia")) };
}

test("consulta execução concluída com período bancário de 730 dias e preserva os limites de vendas", async (t) => {
  const { db, consultarConferencia, listarImportacoes } = await servicos();
  const execucao = {
    id: "execucao-ampliada",
    ...escopo,
    ...periodo,
    criadoEm: new Date("2026-10-21"),
    periodoEfetivo: {
      vendas: periodo,
      banco: { de: periodo.de, ate: bancoAte },
    },
    fontesVersao: { importacoes: [{ id: "extrato-tardio" }] },
  };
  t.mock.method(
    db.conferenciaExecucao,
    "findFirst",
    async ({ where }: { where: object }) => {
      assert.deepEqual(where, {
        ...escopo,
        ...periodo,
        ...("id" in where ? { id: execucao.id } : {}),
      });
      return execucao;
    },
  );
  t.mock.method(db.conferenciaExecucao, "findMany", async () => [execucao]);
  const consultaImportacoes = t.mock.method(
    db.conferenciaImportacao,
    "findMany",
    async ({ where }: { where: object }) => {
      assert.deepEqual(where, {
        ...escopo,
        de: { lte: bancoAte },
        ate: { gte: periodo.de },
      });
      return [{ id: "extrato-tardio", estado: "CONFIRMADA" }];
    },
  );
  t.mock.method(db.conferenciaContrato, "findMany", async () => []);
  t.mock.method(db.conferenciaCorrespondencia, "count", async () => 0);
  t.mock.method(db.conferenciaCorrespondencia, "findMany", async () => []);
  t.mock.method(db.conferenciaCorrespondencia, "groupBy", async () => []);
  t.mock.method(db, "$transaction", async (consultas: Promise<unknown>[]) =>
    Promise.all(consultas),
  );

  for (const execucaoId of [undefined, execucao.id]) {
    const r = await consultarConferencia(ctx, { ...periodo, execucaoId });
    assert.equal(r.execucao?.id, execucao.id);
    assert.equal(r.historico[0].id, execucao.id);
    assert.equal(r.importacoes[0].id, "extrato-tardio");
    assert.equal(r.desatualizada, false);
  }
  assert.equal(consultaImportacoes.mock.callCount(), 2);
  await assert.rejects(() =>
    consultarConferencia(ctx, { de: periodo.de, ate: bancoAte }),
  );
  await assert.rejects(() => listarImportacoes(ctx, periodo.de, bancoAte));
  for (const contexto of [
    { ...ctx, permissoes: new Set<string>() },
    { ...ctx, unidadesVisiveis: [] },
  ])
    await assert.rejects(() => consultarConferencia(contexto, periodo));
  assert.equal(consultaImportacoes.mock.callCount(), 2);
});

test("CSV preserva arquivo, linha e hash do crédito de lote sem venda, com auditoria e sem receita atribuída", async (t) => {
  const { db, exportarConferencia } = await servicos();
  const comum = {
    ...escopo,
    provider: "DEMO",
    merchantRef: "est-demo",
    accountRef: "conta-demo",
    businessDay: periodo.de,
    method: "CREDIT",
    brand: "VISA",
    installments: 1,
    adjustmentCents: 0,
    status: "SETTLED" as const,
    payoutRef: "lote-sem-venda",
    expectedSettlementDay: periodo.ate,
  };
  const linhas: LinhaMotor[] = [
    {
      ...comum,
      id: "recebivel",
      fonte: "ADQUIRENTE",
      grossCents: 10000,
      feeCents: 300,
      netCents: 9700,
    },
    {
      ...comum,
      id: "credito",
      fonte: "BANCO",
      businessDay: periodo.ate,
      amountCents: 9700,
      direction: "CREDIT",
    },
  ];
  const cobertura = {
    VENDA: { ...periodo, completa: false, importacoes: [] },
    ADQUIRENTE: { ...periodo, completa: true, importacoes: ["adquirente"] },
    BANCO: { ...periodo, completa: true, importacoes: ["banco"] },
  };
  const motor = conciliar({ ...escopo, linhas, cobertura, contratos: [] });
  let auditorias = 0;
  const tx = {
    conferenciaExecucao: {
      findFirst: async () => ({
        id: "execucao-sem-venda",
        periodoEfetivo: { vendas: periodo, banco: periodo },
        regrasVersao: "teste",
        cobertura,
        totais: motor.totais,
      }),
    },
    conferenciaCorrespondencia: {
      findMany: async () =>
        motor.resultados.map((dados, i) => ({
          id: `r-${i}`,
          dados,
          caso: { decisoes: [] },
        })),
    },
    conferenciaLinha: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        assert.deepEqual(where, { ...escopo, id: where.id });
        return linhas
          .filter((l) => where.id.in.includes(l.id))
          .map((l) => ({
            id: l.id,
            numero: l.fonte === "BANCO" ? 42 : 2,
            importacaoId: l.fonte,
            importacao: {
              nomeArquivo: `${l.fonte}.csv`,
              arquivoHash: `hash-${l.fonte}`,
            },
          }));
      },
    },
    conferenciaEvento: { create: async () => undefined },
    auditoria: {
      create: async () => {
        auditorias++;
      },
    },
  };
  t.mock.method(
    db,
    "$transaction",
    async (fn: (repo: unknown) => Promise<unknown>) => fn(tx),
  );
  const csv = await exportarConferencia(ctx, periodo);
  assert.match(
    csv,
    /BANCO.csv \| import BANCO \| linha 42 \| SHA256 hash-BANCO/,
  );
  assert.equal(motor.totais.creditadoCentavos, 9700);
  assert.equal(motor.totais.vendidoCentavos, 0);
  assert.equal(
    motor.resultados.reduce((s, r) => s + r.creditoAlocadoCentavos, 0),
    0,
  );
  assert.equal(auditorias, 1);
});
