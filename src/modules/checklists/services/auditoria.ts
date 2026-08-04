import type { ContextoSessao } from "@/core/sessao/contexto";
import { db } from "@/server/db";

/**
 * O rastro do módulo.
 *
 * Checklist é prova: alguém afirmou que a câmara fria estava limpa às 7h. Se
 * a afirmação puder ser trocada depois sem deixar marca, ela deixa de provar
 * qualquer coisa — e o módulo inteiro vira teatro.
 */
export async function registrar(
  contexto: ContextoSessao,
  entidade: "ModeloDeChecklist" | "RespostaDeChecklist" | "Pendencia",
  acao: "CRIOU" | "ALTEROU" | "EXCLUIU",
  entidadeId: string,
  antes: unknown,
  depois: unknown,
) {
  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade,
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}
