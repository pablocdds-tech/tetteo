"use server";

import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { ResultadoImpressaoPdv } from "./impressao-types";
import { ErroPdv } from "./schemas/erro";
import { solicitarImpressao } from "./services/impressoes";

export async function solicitarImpressaoAcao(
  entrada: unknown,
): Promise<ResultadoImpressaoPdv> {
  const ctx = await obterContexto();
  if (!ctx)
    return {
      erro: "Sua sessão expirou. Entre novamente para solicitar a impressão.",
    };
  try {
    return { resultado: await solicitarImpressao(ctx, entrada) };
  } catch (erro) {
    if (erro instanceof ZodError)
      return {
        erro: "A identificação da impressão é inválida. Abra novamente a prévia.",
      };
    if (
      erro instanceof ErroPdv ||
      erro instanceof SemPermissao ||
      erro instanceof ExigeUnidade
    )
      return { erro: erro.message };
    // Falha de conexão pode ser posterior ao commit: preserve a chave na interface.
    throw new Error("Não foi possível confirmar a solicitação de impressão.");
  }
}
