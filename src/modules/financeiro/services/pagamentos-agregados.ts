import type { Prisma } from "@prisma/client";

/** A consulta de uma página não transporta cada baixa histórica para o Node. */
export async function pagamentosAgregados(
  tx: Prisma.TransactionClient,
  escopo: { organizacaoId: string; unidadeId: string },
  lancamento: Prisma.LancamentoWhereInput,
) {
  const linhas = [];
  for (const direcao of ["PAGAR", "RECEBER"] as const) {
    const grupos = await tx.baixaFinanceira.groupBy({
      by: ["contaId", "dataPagamento"],
      where: {
        ...escopo,
        estornadoEm: null,
        lancamento: { AND: [lancamento, { direcao }] },
      },
      _sum: { valor: true },
    });
    linhas.push(
      ...grupos.map((g) => ({
        contaId: g.contaId,
        dataPagamento: g.dataPagamento,
        valor: g._sum.valor ?? 0,
        lancamento: { direcao },
      })),
    );
  }
  return linhas;
}
