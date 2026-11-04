import { Prisma } from "@prisma/client";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { exigirEscopo } from "./escopo";
import { filtrosDaOperacao } from "../schemas/resumo-operacao";

/** Leitura do painel: não processa recebimentos nem avança pedidos agendados. */
export async function consultarResumoOperacao(
  contexto: ContextoSessao,
  agora = new Date(),
) {
  const escopo = await exigirEscopo(contexto);
  const filtros = filtrosDaOperacao(escopo, agora);
  const consultaEtapas = {
    by: ["status"],
    orderBy: { status: "asc" },
    where: filtros.aoVivo,
    _count: { _all: true },
  } satisfies Prisma.PdvPedidoGroupByArgs;
  const etapasDaOperacao = db.pdvPedido.groupBy(consultaEtapas);
  const [hoje, semana, pedidosSemana, etapas, recentes] = await db.$transaction(
    [
      db.pdvVenda.aggregate({
        where: filtros.vendasHoje,
        _sum: { totalCentavos: true },
        _count: { _all: true },
      }),
      db.pdvVenda.aggregate({
        where: filtros.vendasSemana,
        _sum: { totalCentavos: true },
        _count: { _all: true },
      }),
      db.pdvPedido.count({ where: filtros.pedidosSemana }),
      etapasDaOperacao,
      db.pdvPedido.findMany({
        where: filtros.aoVivo,
        select: {
          id: true,
          numero: true,
          status: true,
          criadoEm: true,
        },
        orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
        take: 5,
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return {
    hoje: filtros.janela.hoje,
    de: filtros.janela.de,
    atualizadoEm: agora.toISOString(),
    faturamentoHoje: hoje._sum.totalCentavos ?? 0,
    faturamentoSemana: semana._sum.totalCentavos ?? 0,
    vendasHoje: hoje._count._all,
    vendasSemana: semana._count._all,
    pedidosSemana,
    etapas: etapas.map((e) => ({
      status: e.status,
      quantidade: e._count._all,
    })),
    aoVivo: etapas.reduce((total, e) => total + e._count._all, 0),
    recentes: recentes.map((p) => ({
      id: p.id,
      numero: p.numero,
      status: p.status,
      minutos: Math.max(
        0,
        Math.floor((agora.getTime() - p.criadoEm.getTime()) / 60_000),
      ),
    })),
  };
}
