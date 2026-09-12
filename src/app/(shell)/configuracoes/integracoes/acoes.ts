"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { revogarConexaoDeIa } from "@/connectors/mcp";
import { obterContexto } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";

export async function revogarConexaoAcao(dados: FormData): Promise<void> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  try {
    await revogarConexaoDeIa(contexto, id);
  } catch (erro) {
    // Sem permissão não é motivo para derrubar a tela: a lista recarrega e a
    // pessoa continua vendo o que já via.
    if (!(erro instanceof SemPermissao)) throw erro;
  }

  revalidatePath("/configuracoes/integracoes");
}
