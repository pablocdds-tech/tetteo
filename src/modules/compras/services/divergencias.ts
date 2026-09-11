import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { registrar } from "./auditoria";

/**
 * AS DIVERGÊNCIAS — o que não bateu, esperando alguém conciliar.
 *
 * Faltou, sobrou, chegou avariado, veio outra coisa, a nota diz um número e a
 * conferência outro, voltou depois de entrar. Nenhuma delas é corrigida
 * sozinha: cada uma é resolvida por uma pessoa, com o que foi feito escrito.
 */

export async function listarDivergencias(
  ctx: ContextoSessao,
  filtro: { estado?: "ABERTA" | "RESOLVIDA"; pedidoId?: string } = {},
) {
  if (!pode(ctx, "compras.ver")) throw new SemPermissao("ver compras");
  const lojas = ctx.unidadeAtiva
    ? [ctx.unidadeAtiva.id]
    : ctx.unidadesVisiveis.map((u) => u.id);
  return db.divergenciaDeCompra.findMany({
    where: {
      organizacaoId: ctx.organizacao.id,
      unidadeId: { in: lojas },
      ...(filtro.estado ? { estado: filtro.estado } : {}),
      ...(filtro.pedidoId ? { pedidoId: filtro.pedidoId } : {}),
    },
    include: {
      pedido: {
        select: { numero: true, fornecedorNome: true, unidadeNome: true },
      },
    },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });
}

export async function resolverDivergencia(
  ctx: ContextoSessao,
  id: string,
  resolucao: string,
): Promise<void> {
  if (!pode(ctx, "compras.receber") && !pode(ctx, "compras.pedir")) {
    throw new SemPermissao("resolver divergências");
  }
  const texto = resolucao.trim();
  if (!texto)
    throw new Error("Escreva o que foi feito — é o que fecha a divergência.");
  const r = await db.divergenciaDeCompra.updateMany({
    where: {
      id,
      organizacaoId: ctx.organizacao.id,
      unidadeId: { in: ctx.unidadesVisiveis.map((u) => u.id) },
      estado: "ABERTA",
    },
    data: {
      estado: "RESOLVIDA",
      resolucao: texto.slice(0, 500),
      resolvidaPorId: ctx.usuario.id,
      resolvidaEm: new Date(),
    },
  });
  if (r.count !== 1) throw new Error("Esta divergência não está aberta.");
  await registrar(db, ctx, {
    entidade: "DivergenciaDeCompra",
    entidadeId: id,
    acao: "ALTEROU",
    depois: { estado: "RESOLVIDA", resolucao: texto },
  });
}
