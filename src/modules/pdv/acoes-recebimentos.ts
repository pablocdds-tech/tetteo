"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { ResultadoRecebimento } from "./recebimento-types";
import { ErroPdv } from "./schemas/erro";
import { consultarRecebimento, receberPedido } from "./services/recebimentos";

async function executar(
  operacao: (
    ctx: NonNullable<Awaited<ReturnType<typeof obterContexto>>>,
  ) => Promise<ResultadoRecebimento>,
  escrita = false,
): Promise<ResultadoRecebimento> {
  const ctx = await obterContexto();
  if (!ctx)
    return { erro: "Sua sessão expirou. Entre novamente para continuar." };
  let resultado: ResultadoRecebimento;
  try {
    resultado = await operacao(ctx);
  } catch (erro) {
    if (
      erro instanceof ErroPdv ||
      erro instanceof ExigeUnidade ||
      erro instanceof SemPermissao
    )
      return { erro: erro.message };
    if (erro instanceof ZodError)
      return {
        erro: "Confira a identificação, a versão e os valores dos pagamentos.",
      };
    throw new Error(
      "Não foi possível confirmar o recebimento. Atualize o pedido ou repita a mesma tentativa.",
    );
  }
  // Uma falha de atualização após COMMIT permanece incerta para preservar a chave.
  if (escrita) revalidatePath("/pdv", "layout");
  return resultado;
}
export async function consultarRecebimentoAcao(
  dados: unknown,
): Promise<ResultadoRecebimento> {
  return executar(async (ctx) => ({
    dados: await consultarRecebimento(ctx, dados),
  }));
}
export async function receberPedidoAcao(
  dados: unknown,
): Promise<ResultadoRecebimento> {
  return executar(
    async (ctx) => ({
      ok: "Pagamento registrado no caixa atual.",
      vendaId: await receberPedido(ctx, dados),
    }),
    true,
  );
}
