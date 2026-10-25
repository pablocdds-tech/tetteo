"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { setTimeout as aguardar } from "node:timers/promises";
import { emailDeLogin, recuperacaoConfigurada } from "@/core/auth/politicas";
import {
  solicitarRecuperacao,
  RESPOSTA_RECUPERACAO,
} from "@/core/auth/recuperacao";

export type EstadoRecuperacao = {
  erro?: string;
  mensagem?: string;
  email?: string;
};

export async function recuperarSenha(
  _anterior: EstadoRecuperacao,
  dados: FormData,
): Promise<EstadoRecuperacao> {
  const inicio = Date.now();
  const email = emailDeLogin.safeParse(dados.get("email"));
  if (!email.success)
    return {
      erro: "Informe um e-mail válido.",
      email: String(dados.get("email") ?? "").slice(0, 254),
    };
  try {
    if (!recuperacaoConfigurada()) throw new Error("RECUPERACAO_INDISPONIVEL");
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    // O tempo do provedor não pode denunciar se o endereço tem conta.
    after(async () => {
      try {
        await solicitarRecuperacao(email.data, ip);
      } catch {
        console.error("[auth/recuperacao] Falha ao processar solicitação.");
      }
    });
    return { mensagem: RESPOSTA_RECUPERACAO };
  } catch {
    return {
      erro: "A recuperação está indisponível agora. Tente mais tarde ou peça ao administrador para redefinir sua senha.",
      email: email.data,
    };
  } finally {
    await aguardar(Math.max(0, 1_200 - (Date.now() - inicio)));
  }
}
