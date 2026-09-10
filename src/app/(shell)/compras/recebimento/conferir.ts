import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import {
  concluirNaTransacao,
  divergenciasDaNota,
  itensParaNota,
  registrarDevolucaoNaTransacao,
  registrarRecebimentoNaTransacao,
  type DadosDaConferencia,
  type DadosDaDevolucao,
} from "@/modules/compras/services/recebimentos";
import {
  lancarEntradaDeRecebimento,
  registrarDevolucao,
  vincularNotaAoRecebimento,
} from "@/modules/estoque/services/notas";
import { db } from "@/server/db";

/**
 * O ORQUESTRADOR DO RECEBIMENTO — Compras, Estoque e Financeiro.
 *
 * Mora na camada `app/` porque é a única que enxerga os três Apps (um App
 * nunca importa de outro). Não inventa regra: chama, na ordem, o que cada App
 * já sabe fazer — e faz Compras e Estoque numa TRANSAÇÃO SÓ:
 *
 *   1. Compras registra o recebimento (trava o pedido, confere, grava)
 *   2. Estoque dá a entrada pela NOTA — ou liga a nota lançada à mão antes
 *   3. Compras conclui (liga a nota, atualiza a situação do pedido)
 *
 * Falhou o 2, o 1 some junto. O pedido nunca aparece recebido sem a entrada
 * no estoque, e a entrada nunca existe sem o recebimento.
 *
 * A conta a pagar vem DEPOIS do commit, pela função do Financeiro que já
 * existe — e que já impede a mesma nota de virar duas contas.
 */

export type ResultadoDaConferencia = Awaited<ReturnType<typeof conferirRecebimento>>;

export async function conferirRecebimento(
  ctx: ContextoSessao,
  dados: DadosDaConferencia & { gerarContaAPagar?: boolean; categoriaId?: string | null },
) {
  const resultado = await db.$transaction(
    async (tx) => {
      const registro = await registrarRecebimentoNaTransacao(tx, ctx, dados);
      if (registro.jaExistia) return registro;

      let notaEntradaId: string | null = null;
      if (dados.notaExistenteId) {
        const nota = await vincularNotaAoRecebimento(tx, ctx, {
          notaId: dados.notaExistenteId,
          unidadeId: registro.unidadeId,
          fornecedorId: registro.fornecedorId,
          recebimentoId: registro.recebimentoId,
          pedidoId: registro.pedidoId,
        });
        await divergenciasDaNota(tx, ctx, registro, dados.notaExistenteId, nota);
        notaEntradaId = dados.notaExistenteId;
      } else {
        const itens = itensParaNota(registro);
        if (itens.length > 0) {
          const nota = await lancarEntradaDeRecebimento(tx, ctx, {
            unidadeId: registro.unidadeId,
            fornecedorId: registro.fornecedorId,
            recebimentoId: registro.recebimentoId,
            pedidoId: registro.pedidoId,
            recebidaEm: dados.recebidaEm,
            localDestinoId: dados.localDestinoId,
            numero: dados.numeroNota,
            serie: dados.serieNota,
            chaveAcesso: dados.chaveAcesso,
            observacao: `Recebimento ${registro.referencia} · entrega ${registro.numero}`,
            itens,
          });
          notaEntradaId = nota.notaId;
        }
      }

      await concluirNaTransacao(tx, ctx, {
        pedidoId: registro.pedidoId,
        recebimentoId: registro.recebimentoId,
        notaEntradaId,
        notaVinculadaExistente: !!dados.notaExistenteId,
        completo: registro.completo,
      });

      return { ...registro, notaEntradaId };
    },
    { timeout: 30_000 },
  );

  let contaAPagar: "gerada" | "ja-existia" | "sem-permissao" | "falhou" | null = null;
  if (dados.gerarContaAPagar && resultado.notaEntradaId && !resultado.jaExistia) {
    if (!pode(ctx, "financeiro.lancar")) {
      contaAPagar = "sem-permissao";
    } else {
      try {
        // Importado só aqui: quem não gera conta a pagar não carrega o
        // Financeiro.
        const { importarNotas } = await import("@/modules/financeiro/services/cadastros");
        const n = await importarNotas(ctx, [resultado.notaEntradaId], dados.categoriaId ?? null);
        contaAPagar = n > 0 ? "gerada" : "ja-existia";
      } catch (erro) {
        console.error("conferirRecebimento → conta a pagar:", erro);
        contaAPagar = "falhou";
      }
    }
  }

  return { ...resultado, contaAPagar };
}

export async function devolverMercadoria(ctx: ContextoSessao, dados: DadosDaDevolucao) {
  return db.$transaction(
    async (tx) => {
      const devolucao = await registrarDevolucaoNaTransacao(tx, ctx, dados);
      if (devolucao.jaExistia) return devolucao;
      if (!devolucao.localId) {
        throw new Error("O recebimento original não diz onde a mercadoria foi guardada.");
      }
      await registrarDevolucao(tx, ctx, {
        unidadeId: devolucao.unidadeId,
        localId: devolucao.localId,
        recebimentoId: devolucao.devolucaoId,
        motivo: dados.motivo,
        itens: devolucao.itens,
      });
      return devolucao;
    },
    { timeout: 30_000 },
  );
}
