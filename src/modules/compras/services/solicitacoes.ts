import type { Prisma } from "@prisma/client";

/**
 * AS SOLICITAÇÕES DE COTAÇÃO — o que cada fornecedor é convidado a cotar.
 *
 * Esta parte nasce junto com a consolidação da rodada (services/rodadas.ts)
 * e é chamada DENTRO da transação dela: a lista congelada e os convites são o
 * mesmo fato, e não podem existir um sem o outro.
 *
 * Quem é elegível: o fornecedor que tem o insumo cadastrado como produto dele
 * (`FornecedorInsumo`). O item de fornecedor FIXO não entra na disputa — vai
 * só para o fixo, marcado como direcionado (confirmação de preço).
 */

type Tx = Prisma.TransactionClient;

export async function prepararSolicitacoesNaTransacao(
  tx: Tx,
  rodada: { id: string; organizacaoId: string; prazoCotacao: Date | null },
): Promise<number> {
  const itens = await tx.itemDaRodada.findMany({
    where: { rodadaId: rodada.id },
    select: { id: true, insumoId: true, modo: true, fornecedorFixoId: true },
  });
  if (itens.length === 0) return 0;

  const produtos = await tx.fornecedorInsumo.findMany({
    where: {
      organizacaoId: rodada.organizacaoId,
      ativo: true,
      insumoId: { in: itens.map((i) => i.insumoId) },
      fornecedor: { ativo: true, excluidoEm: null },
    },
    select: { fornecedorId: true, insumoId: true },
  });

  // fornecedor → itens dele, com a marca de direcionado.
  const porFornecedor = new Map<
    string,
    Map<string, { direcionado: boolean }>
  >();
  const incluir = (fornecedorId: string, itemId: string, direcionado: boolean) => {
    const lista = porFornecedor.get(fornecedorId) ?? new Map();
    lista.set(itemId, { direcionado });
    porFornecedor.set(fornecedorId, lista);
  };

  for (const item of itens) {
    if (item.modo === "DIRECIONADO" && item.fornecedorFixoId) {
      incluir(item.fornecedorFixoId, item.id, true);
      continue;
    }
    for (const p of produtos) {
      if (p.insumoId === item.insumoId) incluir(p.fornecedorId, item.id, false);
    }
  }

  let criadas = 0;
  for (const [fornecedorId, seus] of porFornecedor) {
    // Reabrir a rodada não duplica convite: a unicidade (rodada, fornecedor)
    // devolve a solicitação que já existe e só acrescenta itens novos.
    const solicitacao = await tx.solicitacaoDeCotacao.upsert({
      where: { rodadaId_fornecedorId: { rodadaId: rodada.id, fornecedorId } },
      update: {},
      create: {
        organizacaoId: rodada.organizacaoId,
        rodadaId: rodada.id,
        fornecedorId,
        prazo: rodada.prazoCotacao,
      },
      select: { id: true, criadoEm: true, atualizadoEm: true },
    });
    await tx.itemDaSolicitacao.createMany({
      data: [...seus].map(([itemDaRodadaId, { direcionado }]) => ({
        solicitacaoId: solicitacao.id,
        itemDaRodadaId,
        direcionado,
      })),
      skipDuplicates: true,
    });
    criadas++;
  }
  return criadas;
}

/**
 * Encerra a cotação: quem respondeu fica ENCERRADA; quem não respondeu,
 * ENCERRADA_SEM_RESPOSTA. O link continua existindo, mas deixa de aceitar
 * resposta — ele confere o estado da rodada a cada envio.
 */
export async function encerrarCotacaoNaTransacao(tx: Tx, rodadaId: string) {
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: "RESPONDIDA" },
    data: { status: "ENCERRADA" },
  });
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: { in: ["RASCUNHO", "CONVIDADO"] } },
    data: { status: "ENCERRADA_SEM_RESPOSTA" },
  });
}

/** Reabrir a cotação devolve cada solicitação ao estado de antes de encerrar. */
export async function reabrirCotacaoNaTransacao(tx: Tx, rodadaId: string) {
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: "ENCERRADA" },
    data: { status: "RESPONDIDA" },
  });
  await tx.solicitacaoDeCotacao.updateMany({
    where: {
      rodadaId,
      status: "ENCERRADA_SEM_RESPOSTA",
      convidadoEm: { not: null },
    },
    data: { status: "CONVIDADO" },
  });
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: "ENCERRADA_SEM_RESPOSTA", convidadoEm: null },
    data: { status: "RASCUNHO" },
  });
}
