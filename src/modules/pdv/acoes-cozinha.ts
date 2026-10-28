"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { ErroPdv } from "./schemas/erro";
import { carregarCozinha } from "./services/cozinha";
import { moverPedido } from "./services/pedidos";
import type { QuadroCozinha } from "./cozinha-types";

const entrada = z
  .object({
    pedidoId: z.string().min(1).max(100),
    versao: z.number().int().positive(),
  })
  .strict();
async function executar(
  dados?: unknown,
): Promise<{ quadro?: QuadroCozinha; erro?: string }> {
  const ctx = await obterContexto();
  if (!ctx) return { erro: "Sua sessão expirou. Entre novamente." };
  try {
    if (dados !== undefined) {
      await moverPedido(ctx, {
        ...entrada.parse(dados),
        destino: "AGUARDANDO_COLETA",
      });
      revalidatePath("/pdv", "layout");
    }
    return { quadro: await carregarCozinha(ctx) };
  } catch (e) {
    if (
      e instanceof ErroPdv ||
      e instanceof SemPermissao ||
      e instanceof ExigeUnidade
    )
      return { erro: e.message };
    if (e instanceof ZodError)
      return { erro: "Confira o pedido e atualize a cozinha." };
    return {
      erro: "Não foi possível confirmar a atualização. Atualize a cozinha antes de tentar novamente.",
    };
  }
}
export async function atualizarCozinhaAcao() {
  return executar();
}
export async function concluirPreparoAcao(dados: unknown) {
  return executar(dados);
}
