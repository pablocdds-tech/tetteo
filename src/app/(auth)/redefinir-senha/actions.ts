"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { senhaNova } from "@/core/auth/politicas";
import { concluirRecuperacao } from "@/core/auth/recuperacao";

export type EstadoRedefinicao = {
  erro?: string;
  erroSenha?: string;
  erroConfirmacao?: string;
};

export async function redefinirSenhaPeloLink(
  token: string,
  _anterior: EstadoRedefinicao,
  dados: FormData,
): Promise<EstadoRedefinicao> {
  const senha = senhaNova.safeParse(dados.get("senha"));
  if (!senha.success) return { erroSenha: senha.error.issues[0].message };
  if (senha.data !== dados.get("confirmacao"))
    return { erroConfirmacao: "As senhas precisam ser iguais." };
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    await concluirRecuperacao(token, senha.data, ip);
  } catch (erro) {
    return {
      erro:
        erro instanceof Error && erro.message === "LIMITE_RECUPERACAO"
          ? "Muitas tentativas. Aguarde 15 minutos e tente novamente."
          : "Não foi possível alterar a senha. O link pode ter expirado ou já ter sido usado. Solicite um novo link.",
    };
  }
  redirect("/login?senha=redefinida");
}
