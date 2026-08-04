"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { APPS_REGISTRADOS } from "@/registro-de-apps";

import { chavesValidas, CORINGA } from "./permissoes";
import {
  esquemaNovoUsuario,
  esquemaOrganizacao,
  esquemaPapel,
  esquemaTrocaDeSenha,
  esquemaUnidade,
} from "./schemas";
import {
  alternarAcesso,
  alternarUnidade,
  atualizarUnidade,
  criarPapel,
  criarPessoa,
  criarUnidade,
  excluirPapel,
  redefinirSenha,
  salvarOrganizacao,
  salvarPapel,
  trocarPapelDoAcesso,
} from "./servicos";

export type EstadoConfig = {
  erro?: string;
  erros?: Record<string, string>;
  sucesso?: string;
};

function coletarErros(issues: { path: PropertyKey[]; message: string }[]) {
  const erros: Record<string, string> = {};
  for (const problema of issues) {
    const campo = String(problema.path[0] ?? "");
    if (campo && !erros[campo]) erros[campo] = problema.message;
  }
  return erros;
}

async function contexto() {
  const c = await obterContexto();
  if (!c) redirect("/login");
  return c;
}

function traduzir(erro: unknown): EstadoConfig {
  if (erro instanceof SemPermissao) return { erro: erro.message };
  if (erro instanceof Error) {
    if (erro.message.includes("Unique constraint")) {
      return {
        erro: "Já existe um registro com esse nome ou código. Escolha outro.",
      };
    }
    return { erro: erro.message };
  }
  throw erro;
}

// ---------------------------------------------------------------------------

export async function salvarOrganizacaoAcao(
  _anterior: EstadoConfig,
  dados: FormData,
): Promise<EstadoConfig> {
  const c = await contexto();

  const analise = esquemaOrganizacao.safeParse({
    nome: dados.get("nome") ?? "",
    documento: dados.get("documento") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await salvarOrganizacao(c, analise.data);
  } catch (erro) {
    return traduzir(erro);
  }

  revalidatePath("/configuracoes");
  return { sucesso: "Dados da rede salvos." };
}

export async function salvarUnidadeAcao(
  _anterior: EstadoConfig,
  dados: FormData,
): Promise<EstadoConfig> {
  const c = await contexto();

  const analise = esquemaUnidade.safeParse({
    nome: dados.get("nome") ?? "",
    codigo: dados.get("codigo") ?? "",
    documento: dados.get("documento") ?? "",
    cidade: dados.get("cidade") ?? "",
    estado: dados.get("estado") ?? "",
    telefone: dados.get("telefone") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  const id = String(dados.get("id") ?? "");

  try {
    if (id) await atualizarUnidade(c, id, analise.data);
    else await criarUnidade(c, analise.data);
  } catch (erro) {
    return traduzir(erro);
  }

  revalidatePath("/configuracoes/unidades");
  redirect("/configuracoes/unidades");
}

export async function alternarUnidadeAcao(dados: FormData) {
  const c = await contexto();
  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await alternarUnidade(c, id);
  revalidatePath("/configuracoes/unidades");
}

// ---------------------------------------------------------------------------

export async function salvarPapelAcao(
  _anterior: EstadoConfig,
  dados: FormData,
): Promise<EstadoConfig> {
  const c = await contexto();

  const pedidas = dados.getAll("permissoes").map(String);

  // Só entram chaves que algum manifesto declara. Sem isto, um formulário
  // adulterado gravaria "financeiro.*" num papel de caixa — e a permissão
  // passaria a valer no dia em que o App fosse construído.
  const validas = chavesValidas(APPS_REGISTRADOS);
  const permissoes = pedidas.filter((p) => p === CORINGA || validas.has(p));

  const analise = esquemaPapel.safeParse({
    nome: dados.get("nome") ?? "",
    descricao: dados.get("descricao") ?? "",
    permissoes,
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  const id = String(dados.get("id") ?? "");

  try {
    if (id) await salvarPapel(c, id, analise.data);
    else await criarPapel(c, analise.data);
  } catch (erro) {
    return traduzir(erro);
  }

  revalidatePath("/configuracoes/usuarios");
  redirect("/configuracoes/usuarios");
}

export async function excluirPapelAcao(dados: FormData) {
  const c = await contexto();
  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await excluirPapel(c, id);
  revalidatePath("/configuracoes/usuarios");
}

// ---------------------------------------------------------------------------

export async function criarPessoaAcao(
  _anterior: EstadoConfig,
  dados: FormData,
): Promise<EstadoConfig> {
  const c = await contexto();

  const analise = esquemaNovoUsuario.safeParse({
    nome: dados.get("nome") ?? "",
    email: dados.get("email") ?? "",
    senha: dados.get("senha") ?? "",
    papelId: dados.get("papelId") ?? "",
    unidadeId: dados.get("unidadeId") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await criarPessoa(c, analise.data);
  } catch (erro) {
    return traduzir(erro);
  }

  revalidatePath("/configuracoes/usuarios");
  redirect("/configuracoes/usuarios");
}

export async function trocarPapelAcao(dados: FormData) {
  const c = await contexto();
  const acessoId = String(dados.get("acessoId") ?? "");
  const papelId = String(dados.get("papelId") ?? "");
  if (!acessoId || !papelId) return;

  await trocarPapelDoAcesso(c, acessoId, papelId);
  revalidatePath("/configuracoes/usuarios");
}

export async function alternarAcessoAcao(dados: FormData) {
  const c = await contexto();
  const acessoId = String(dados.get("acessoId") ?? "");
  if (!acessoId) return;

  await alternarAcesso(c, acessoId);
  revalidatePath("/configuracoes/usuarios");
}

export async function redefinirSenhaAcao(
  _anterior: EstadoConfig,
  dados: FormData,
): Promise<EstadoConfig> {
  const c = await contexto();

  const analise = esquemaTrocaDeSenha.safeParse({
    usuarioId: dados.get("usuarioId") ?? "",
    senha: dados.get("senha") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await redefinirSenha(c, analise.data.usuarioId, analise.data.senha);
  } catch (erro) {
    return traduzir(erro);
  }

  revalidatePath("/configuracoes/usuarios");
  return { sucesso: "Senha redefinida. Entregue a nova senha à pessoa." };
}
