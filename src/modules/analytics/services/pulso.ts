import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import { escopoVendas, periodoVendas } from "../schemas/vendas";
import { deslocarDia, periodoProvisorio, resumirHoras } from "../schemas/pulso";

export async function consultarPulso(
  contexto: ContextoSessao,
  de: string,
  ate: string,
  agora = new Date(),
) {
  if (!pode(contexto, "analytics.ver")) throw new SemPermissao("ver vendas");
  periodoVendas(de, ate);
  const escopo = escopoVendas(contexto);
  const hoje = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(agora);
  const anteriorDe = deslocarDia(de, -7),
    anteriorAte = deslocarDia(ate, -7);
  // Hoje é comparado apenas até o mesmo horário na semana anterior.
  const corte = ate === hoje ? new Date(agora.getTime() - 7 * 86400000) : null;
  const [anterior, horas, horasAnteriores, ultimaVenda] = await Promise.all([
    db.saiposVenda.aggregate({
      where: {
        ...escopo,
        excluidoEm: null,
        cancelada: false,
        dataTurno: { gte: anteriorDe, lte: anteriorAte },
        ...(corte ? { criadaNoSaiposEm: { lte: corte } } : {}),
      },
      _sum: { totalCentavos: true },
      _count: { _all: true },
    }),
    db.saiposVenda.findMany({
      where: { ...escopo, excluidoEm: null, dataTurno: ate },
      select: { criadaNoSaiposEm: true, totalCentavos: true, cancelada: true },
    }),
    db.saiposVenda.findMany({
      where: {
        ...escopo,
        excluidoEm: null,
        dataTurno: anteriorAte,
        ...(corte ? { criadaNoSaiposEm: { lte: corte } } : {}),
      },
      select: { criadaNoSaiposEm: true, totalCentavos: true, cancelada: true },
    }),
    db.saiposVenda.aggregate({
      where: { ...escopo, excluidoEm: null },
      _max: { criadaNoSaiposEm: true },
    }),
  ]);
  return {
    anteriorDe,
    anteriorAte,
    anteriorCentavos: anterior._sum.totalCentavos ?? 0,
    anteriorQuantidade: anterior._count._all,
    horas: resumirHoras(horas),
    horasAnteriores: resumirHoras(horasAnteriores),
    ultimaVendaEm: ultimaVenda._max.criadaNoSaiposEm,
    hoje: ate === hoje,
    provisorio: periodoProvisorio(ate, hoje),
  };
}
