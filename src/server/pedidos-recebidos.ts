import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { esquemaPedidoRecebido } from "@/lib/pedido-recebido";

export const EVENTO_PEDIDO_RECEBIDO = "pedido_externo.conferido";
type Escopo = { organizacaoId: string; unidadeId: string };

/** Publica um fato durável na mesma transação da projeção do conector. */
export async function publicarPedidoRecebido(
  tx: Prisma.TransactionClient,
  escopo: Escopo,
  origem: string,
  referencia: string,
  entrada: unknown,
) {
  const dados = esquemaPedidoRecebido.parse(entrada);
  const unidade = await tx.unidade.findFirst({
    where: {
      id: escopo.unidadeId,
      organizacaoId: escopo.organizacaoId,
      ativa: true,
      excluidoEm: null,
      organizacao: { ativa: true, excluidoEm: null },
    },
    select: { id: true },
  });
  if (!unidade) throw new Error("Unidade indisponível para recebimento.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pedido-recebido:${escopo.organizacaoId}:${escopo.unidadeId}:${origem}:${referencia}`},0))`;
  const chave = { ...escopo, origem, referencia };
  const anterior = await tx.pedidoRecebido.findUnique({
    where: { organizacaoId_unidadeId_origem_referencia: chave },
  });
  const revisao = new Date(dados.atualizadoEm);
  if (anterior && revisao < anterior.atualizadoNaOrigemEm) return anterior;
  const conteudo = JSON.parse(JSON.stringify(dados)) as Prisma.InputJsonValue;
  const registro = await tx.pedidoRecebido.upsert({
    where: { organizacaoId_unidadeId_origem_referencia: chave },
    create: {
      ...chave,
      numeroOrigem: dados.numeroOrigem,
      situacao: dados.situacao,
      conteudo,
      criadoNaOrigemEm: new Date(dados.criadoEm),
      atualizadoNaOrigemEm: revisao,
    },
    update: {
      numeroOrigem: dados.numeroOrigem,
      situacao: dados.situacao,
      conteudo,
      atualizadoNaOrigemEm: revisao,
    },
  });
  const eventoId = `pedido-recebido-${createHash("sha256").update(`${registro.id}:${revisao.toISOString()}:v1`).digest("hex")}`;
  await tx.evento.createMany({
    skipDuplicates: true,
    data: [
      {
        id: eventoId,
        ...escopo,
        tipo: EVENTO_PEDIDO_RECEBIDO,
        dados: { pedidoRecebidoId: registro.id },
        correlacaoId: registro.id,
      },
    ],
  });
  // Assinantes pertencem ao roteamento do servidor; o conector não conhece Apps.
  await tx.entregaEvento.createMany({
    skipDuplicates: true,
    data: [{ eventoId, appDestino: "pdv" }],
  });
  if (!anterior || revisao > anterior.atualizadoNaOrigemEm)
    await tx.auditoria.create({
      data: {
        ...escopo,
        entidade: "PedidoRecebido",
        entidadeId: registro.id,
        acao: anterior ? "ALTEROU" : "CRIOU",
        valoresDepois: { origem, situacao: dados.situacao },
      },
    });
  return registro;
}
