import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { SaiposClient, SaiposError } from "./client";
import { diaDeslocado, horarioBrasilia } from "./tempo";

export async function sincronizarDetalhes(
  vinculoId: string,
  client = new SaiposClient(),
  repo = db,
) {
  const agora = new Date(),
    dono = randomUUID();
  const claimed = await repo.saiposVinculo.updateMany({
    where: {
      id: vinculoId,
      habilitado: true,
      excluidoEm: null,
      unidade: {
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
      AND: [
        { OR: [{ detalhesAte: null }, { detalhesAte: { lt: agora } }] },
        {
          OR: [
            { detalhesTentativaEm: null },
            {
              detalhesTentativaEm: {
                lt: new Date(agora.getTime() - 30 * 60000),
              },
            },
          ],
        },
      ],
    },
    data: {
      detalhesDono: dono,
      detalhesAte: new Date(agora.getTime() + 10 * 60000),
      detalhesTentativaEm: agora,
    },
  });
  if (!claimed.count) return;
  const vinculo = await repo.saiposVinculo.findUniqueOrThrow({
    where: { id: vinculoId },
  });
  const ate = horarioBrasilia(agora);
  const period = {
    column: "updated_at" as const,
    start: `${diaDeslocado((vinculo.detalhesCursor ?? ate).slice(0, 10), vinculo.detalhesCursor ? -2 : -30)}T00:00:00`,
    end: ate,
  };
  try {
    // Chamadas sequenciais compartilham orçamento do cliente e evitam pressão no fornecedor.
    const items = await client.items(period, vinculo.lojaSaiposId);
    const histories = await client.histories(period, vinculo.lojaSaiposId);
    await repo.$transaction(
      async (tx) => {
        const held = await tx.saiposVinculo.updateMany({
          where: {
            id: vinculoId,
            detalhesDono: dono,
            detalhesAte: { gt: new Date() },
          },
          data: { detalhesCursor: ate },
        });
        if (!held.count) throw new Error("Concessão de detalhes expirou.");
        for (const row of items)
          await tx.saiposVenda.updateMany({
            where: {
              organizacaoId: vinculo.organizacaoId,
              unidadeId: vinculo.unidadeId,
              vendaExternaId: String(row.id_sale),
              excluidoEm: null,
              OR: [
                { itensAtualizadosEm: null },
                { itensAtualizadosEm: { lte: instante(row.updated_at) } },
              ],
            },
            data: {
              itensSaipos: JSON.parse(
                JSON.stringify(row.items),
              ) as Prisma.InputJsonValue,
              detalhesEm: agora,
              itensAtualizadosEm: instante(row.updated_at),
            },
          });
        for (const row of histories)
          await tx.saiposVenda.updateMany({
            where: {
              organizacaoId: vinculo.organizacaoId,
              unidadeId: vinculo.unidadeId,
              vendaExternaId: String(row.id_sale),
              excluidoEm: null,
              OR: [
                { historicoAtualizadoEm: null },
                { historicoAtualizadoEm: { lte: instante(row.updated_at) } },
              ],
            },
            data: {
              historicoSaipos: JSON.parse(
                JSON.stringify(row.histories),
              ) as Prisma.InputJsonValue,
              detalhesEm: agora,
              historicoAtualizadoEm: instante(row.updated_at),
            },
          });
        await tx.auditoria.create({
          data: {
            organizacaoId: vinculo.organizacaoId,
            unidadeId: vinculo.unidadeId,
            entidade: "SaiposDetalhes",
            entidadeId: vinculoId,
            acao: "ALTEROU",
            valoresDepois: {
              itens: items.length,
              historicos: histories.length,
            },
          },
        });
        await tx.saiposVinculo.update({
          where: { id: vinculoId },
          data: {
            detalhesDono: null,
            detalhesAte: null,
            detalhesErro: null,
            detalhesSucessoEm: agora,
          },
        });
      },
      { timeout: 120000 },
    );
  } catch (error) {
    await repo.saiposVinculo.updateMany({
      where: { id: vinculoId, detalhesDono: dono },
      data: {
        detalhesDono: null,
        detalhesAte: null,
        detalhesErro:
          error instanceof SaiposError
            ? error.message
            : "Falha ao gravar detalhes; cursor preservado.",
      },
    });
  }
}

function instante(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value))
    throw new SaiposError(
      "format",
      "Data dos detalhes Saipos inválida; cursor preservado.",
    );
  const date = new Date(value + "-03:00");
  if (!Number.isFinite(date.getTime()))
    throw new SaiposError(
      "format",
      "Data dos detalhes Saipos inválida; cursor preservado.",
    );
  return date;
}
