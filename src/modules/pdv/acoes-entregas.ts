"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { ResultadoEntrega } from "./entrega-types";
import { ErroPdv } from "./schemas/erro";
import {
  atribuirEntregador,
  salvarAreaEntrega,
  salvarEntregador,
} from "./services/entregas";

async function executar(
  operacao: (
    ctx: NonNullable<Awaited<ReturnType<typeof obterContexto>>>,
  ) => Promise<ResultadoEntrega>,
): Promise<ResultadoEntrega> {
  const ctx = await obterContexto();
  if (!ctx)
    return { erro: "Sua sessão expirou. Entre novamente para continuar." };
  let resultado: ResultadoEntrega;
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
        erro: "Confira os campos obrigatórios, o telefone, a área e os valores da entrega.",
      };
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    )
      return {
        erro: "Este cadastro já existe. Atualize a lista antes de tentar novamente.",
      };
    throw new Error(
      "Não foi possível confirmar a operação de entrega. Atualize a lista ou repita a mesma tentativa.",
    );
  }
  revalidatePath("/pdv", "layout");
  return resultado;
}
export async function salvarAreaEntregaAcao(
  dados: unknown,
): Promise<ResultadoEntrega> {
  return executar(async (ctx) => ({
    ok: "Área de entrega salva.",
    area: await salvarAreaEntrega(ctx, dados),
  }));
}
export async function salvarEntregadorAcao(
  dados: unknown,
): Promise<ResultadoEntrega> {
  return executar(async (ctx) => ({
    ok: "Entregador salvo.",
    entregador: await salvarEntregador(ctx, dados),
  }));
}
export async function atribuirEntregadorAcao(
  dados: unknown,
): Promise<ResultadoEntrega> {
  return executar(async (ctx) => {
    await atribuirEntregador(ctx, dados);
    return { ok: "Responsável pela entrega atualizado." };
  });
}
