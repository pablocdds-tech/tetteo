"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";

import { esquemaNovaContagem, esquemaQuantidade } from "./schemas/contagem";
import {
  cancelarContagem,
  criarContagem,
  fecharContagem,
  salvarQuantidades,
} from "./services/contagens";

export type EstadoFormulario = {
  erro?: string;
  erros?: Record<string, string>;
  salvos?: number;
};

/** Prefixo dos campos de quantidade na folha: `qtd:<id do insumo>`. */
const PREFIXO = "qtd:";

export async function abrirContagem(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaNovaContagem.safeParse({
    referencia: dados.get("referencia") ?? "",
    descricao: dados.get("descricao") ?? "",
    categorias: dados.getAll("categorias").map(String),
  });

  if (!analise.success) {
    const erros: Record<string, string> = {};
    for (const problema of analise.error.issues) {
      const campo = String(problema.path[0] ?? "");
      if (campo && !erros[campo]) erros[campo] = problema.message;
    }
    return { erros };
  }

  let id: string;
  try {
    const contagem = await criarContagem(contexto, analise.data);
    id = contagem.id;
  } catch (erro) {
    if (erro instanceof SemPermissao || erro instanceof ExigeUnidade) {
      return { erro: erro.message };
    }
    if (erro instanceof Error) return { erro: erro.message };
    throw erro;
  }

  revalidatePath("/estoque/contagens");
  // Vai direto para a folha: quem abriu a contagem abriu para contar agora.
  redirect(`/estoque/contagens/${id}`);
}

/**
 * Lê a folha inteira do formulário.
 *
 * Só devolve o que a pessoa efetivamente mexeu ou preencheu — campos em branco
 * que continuam em branco não viram escrita no banco à toa.
 */
function lerFolha(dados: FormData) {
  const valores = new Map<string, number | null>();
  const erros: Record<string, string> = {};

  for (const [chave, bruto] of dados.entries()) {
    if (!chave.startsWith(PREFIXO)) continue;
    const insumoId = chave.slice(PREFIXO.length);

    const analise = esquemaQuantidade.safeParse(String(bruto));
    if (!analise.success) {
      erros[insumoId] = analise.error.issues[0]?.message ?? "Número inválido.";
      continue;
    }
    valores.set(insumoId, analise.data);
  }

  return { valores, erros };
}

export async function salvarFolha(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("contagemId") ?? "");
  if (!id) return { erro: "Contagem não informada." };

  const { valores, erros } = lerFolha(dados);
  if (Object.keys(erros).length > 0) {
    return {
      erro: `${Object.keys(erros).length} ${Object.keys(erros).length === 1 ? "quantidade não foi entendida" : "quantidades não foram entendidas"}. Use apenas números, com vírgula para os decimais.`,
      erros,
    };
  }

  try {
    await salvarQuantidades(contexto, id, valores);
  } catch (erro) {
    if (erro instanceof SemPermissao || erro instanceof ExigeUnidade) {
      return { erro: erro.message };
    }
    if (erro instanceof Error) return { erro: erro.message };
    throw erro;
  }

  revalidatePath(`/estoque/contagens/${id}`);
  return { salvos: valores.size };
}

/**
 * Fecha a contagem — mas grava o que está na tela ANTES.
 *
 * Sem isso, quem digitasse as últimas quantidades e fosse direto em "Fechar"
 * perderia justamente elas, e a contagem fecharia errada sem avisar.
 */
export async function fecharFolha(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("contagemId") ?? "");
  if (!id) return { erro: "Contagem não informada." };

  const { valores, erros } = lerFolha(dados);
  if (Object.keys(erros).length > 0) {
    return {
      erro: "Há quantidades que o sistema não entendeu. Corrija antes de fechar.",
      erros,
    };
  }

  try {
    await salvarQuantidades(contexto, id, valores);
    await fecharContagem(contexto, id);
  } catch (erro) {
    if (erro instanceof SemPermissao || erro instanceof ExigeUnidade) {
      return { erro: erro.message };
    }
    if (erro instanceof Error) return { erro: erro.message };
    throw erro;
  }

  revalidatePath("/estoque/contagens");
  redirect(`/estoque/contagens/${id}`);
}

export async function cancelarContagemAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("contagemId") ?? "");
  if (!id) return;

  await cancelarContagem(contexto, id);
  revalidatePath("/estoque/contagens");
  redirect("/estoque/contagens");
}
