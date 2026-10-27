import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

export type EscopoPdv = { organizacaoId: string; unidadeId: string };

export async function exigirEscopo(
  contexto: ContextoSessao,
  permissao = "pdv.ver",
): Promise<EscopoPdv> {
  if (!pode(contexto, "pdv.ver") || !pode(contexto, permissao))
    throw new SemPermissao("acessar esta operação do PDV");
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
    },
    select: { id: true },
  });
  if (!existe) throw new SemPermissao("acessar esta unidade");
  return { organizacaoId: contexto.organizacao.id, unidadeId: unidade.id };
}
