import type { Prisma } from "@prisma/client";

import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

/**
 * A AUDITORIA DE COMPRAS.
 *
 * Toda mudança de estado grava uma linha na `auditoria` do Core — a tabela
 * só-escrita que existe "para o dia em que você precisar descobrir quem mudou
 * o preço às 2h da manhã". Recebe o cliente da transação quando há uma: a
 * linha de auditoria nasce e morre junto com a mudança que ela descreve.
 */

export type Cliente = Prisma.TransactionClient | typeof db;

/** `BigInt` não passa por `JSON.stringify` — vira texto. */
function paraJson(valor: unknown): Prisma.InputJsonValue | undefined {
  if (valor === null || valor === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(valor, (_chave, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  ) as Prisma.InputJsonValue;
}

export async function registrar(
  cliente: Cliente,
  ctx: ContextoSessao | null,
  dados: {
    entidade: string;
    entidadeId: string;
    acao: "CRIOU" | "ALTEROU" | "EXCLUIU" | "ACESSOU";
    unidadeId?: string | null;
    antes?: unknown;
    depois?: unknown;
    /** Obrigatório quando não há contexto (o relógio). */
    organizacaoId?: string;
  },
): Promise<void> {
  const organizacaoId = dados.organizacaoId ?? ctx?.organizacao.id;
  if (!organizacaoId) {
    throw new Error("Auditoria sem organização: informe organizacaoId.");
  }
  await cliente.auditoria.create({
    data: {
      organizacaoId,
      unidadeId: dados.unidadeId ?? null,
      usuarioId: ctx?.usuario.id ?? null,
      entidade: dados.entidade,
      entidadeId: dados.entidadeId,
      acao: dados.acao,
      valoresAntes: paraJson(dados.antes),
      valoresDepois: paraJson(dados.depois),
    },
  });
}

/** Quem mexeu por último, e quando — para a frase "mudou enquanto você olhava". */
export async function ultimaMudanca(
  entidade: string,
  entidadeId: string,
): Promise<{ quem: string | null; quando: Date } | null> {
  const linha = await db.auditoria.findFirst({
    where: { entidade, entidadeId },
    orderBy: { quando: "desc" },
    select: { quando: true, usuario: { select: { nome: true } } },
  });
  if (!linha) return null;
  return { quem: linha.usuario?.nome ?? null, quando: linha.quando };
}
