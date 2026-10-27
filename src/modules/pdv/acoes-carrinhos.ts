"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { ResultadoCarrinho } from "./carrinho-types";
import { ErroPdv } from "./schemas/erro";
import {
  descartarCarrinho,
  listarCarrinhos,
  retomarCarrinho,
  salvarCarrinho,
} from "./services/carrinhos";

async function executar(
  operacao: (
    ctx: NonNullable<Awaited<ReturnType<typeof obterContexto>>>,
  ) => Promise<ResultadoCarrinho>,
  escrita = false,
): Promise<ResultadoCarrinho> {
  const ctx = await obterContexto();
  if (!ctx)
    return { erro: "Sua sessão expirou. Entre novamente para continuar." };
  let resultado: ResultadoCarrinho;
  try {
    resultado = await operacao(ctx);
  } catch (erro) {
    if (erro instanceof ZodError)
      return { erro: "Confira o nome, os itens e as quantidades do carrinho." };
    if (
      erro instanceof ErroPdv ||
      erro instanceof SemPermissao ||
      erro instanceof ExigeUnidade
    )
      return { erro: erro.message };
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    )
      return {
        erro: "Este identificador já está em uso. Atualize a lista de carrinhos.",
      };
    throw new Error(
      "Não foi possível confirmar a operação do carrinho. Consulte a lista ou repita a mesma tentativa.",
    );
  }
  if (escrita) revalidatePath("/pdv", "layout");
  return resultado;
}
export async function salvarCarrinhoAcao(
  dados: unknown,
): Promise<ResultadoCarrinho> {
  return executar(
    async (ctx) => ({
      ok: "Carrinho salvo. Nenhum estoque foi reservado.",
      carrinho: await salvarCarrinho(ctx, dados),
    }),
    true,
  );
}
export async function retomarCarrinhoAcao(
  dados: unknown,
): Promise<ResultadoCarrinho> {
  return executar(async (ctx) => ({
    retomada: await retomarCarrinho(ctx, dados),
  }));
}
export async function descartarCarrinhoAcao(
  dados: unknown,
): Promise<ResultadoCarrinho> {
  return executar(async (ctx) => {
    await descartarCarrinho(ctx, dados);
    return { ok: "Carrinho descartado." };
  }, true);
}
export async function listarCarrinhosAcao(): Promise<ResultadoCarrinho> {
  return executar(async (ctx) => ({ carrinhos: await listarCarrinhos(ctx) }));
}
