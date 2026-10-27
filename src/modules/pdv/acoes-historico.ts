"use server";

import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { ResultadoHistorico } from "./historico-types";
import { ErroPdv } from "./schemas/erro";
import { consultarHistorico, exportarHistorico } from "./services/historico";

async function executar(
  operacao: (
    ctx: NonNullable<Awaited<ReturnType<typeof obterContexto>>>,
  ) => Promise<ResultadoHistorico>,
): Promise<ResultadoHistorico> {
  const ctx = await obterContexto();
  if (!ctx)
    return { erro: "Sua sessão expirou. Entre novamente para continuar." };
  try {
    return await operacao(ctx);
  } catch (erro) {
    if (
      erro instanceof ErroPdv ||
      erro instanceof ExigeUnidade ||
      erro instanceof SemPermissao
    )
      return { erro: erro.message };
    if (erro instanceof ZodError)
      return { erro: "Confira o período e os filtros informados." };
    throw new Error("Não foi possível consultar o histórico. Tente novamente.");
  }
}
export async function consultarHistoricoAcao(
  dados: unknown = {},
): Promise<ResultadoHistorico> {
  return executar(async (ctx) => ({
    pagina: await consultarHistorico(ctx, dados),
  }));
}
export async function exportarHistoricoAcao(
  dados: unknown = {},
): Promise<ResultadoHistorico> {
  return executar(async (ctx) => ({
    exportacao: await exportarHistorico(ctx, dados),
  }));
}
