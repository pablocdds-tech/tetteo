import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { DadosRecebimento } from "../recebimento-types";
import { ErroPdv } from "../schemas/erro";
import {
  esquemaConsultarRecebimento,
  esquemaReceber,
} from "../schemas/recebimento";
import { conferirPagamentos } from "../schemas/venda";
import { exigirEscopo } from "./escopo";
import { serializarVendaPdv } from "./venda-dto";

export async function consultarRecebimento(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<DadosRecebimento> {
  const escopo = await exigirEscopo(ctx, "pdv.vender");
  const dados = esquemaConsultarRecebimento.parse(entrada);
  return db.$transaction(
    async (tx) => {
      const venda = await tx.pdvVenda.findFirst({
        where: { ...escopo, id: dados.vendaId },
      });
      if (!venda) throw new ErroPdv("Venda indisponível nesta unidade.");
      const [pedido, caixa] = await Promise.all([
        tx.pdvPedido.findFirst({
          where: { ...escopo, vendaId: venda.id },
          select: { numero: true },
        }),
        tx.pdvCaixa.findFirst({
          where: { ...escopo, fechadoEm: null },
          select: { id: true, operador: true },
        }),
      ]);
      return {
        venda: serializarVendaPdv(venda, pode(ctx, "crm.ver")),
        pedidoNumero: pedido?.numero ?? null,
        caixa,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/** Recebe somente o total congelado; não consulta catálogo, receitas ou estoque. */
export async function receberPedido(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<string> {
  const escopo = await exigirEscopo(ctx, "pdv.vender");
  const dados = esquemaReceber.parse(entrada);
  const recebimentoHash = createHash("sha256")
    .update(JSON.stringify(dados))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pdv:${escopo.organizacaoId}:${escopo.unidadeId}`},0))`;
      const anterior = await tx.pdvVenda.findUnique({
        where: {
          organizacaoId_unidadeId_recebimentoChave: {
            ...escopo,
            recebimentoChave: dados.chave,
          },
        },
      });
      if (anterior) {
        if (
          anterior.id !== dados.vendaId ||
          anterior.recebimentoHash !== recebimentoHash ||
          anterior.recebidoPorId !== ctx.usuario.id
        )
          throw new ErroPdv(
            "Esta tentativa pertence a outro recebimento. Atualize o pedido antes de continuar.",
          );
        // Confirma o mesmo fato inclusive depois de um fechamento ou cancelamento.
        return anterior.id;
      }
      const venda = await tx.pdvVenda.findFirst({
        where: { ...escopo, id: dados.vendaId },
      });
      if (!venda) throw new ErroPdv("Venda indisponível nesta unidade.");
      if (venda.status === "CANCELADA")
        throw new ErroPdv(
          "Este pedido foi cancelado e não pode receber pagamentos.",
        );
      if (venda.status !== "PENDENTE")
        throw new ErroPdv(
          "Este pedido já tem pagamento registrado. Atualize os dados antes de continuar.",
        );
      if (venda.versaoFinanceira !== dados.versaoFinanceira)
        throw new ErroPdv(
          "A situação financeira deste pedido mudou. Atualize os dados antes de receber.",
        );
      const caixa = await tx.pdvCaixa.findFirst({
        where: { ...escopo, id: dados.caixaId, fechadoEm: null },
        select: { id: true },
      });
      if (!caixa)
        throw new ErroPdv(
          "O caixa escolhido não está aberto nesta unidade. Atualize os dados antes de receber.",
        );
      const { trocoCentavos } = conferirPagamentos(
        venda.totalCentavos,
        dados.pagamentos,
      );
      const agora = new Date();
      await tx.pdvVenda.update({
        where: { id: venda.id },
        data: {
          status: "CONCLUIDA",
          pagamentos: JSON.parse(
            JSON.stringify(dados.pagamentos),
          ) as Prisma.InputJsonValue,
          trocoCentavos,
          caixaRecebimentoId: caixa.id,
          recebidoEm: agora,
          recebidoPorId: ctx.usuario.id,
          recebidoPorNome: ctx.usuario.nome,
          recebimentoChave: dados.chave,
          recebimentoHash,
          versaoFinanceira: { increment: 1 },
        },
      });
      const pedido = await tx.pdvPedido.findFirst({
        where: { ...escopo, vendaId: venda.id },
      });
      if (pedido) {
        if (pedido.status === "CANCELADO")
          throw new ErroPdv(
            "A situação operacional deste pedido precisa de conferência antes de receber.",
          );
        await tx.pdvPedido.update({
          where: { id: pedido.id },
          data: {
            versao: { increment: 1 },
            eventos: {
              create: {
                de: pedido.status,
                para: pedido.status,
                versao: pedido.versao + 1,
                usuarioId: ctx.usuario.id,
                operador: ctx.usuario.nome,
                observacao: "Pagamento registrado",
              },
            },
          },
        });
        await tx.auditoria.create({
          data: {
            ...escopo,
            usuarioId: ctx.usuario.id,
            entidade: "PdvPedido",
            entidadeId: pedido.id,
            acao: "ALTEROU",
            valoresAntes: { status: pedido.status, versao: pedido.versao },
            valoresDepois: {
              status: pedido.status,
              versao: pedido.versao + 1,
              motivo: "Pagamento registrado",
            },
          },
        });
      }
      await tx.auditoria.create({
        data: {
          ...escopo,
          usuarioId: ctx.usuario.id,
          entidade: "PdvRecebimento",
          entidadeId: venda.id,
          acao: "ALTEROU",
          valoresAntes: {
            status: venda.status,
            versaoFinanceira: venda.versaoFinanceira,
          },
          valoresDepois: {
            status: "CONCLUIDA",
            versaoFinanceira: venda.versaoFinanceira + 1,
            totalCentavos: venda.totalCentavos,
            caixaRecebimentoId: caixa.id,
            trocoCentavos,
          },
        },
      });
      return venda.id;
    },
    { timeout: 20_000 },
  );
}
