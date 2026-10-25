import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import { conferirTotal, detalharCanais } from "../schemas/conferencia";
import { escopoVendas, periodoVendas, resumirDias } from "../schemas/vendas";

export async function consultarVendas(
  contexto: ContextoSessao,
  de: string,
  ate: string,
) {
  if (!pode(contexto, "analytics.ver")) throw new SemPermissao("ver vendas");
  periodoVendas(de, ate);
  const escopo = escopoVendas(contexto);
  const consultaLinhas = db.saiposVenda.groupBy({
    by: ["dataTurno", "cancelada", "origem", "modalidade", "canalImportado"],
    where: {
      ...escopo,
      excluidoEm: null,
      dataTurno: { gte: de, lte: ate },
    },
    _count: { _all: true },
    _sum: { totalCentavos: true },
  });
  const [vinculos, linhas, referencia] = await db.$transaction(
    [
      db.saiposVinculo.findMany({
        where: { ...escopo, excluidoEm: null },
        select: {
          unidadeId: true,
          unidade: { select: { nome: true } },
          coberturaDesde: true,
          cursor: true,
          ultimoSucessoEm: true,
          ultimaTentativaEm: true,
          solicitadaEm: true,
          ultimoErro: true,
          habilitado: true,
          canaisAte: true,
          ultimoErroCanais: true,
        },
      }),
      consultaLinhas,
      db.saiposReferenciaFechamento.findFirst({
        where: { ...escopo, de, ate, excluidoEm: null },
        select: {
          totalCentavos: true,
          versao: true,
          atualizadoEm: true,
          informadaPor: { select: { nome: true } },
        },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  const incompleto =
    vinculos.length !== escopo.unidadeId.in.length ||
    vinculos.length === 0 ||
    vinculos.some(
      (v) =>
        !v.coberturaDesde ||
        v.coberturaDesde > de ||
        !v.cursor ||
        v.cursor.slice(0, 10) < ate,
    );
  const resumo = resumirDias(linhas);
  return {
    ...resumo,
    ...detalharCanais(linhas),
    referencia: contexto.unidadeAtiva ? referencia : null,
    conferencia: conferirTotal(
      resumo.centavos,
      contexto.unidadeAtiva ? (referencia?.totalCentavos ?? null) : null,
      incompleto,
    ),
    vinculos,
    incompleto,
    automatico: process.env.SAIPOS_SYNC_ENABLED === "true",
  };
}
