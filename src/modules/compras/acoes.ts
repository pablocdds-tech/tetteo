"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";

import { esquemaFornecedor } from "./schemas/entradas";
import { alternarFornecedor, salvarFornecedor } from "./services/fornecedores";

export type EstadoCompras = {
  erro?: string;
  erros?: Record<string, string>;
  ok?: string;
};

function coletarErros(issues: { path: PropertyKey[]; message: string }[]) {
  const erros: Record<string, string> = {};
  for (const p of issues) {
    const campo = String(p.path[0] ?? "");
    if (campo && !erros[campo]) erros[campo] = p.message;
  }
  return erros;
}

function comoErro(erro: unknown): EstadoCompras {
  if (erro instanceof SemPermissao || erro instanceof ExigeUnidade) {
    return { erro: erro.message };
  }
  if (erro instanceof Error && erro.message.includes("Unique constraint")) {
    return { erro: "Esse registro já existe." };
  }
  if (erro instanceof Error) return { erro: erro.message };
  throw erro;
}

// --------------------------------------------------------------- FORNECEDORES

export async function salvarFornecedorAcao(
  _anterior: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaFornecedor.safeParse({
    nome: dados.get("nome") ?? "",
    documento: dados.get("documento") ?? "",
    telefone: dados.get("telefone") ?? "",
    email: dados.get("email") ?? "",
    contato: dados.get("contato") ?? "",
    prazoEntregaDias: dados.get("prazoEntregaDias") ?? "",
    condicaoPagamento: dados.get("condicaoPagamento") ?? "",
    observacao: dados.get("observacao") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  const id = String(dados.get("id") ?? "");

  try {
    await salvarFornecedor(contexto, id || null, analise.data);
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { nome: "Já existe um fornecedor com esse nome." } };
    }
    return comoErro(erro);
  }

  revalidatePath("/compras/fornecedores");
  redirect("/compras/fornecedores");
}

export async function alternarFornecedorAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await alternarFornecedor(contexto, id);
  revalidatePath("/compras/fornecedores");
}
