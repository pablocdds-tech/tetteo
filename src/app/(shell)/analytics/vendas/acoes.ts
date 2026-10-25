"use server";
import { ZodError } from "zod";
import { SemPermissao } from "@/lib/erros";
import { ErroReferencia } from "@/modules/analytics/schemas/conferencia";
import { registrarReferencia } from "@/modules/analytics/services/referencias";
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

export async function salvarReferencia(
  formData: FormData,
): Promise<{ ok: boolean; mensagem: string; versao?: number }> {
  try {
    const contexto = await obterContexto();
    if (!contexto)
      return {
        ok: false,
        mensagem: "Entre novamente para registrar a referência.",
      };
    const salvo = await registrarReferencia(contexto, {
      de: formData.get("de"),
      ate: formData.get("ate"),
      total: formData.get("total"),
      versao: formData.get("versao"),
    });
    revalidatePath("/analytics/vendas");
    return {
      ok: true,
      mensagem:
        "Referência salva com auditoria. A comparação será recalculada a cada atualização.",
      versao: salvo.versao,
    };
  } catch (erro) {
    if (erro instanceof ZodError)
      return {
        ok: false,
        mensagem: erro.issues[0]?.message ?? "Confira os campos informados.",
      };
    if (erro instanceof ErroReferencia)
      return { ok: false, mensagem: erro.message };
    if (erro instanceof SemPermissao)
      return {
        ok: false,
        mensagem:
          "Somente o diretor autorizado nesta unidade pode registrar referências.",
      };
    const codigo =
      typeof erro === "object" && erro !== null && "code" in erro
        ? erro.code
        : null;
    return {
      ok: false,
      mensagem:
        codigo === "P2002" || codigo === "P2034"
          ? "Os dados mudaram durante o registro. Carregue a referência atual e tente novamente."
          : "Não foi possível registrar a referência. Tente novamente.",
    };
  }
}
