import test from "node:test";
import assert from "node:assert/strict";
import type { ContextoSessao } from "@/core/sessao/nucleo";
const contexto: ContextoSessao = {
  usuario: {
    id: "diretor",
    nome: "Diretor teste",
    email: "diretor@example.test",
    avatarUrl: null,
  },
  organizacao: { id: "rede-a", nome: "Rede teste" },
  unidadeAtiva: { id: "matriz-a", nome: "Matriz", codigo: "MATRIZ" },
  unidadesVisiveis: [{ id: "matriz-a", nome: "Matriz", codigo: "MATRIZ" }],
  podeVerRedeInteira: false,
  permissoes: new Set(["analytics.ver"]),
  ehDiretor: true,
};
test("referência exige diretor e unidade visível; versão e auditoria são atômicas", async () => {
  process.env.DATABASE_URL ??=
    "postgresql://teste:teste@localhost:5432/saipos_test";
  const { registrarReferencia } = await import("./referencias");
  type Registro = {
    id: string;
    versao: number;
    totalCentavos: number;
    excluidoEm: null;
    informadaPorId: string;
  };
  let registro: Registro | null = null,
    auditorias = 0,
    transacoes = 0,
    falharAuditoria = false;
  const repo = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      transacoes++;
      let r: Registro | null = registro ? { ...registro } : null,
        novosLogs = 0;
      const tx = {
        saiposVinculo: {
          findFirst: async ({
            where,
          }: {
            where: { organizacaoId: string; unidadeId: string };
          }) => {
            assert.equal(where.organizacaoId, "rede-a");
            assert.equal(where.unidadeId, "matriz-a");
            return { id: "vinculo" };
          },
        },
        saiposReferenciaFechamento: {
          findUnique: async () => r,
          create: async ({ data }: { data: Registro }) => {
            r = { ...data, id: "referencia", versao: 1, excluidoEm: null };
            return r;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { versao: number; organizacaoId: string; unidadeId: string };
            data: { totalCentavos: number; informadaPorId: string };
          }) => {
            assert.equal(where.organizacaoId, "rede-a");
            assert.equal(where.unidadeId, "matriz-a");
            if (!r || r.versao !== where.versao) return { count: 0 };
            r = {
              ...r,
              totalCentavos: data.totalCentavos,
              informadaPorId: data.informadaPorId,
              versao: r.versao + 1,
            };
            return { count: 1 };
          },
        },
        auditoria: {
          create: async ({
            data,
          }: {
            data: {
              organizacaoId: string;
              unidadeId: string;
              usuarioId: string;
              valoresDepois: { totalCentavos: number };
            };
          }) => {
            assert.equal(data.organizacaoId, "rede-a");
            assert.equal(data.unidadeId, "matriz-a");
            assert.equal(data.usuarioId, "diretor");
            if (falharAuditoria) throw new Error("Falha controlada");
            novosLogs++;
          },
        },
      };
      const resultado = await fn(tx);
      registro = r;
      auditorias += novosLogs;
      return resultado;
    },
  } as unknown as NonNullable<Parameters<typeof registrarReferencia>[2]>;
  const entrada = {
    unidadeId: "matriz-a",
    de: "2026-10-24",
    ate: "2026-10-24",
    total: "10.457,38",
    versao: 0,
  };
  await assert.rejects(() =>
    registrarReferencia({ ...contexto, ehDiretor: false }, entrada, repo),
  );
  await assert.rejects(() =>
    registrarReferencia(
      { ...contexto, permissoes: new Set<string>() },
      entrada,
      repo,
    ),
  );
  await assert.rejects(() =>
    registrarReferencia({ ...contexto, unidadesVisiveis: [] }, entrada, repo),
  );
  await assert.rejects(() =>
    registrarReferencia({ ...contexto, unidadeAtiva: null }, entrada, repo),
  );
  assert.equal(transacoes, 0);
  const outra = { id: "filial-b", nome: "Filial", codigo: "B" };
  const contextoOutraAba = {
    ...contexto,
    unidadeAtiva: outra,
    unidadesVisiveis: [...contexto.unidadesVisiveis, outra],
  };
  for (const versao of [0, 1]) {
    // As duas lojas têm a mesma versão: a versão otimista não detecta a troca.
    registro = versao
      ? {
          id: "referencia-b",
          versao,
          totalCentavos: 500,
          excluidoEm: null,
          informadaPorId: "diretor",
        }
      : null;
    const antes = registro ? { ...registro } : null;
    await assert.rejects(
      () => registrarReferencia(contextoOutraAba, { ...entrada, versao }, repo),
      /unidade mudou/,
    );
    assert.deepEqual(registro, antes);
    assert.equal(transacoes, 0);
    assert.equal(auditorias, 0);
  }
  registro = null;
  for (const unidadeId of [undefined, null, "", "outra-loja"]) {
    await assert.rejects(() =>
      registrarReferencia(contexto, { ...entrada, unidadeId }, repo),
    );
  }
  assert.equal(transacoes, 0);
  const salvo = await registrarReferencia(contexto, entrada, repo);
  assert.equal(salvo.versao, 1);
  assert.equal(auditorias, 1);
  await assert.rejects(
    () => registrarReferencia(contexto, entrada, repo),
    /referência mudou/,
  );
  falharAuditoria = true;
  await assert.rejects(
    () =>
      registrarReferencia(
        contexto,
        { ...entrada, versao: 1, total: "10.500,00" },
        repo,
      ),
    /Falha controlada/,
  );
  const depois = registro as Registro | null;
  assert.equal(depois?.totalCentavos, 1045738);
  assert.equal(depois?.versao, 1);
  assert.equal(auditorias, 1);
  falharAuditoria = false;
  await registrarReferencia(
    contexto,
    { ...entrada, versao: 1, total: "10.500,00" },
    repo,
  );
  assert.equal((registro as Registro | null)?.versao, 2);
  assert.equal(auditorias, 2);
});
