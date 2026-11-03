import type { Prisma } from "@prisma/client";

export const EVENTOS_FINANCEIROS_PDV = [
  "pdv.recebimento_registrado",
  "pdv.venda_cancelada",
] as const;

/** O fato e sua entrega são gravados junto da venda; nenhuma chamada externa. */
export async function publicarFatoFinanceiroPdv(
  tx: Prisma.TransactionClient,
  escopo: { organizacaoId: string; unidadeId: string },
  vendaId: string,
  tipo: (typeof EVENTOS_FINANCEIROS_PDV)[number],
  atorUsuarioId: string,
) {
  const eventoId = `${tipo}:${vendaId}`;
  await tx.evento.createMany({
    skipDuplicates: true,
    data: [
      {
        id: eventoId,
        ...escopo,
        tipo,
        atorUsuarioId,
        dados: { vendaId },
        correlacaoId: vendaId,
      },
    ],
  });
  await tx.entregaEvento.createMany({
    skipDuplicates: true,
    data: [{ eventoId, appDestino: "financeiro" }],
  });
}
