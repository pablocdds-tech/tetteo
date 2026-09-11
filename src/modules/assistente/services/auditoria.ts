import type { Prisma } from "@prisma/client";

import type { ContextoSessao } from "@/core/sessao/contexto";
import { db } from "@/server/db";

/**
 * O RASTRO — quem autorizou, quem confirmou, quem pediu o QR Code.
 *
 * Toda decisão que faz uma mensagem sair, ou que dá a alguém acesso ao número,
 * deixa uma linha na auditoria do Core. É a tabela que responde, no dia do
 * problema, "quem mandou isto?" — e ela é só-escrita.
 */
export async function registrarAuditoria(
  contexto: ContextoSessao,
  dados: {
    entidade: string;
    entidadeId: string;
    acao: "CRIOU" | "ALTEROU" | "EXCLUIU" | "ACESSOU";
    unidadeId?: string | null;
    antes?: Prisma.InputJsonValue;
    depois?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: dados.unidadeId ?? null,
      usuarioId: contexto.usuario.id,
      entidade: dados.entidade,
      entidadeId: dados.entidadeId,
      acao: dados.acao,
      valoresAntes: dados.antes,
      valoresDepois: dados.depois,
    },
  });
}
