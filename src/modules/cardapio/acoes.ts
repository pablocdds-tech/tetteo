"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";

import { esquemaInsumo } from "./schemas/insumo";
import {
  atualizarInsumo,
  criarInsumo,
  excluirInsumo,
  SemPermissao,
} from "./services/insumos";

export type EstadoFormulario = {
  erro?: string;
  erros?: Record<string, string>;
};

/**
 * A porta de entrada do formulário.
 *
 * Valida antes de tocar no banco e devolve mensagens que dizem O QUE FAZER —
 * "o custo não pode ser negativo" resolve em um segundo; "campo inválido" não
 * ajuda ninguém.
 */
export async function salvarInsumo(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaInsumo.safeParse({
    nome: dados.get("nome") ?? "",
    categoria: dados.get("categoria") ?? "",
    unidadeMedida: dados.get("unidadeMedida") ?? "",
    custoMedio: dados.get("custoMedio") ?? "0",
    estoqueMinimo: dados.get("estoqueMinimo") ?? "0",
  });

  if (!analise.success) {
    const erros: Record<string, string> = {};
    for (const problema of analise.error.issues) {
      const campo = String(problema.path[0] ?? "");
      if (campo && !erros[campo]) erros[campo] = problema.message;
    }
    return { erros };
  }

  const id = dados.get("id");

  try {
    if (typeof id === "string" && id.length > 0) {
      await atualizarInsumo(contexto, id, analise.data);
    } else {
      await criarInsumo(contexto, analise.data);
    }
  } catch (erro) {
    if (erro instanceof SemPermissao) return { erro: erro.message };
    // Nome repetido cai aqui: o banco tem uma trava única por organização.
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { nome: "Já existe um insumo com esse nome." } };
    }
    throw erro;
  }

  revalidatePath("/cardapio");
  redirect("/cardapio");
}

export async function removerInsumo(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await excluirInsumo(contexto, id);
  revalidatePath("/cardapio");
}
