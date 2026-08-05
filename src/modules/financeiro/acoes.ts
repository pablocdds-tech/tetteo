"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";

import {
  esquemaCategoria,
  esquemaConta,
  esquemaLancamento,
  esquemaQuitacao,
} from "./schemas/entradas";
import {
  desativarCategoria,
  importarNotas,
  salvarCategoria,
  salvarConta,
} from "./services/cadastros";
import {
  cancelarLancamento,
  criarLancamento,
  estornarLancamento,
  quitarLancamento,
} from "./services/lancamentos";

export type EstadoFinanceiro = {
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

function comoErro(erro: unknown): EstadoFinanceiro {
  if (erro instanceof SemPermissao || erro instanceof ExigeUnidade) {
    return { erro: erro.message };
  }
  if (erro instanceof Error && erro.message.includes("Unique constraint")) {
    return { erro: "Esse registro já existe." };
  }
  if (erro instanceof Error) return { erro: erro.message };
  throw erro;
}

function revalidar() {
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/pagar");
  revalidatePath("/financeiro/receber");
  revalidatePath("/financeiro/resultado");
}

export async function criarLancamentoAcao(
  _anterior: EstadoFinanceiro,
  dados: FormData,
): Promise<EstadoFinanceiro> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaLancamento.safeParse({
    direcao: dados.get("direcao") ?? "PAGAR",
    descricao: dados.get("descricao") ?? "",
    valor: dados.get("valor") ?? "",
    vencimento: dados.get("vencimento") ?? "",
    categoriaId: dados.get("categoriaId") ?? "",
    fornecedorId: dados.get("fornecedorId") ?? "",
    contaId: dados.get("contaId") ?? "",
    parcelas: dados.get("parcelas") || "1",
    observacao: dados.get("observacao") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    const criadas = await criarLancamento(contexto, analise.data);
    revalidar();
    return {
      ok:
        criadas === 1
          ? "Conta cadastrada."
          : `${criadas} parcelas cadastradas.`,
    };
  } catch (erro) {
    return comoErro(erro);
  }
}

export async function quitarLancamentoAcao(
  _anterior: EstadoFinanceiro,
  dados: FormData,
): Promise<EstadoFinanceiro> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("lancamentoId") ?? "");
  if (!id) return { erro: "Conta não informada." };

  const analise = esquemaQuitacao.safeParse({
    valorQuitado: dados.get("valorQuitado") ?? "",
    quitadoEm: dados.get("quitadoEm") ?? "",
    contaId: dados.get("contaId") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await quitarLancamento(contexto, id, analise.data);
    revalidar();
    return { ok: "Baixa registrada." };
  } catch (erro) {
    return comoErro(erro);
  }
}

export async function estornarAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("lancamentoId") ?? "");
  if (!id) return;

  await estornarLancamento(contexto, id);
  revalidar();
}

export async function cancelarLancamentoAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("lancamentoId") ?? "");
  if (!id) return;

  await cancelarLancamento(contexto, id, dados.get("futurasTambem") === "on");
  revalidar();
}

export async function salvarCategoriaAcao(
  _anterior: EstadoFinanceiro,
  dados: FormData,
): Promise<EstadoFinanceiro> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaCategoria.safeParse({
    nome: dados.get("nome") ?? "",
    tipo: dados.get("tipo") ?? "DESPESA",
    grupo: dados.get("grupo") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await salvarCategoria(
      contexto,
      String(dados.get("id") ?? "") || null,
      analise.data,
    );
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { nome: "Já existe uma categoria com esse nome." } };
    }
    return comoErro(erro);
  }

  revalidatePath("/financeiro/categorias");
  return { ok: "Categoria salva." };
}

export async function desativarCategoriaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await desativarCategoria(contexto, id);
  revalidatePath("/financeiro/categorias");
}

export async function salvarContaAcao(
  _anterior: EstadoFinanceiro,
  dados: FormData,
): Promise<EstadoFinanceiro> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaConta.safeParse({
    nome: dados.get("nome") ?? "",
    tipo: dados.get("tipo") ?? "BANCO",
    saldoInicial: dados.get("saldoInicial") || "0",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await salvarConta(
      contexto,
      String(dados.get("id") ?? "") || null,
      analise.data,
    );
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { nome: "Já existe uma conta com esse nome." } };
    }
    return comoErro(erro);
  }

  revalidatePath("/financeiro/categorias");
  revalidatePath("/financeiro");
  return { ok: "Conta salva." };
}

export async function importarNotasAcao(
  _anterior: EstadoFinanceiro,
  dados: FormData,
): Promise<EstadoFinanceiro> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const ids = dados.getAll("notaId").map(String);
  if (ids.length === 0) {
    return { erro: "Escolha ao menos uma nota." };
  }

  try {
    const criadas = await importarNotas(
      contexto,
      ids,
      String(dados.get("categoriaId") ?? "") || null,
    );
    revalidar();
    return {
      ok:
        criadas === 0
          ? "Nenhuma nota nova para importar."
          : `${criadas} ${criadas === 1 ? "conta criada" : "contas criadas"}.`,
    };
  } catch (erro) {
    return comoErro(erro);
  }
}
