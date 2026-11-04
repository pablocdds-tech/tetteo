import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

const dataBrasilia = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
});

/** Snapshot dos dados já importados. Esta leitura nunca consulta a Saipos. */
export async function consultarOperacaoSaiposHoje(
  contexto: ContextoSessao,
  agora = new Date(),
) {
  if (!pode(contexto, "analytics.ver")) throw new SemPermissao("ver vendas");
  const unidade = contexto.unidadeAtiva;
  if (!unidade) throw new ExigeUnidade();
  if (!contexto.unidadesVisiveis.some((u) => u.id === unidade.id))
    throw new SemPermissao("acessar esta unidade");
  const existe = await db.unidade.findFirst({
    where: {
      id: unidade.id,
      organizacaoId: contexto.organizacao.id,
      ativa: true,
      excluidoEm: null,
      organizacao: { ativa: true, excluidoEm: null },
    },
    select: { id: true },
  });
  if (!existe) throw new SemPermissao("acessar esta unidade");

  const hoje = dataBrasilia.format(agora);
  const escopo = {
    organizacaoId: contexto.organizacao.id,
    unidadeId: unidade.id,
    excluidoEm: null,
  };
  // O dia é o do turno Saipos, inclusive quando a criação ocorre após meia-noite.
  const onde = {
    ...escopo,
    dataTurno: hoje,
    criadaNoSaiposEm: { lte: agora },
  };
  const [vinculo, vendas, canceladas, recentes] = await db.$transaction(
    [
      db.saiposVinculo.findFirst({
        where: escopo,
        select: {
          ultimoSucessoEm: true,
          ultimaTentativaEm: true,
          solicitadaEm: true,
          ultimoErro: true,
          habilitado: true,
          cursor: true,
        },
      }),
      db.saiposVenda.aggregate({
        where: { ...onde, cancelada: false },
        _sum: { totalCentavos: true },
        _count: { _all: true },
      }),
      db.saiposVenda.count({ where: { ...onde, cancelada: true } }),
      db.saiposVenda.findMany({
        where: onde,
        select: {
          id: true,
          vendaExternaId: true,
          criadaNoSaiposEm: true,
          totalCentavos: true,
          cancelada: true,
          origem: true,
          modalidade: true,
        },
        orderBy: [{ criadaNoSaiposEm: "desc" }, { id: "desc" }],
        take: 5,
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    hoje,
    quantidade: vendas._count._all,
    centavos: vendas._sum.totalCentavos ?? 0,
    canceladas,
    recentes: recentes.map((venda) => ({
      ...venda,
      criadaNoSaiposEm: venda.criadaNoSaiposEm.toISOString(),
    })),
    vinculo: vinculo
      ? {
          ...vinculo,
          ultimoSucessoEm: vinculo.ultimoSucessoEm?.toISOString() ?? null,
          ultimaTentativaEm: vinculo.ultimaTentativaEm?.toISOString() ?? null,
          solicitadaEm: vinculo.solicitadaEm?.toISOString() ?? null,
        }
      : null,
    automatico: process.env.SAIPOS_SYNC_ENABLED === "true",
    consultadoEm: agora.toISOString(),
  };
}
