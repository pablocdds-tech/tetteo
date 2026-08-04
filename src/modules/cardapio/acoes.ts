"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";

import { esquemaFicha, esquemaItemDeFicha } from "./schemas/ficha";
import { esquemaInsumo } from "./schemas/insumo";
import {
  adicionarItem,
  alternarFicha,
  atualizarFicha,
  criarFicha,
  excluirFicha,
  removerItem,
} from "./services/fichas";
import {
  atualizarInsumo,
  criarInsumo,
  excluirInsumo,
  SemPermissao,
} from "./services/insumos";

export type EstadoFormulario = {
  erro?: string;
  erros?: Record<string, string>;
  ok?: string;
};

function coletarErros(issues: { path: PropertyKey[]; message: string }[]) {
  const erros: Record<string, string> = {};
  for (const problema of issues) {
    const campo = String(problema.path[0] ?? "");
    if (campo && !erros[campo]) erros[campo] = problema.message;
  }
  return erros;
}

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

// ---------------------------------------------------------------------------
// FICHAS TÉCNICAS
// ---------------------------------------------------------------------------

export async function salvarFicha(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaFicha.safeParse({
    nome: dados.get("nome") ?? "",
    categoria: dados.get("categoria") ?? "",
    tipo: dados.get("tipo") ?? "PRATO",
    modoDePreparo: dados.get("modoDePreparo") ?? "",
    rendimento: dados.get("rendimento") ?? "1",
    unidadeRendimento: dados.get("unidadeRendimento") ?? "UN",
    precoVenda: dados.get("precoVenda") ?? "",
  });

  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  const id = String(dados.get("id") ?? "");
  let destino = id;

  try {
    if (id) {
      await atualizarFicha(contexto, id, analise.data);
    } else {
      const ficha = await criarFicha(contexto, analise.data);
      destino = ficha.id;
    }
  } catch (erro) {
    if (erro instanceof SemPermissao) return { erro: erro.message };
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { nome: "Já existe uma ficha com esse nome." } };
    }
    if (erro instanceof Error) return { erro: erro.message };
    throw erro;
  }

  revalidatePath("/cardapio/fichas");
  redirect(`/cardapio/fichas/${destino}`);
}

export async function adicionarItemDaFicha(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const fichaId = String(dados.get("fichaId") ?? "");
  if (!fichaId) return { erro: "Ficha não informada." };

  const analise = esquemaItemDeFicha.safeParse({
    alvo: dados.get("alvo") ?? "",
    quantidade: dados.get("quantidade") ?? "",
    unidade: dados.get("unidade") ?? "",
    perdaPercentual: dados.get("perdaPercentual") || "0",
    observacao: dados.get("observacao") ?? "",
  });

  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await adicionarItem(contexto, fichaId, analise.data);
  } catch (erro) {
    if (erro instanceof SemPermissao) return { erro: erro.message };
    if (erro instanceof Error) return { erro: erro.message };
    throw erro;
  }

  revalidatePath(`/cardapio/fichas/${fichaId}`);
  return { ok: "Ingrediente adicionado." };
}

export async function removerItemDaFicha(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const fichaId = String(dados.get("fichaId") ?? "");
  const itemId = String(dados.get("itemId") ?? "");
  if (!fichaId || !itemId) return;

  await removerItem(contexto, fichaId, itemId);
  revalidatePath(`/cardapio/fichas/${fichaId}`);
}

export async function alternarFichaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await alternarFicha(contexto, id);
  revalidatePath("/cardapio/fichas");
}

export async function removerFicha(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return { erro: "Ficha não informada." };

  try {
    await excluirFicha(contexto, id);
  } catch (erro) {
    if (erro instanceof SemPermissao) return { erro: erro.message };
    if (erro instanceof Error) return { erro: erro.message };
    throw erro;
  }

  revalidatePath("/cardapio/fichas");
  redirect("/cardapio/fichas");
}
