"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { ResultadoPedido } from "./pedido-types";
import { ErroPdv } from "./schemas/erro";
import { listarPedidos, moverPedido } from "./services/pedidos";

async function executar(
  operacao: (
    ctx: NonNullable<Awaited<ReturnType<typeof obterContexto>>>,
  ) => Promise<ResultadoPedido>,
  escrita = false,
): Promise<ResultadoPedido> {
  const ctx = await obterContexto();
  if (!ctx)
    return { erro: "Sua sessão expirou. Entre novamente para continuar." };
  let resultado: ResultadoPedido;
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
      return { erro: "Confira a data, a etapa e a versão do pedido." };
    throw new Error(
      "Não foi possível confirmar a atualização do pedido. Atualize o quadro ou repita a mesma tentativa.",
    );
  }
  if (escrita) revalidatePath("/pdv", "layout");
  return resultado;
}
export async function listarPedidosAcao(
  dados: unknown = {},
): Promise<ResultadoPedido> {
  return executar(async (ctx) => ({ quadro: await listarPedidos(ctx, dados) }));
}
export async function moverPedidoAcao(
  dados: unknown,
): Promise<ResultadoPedido> {
  return executar(
    async (ctx) => ({
      ok: "Etapa do pedido atualizada.",
      pedido: await moverPedido(ctx, dados),
    }),
    true,
  );
}
