"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { alteracaoAutorizacaoNota } from "./schemas/autorizacao-nota";
import { alterarAutorizacaoNota } from "./services/notas-autorizacao";
import type { EstadoFormulario } from "./acoes";

export async function alterarAutorizacaoNotaAcao(
  _anterior: EstadoFormulario,
  form: FormData,
): Promise<EstadoFormulario> {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  const dados = alteracaoAutorizacaoNota.safeParse({
    vinculoId: form.get("vinculoId"),
    unidadeId: form.get("unidadeId"),
    usuarioId: form.get("usuarioId"),
    telefone: form.get("telefone"),
    autorizar: form.get("autorizar") === "sim",
    versao: Number(form.get("versao")),
  });
  if (!dados.success || !["sim", "nao"].includes(String(form.get("autorizar"))))
    return { erro: "Confira a pessoa e atualize a página antes de continuar." };
  try {
    await alterarAutorizacaoNota(ctx, dados.data);
  } catch (e) {
    if (
      e instanceof SemPermissao ||
      (e instanceof Error && e.constructor === Error)
    )
      return { erro: e.message };
    console.error("[notas] autorização não concluída");
    return {
      erro: "Não foi possível alterar a autorização. Atualize a página e tente novamente.",
    };
  }
  revalidatePath("/assistente/equipe/notas");
  revalidatePath("/assistente/equipe/vinculos");
  return { ok: true };
}
