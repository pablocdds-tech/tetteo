"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  COOKIE_UNIDADE,
  obterContexto,
  REDE_INTEIRA,
} from "@/core/sessao/contexto";

/**
 * Troca a unidade ativa.
 *
 * Só aceita unidades que o usuário realmente enxerga — nunca confia no valor
 * que chegou do navegador.
 */
export async function trocarUnidade(valor: string) {
  const contexto = await obterContexto();
  if (!contexto) return;

  const valido =
    (valor === REDE_INTEIRA && contexto.podeVerRedeInteira) ||
    contexto.unidadesVisiveis.some((u) => u.id === valor);

  if (!valido) return;

  (await cookies()).set(COOKIE_UNIDADE, valor, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
