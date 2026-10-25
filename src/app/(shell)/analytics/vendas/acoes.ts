"use server";
import { revalidatePath } from "next/cache";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { db } from "@/server/db";
export async function solicitarAtualizacao() {
  const contexto = await obterContexto();
  const unidade = contexto?.unidadeAtiva;
  if (
    !contexto?.ehDiretor ||
    !pode(contexto, "analytics.ver") ||
    !unidade ||
    !contexto.unidadesVisiveis.some((u) => u.id === unidade.id)
  )
    throw new Error("Sem permissão para atualizar esta unidade.");
  if (process.env.SAIPOS_SYNC_ENABLED !== "true")
    throw new Error("Atualização automática pausada no ambiente.");
  await db.$transaction(async (tx) => {
    const vinculo = await tx.saiposVinculo.findFirst({
      where: {
        organizacaoId: contexto.organizacao.id,
        unidadeId: unidade.id,
        habilitado: true,
        excluidoEm: null,
      },
    });
    if (
      !vinculo ||
      (vinculo.solicitadaEm &&
        (!vinculo.ultimaTentativaEm ||
          vinculo.solicitadaEm > vinculo.ultimaTentativaEm))
    )
      return;
    const agora = new Date();
    const reservado = await tx.saiposVinculo.updateMany({
      where: {
        id: vinculo.id,
        solicitadaEm: vinculo.solicitadaEm,
        OR: [{ concessaoAte: null }, { concessaoAte: { lt: agora } }],
      },
      data: { solicitadaEm: agora },
    });
    if (!reservado.count) return;
    await tx.auditoria.create({
      data: {
        organizacaoId: contexto.organizacao.id,
        unidadeId: unidade.id,
        usuarioId: contexto.usuario.id,
        entidade: "SaiposVinculo",
        entidadeId: vinculo.id,
        acao: "ALTEROU",
        valoresDepois: { atualizacaoSolicitadaEm: agora.toISOString() },
      },
    });
  });
  revalidatePath("/analytics/vendas");
}
