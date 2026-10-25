"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/core/auth";
import { googleConfigurado } from "@/core/auth/politicas";

export type EstadoLogin = { erro?: string };

export async function entrarComGoogle(): Promise<void> {
  if (!googleConfigurado()) return;
  await signIn("google", { redirectTo: "/conta" });
}

export async function entrar(
  _anterior: EstadoLogin,
  dados: FormData,
): Promise<EstadoLogin> {
  try {
    await signIn("credentials", {
      email: String(dados.get("email") ?? ""),
      senha: String(dados.get("senha") ?? ""),
      redirectTo: "/",
    });
    return {};
  } catch (erro) {
    // O redirecionamento de sucesso viaja como exceção no Next — deixa passar.
    if (erro instanceof AuthError) {
      return { erro: "E-mail ou senha incorretos. Confira e tente de novo." };
    }
    throw erro;
  }
}
