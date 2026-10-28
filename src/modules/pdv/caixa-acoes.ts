"use server";

import { obterContexto } from "@/core/sessao/contexto";
import { listarHistoricoCaixas } from "./services/caixa";

export async function historicoCaixasAcao(pagina: number) {
  const ctx = await obterContexto();
  if (!ctx) throw new Error("Sua sessão expirou. Entre novamente.");
  return listarHistoricoCaixas(ctx, pagina);
}
