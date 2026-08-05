"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";

import { esquemaAgente, esquemaVinculo } from "./schemas/agente";
import {
  alternarAgente,
  criarAgente,
  desativarAgente,
} from "./services/agentes";
import {
  alternarInstancia,
  criarVinculo,
  garantirInstancia,
  removerVinculo,
} from "./services/vinculos";

/**
 * As ações das telas da Severina.
 *
 * Mesmo formato do resto do sistema: valida com Zod, chama o serviço, devolve
 * erro por campo. A tela nunca fala com o banco.
 */

export type EstadoFormulario = {
  erro?: string;
  erros?: Record<string, string>;
  ok?: boolean;
};

function errosDoZod(issues: { path: PropertyKey[]; message: string }[]) {
  const erros: Record<string, string> = {};
  for (const problema of issues) {
    const campo = String(problema.path[0] ?? "");
    if (campo && !erros[campo]) erros[campo] = problema.message;
  }
  return erros;
}

function paraMensagem(erro: unknown): EstadoFormulario {
  if (erro instanceof SemPermissao) return { erro: erro.message };
  if (erro instanceof Error) return { erro: erro.message };
  throw erro;
}

export async function criarAgenteAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaAgente.safeParse({
    nome: dados.get("nome") ?? "",
    unidadeId: dados.get("unidadeId") ?? "",
    gatilho: dados.get("gatilho") ?? "",
    horario: dados.get("horario") ?? "",
    diasDaSemana: dados.getAll("diasDaSemana").map(String),
    destinatariosPapeis: dados.getAll("destinatariosPapeis").map(String),
    destinatariosUsuarios: dados.getAll("destinatariosUsuarios").map(String),
    instrucoes: dados.get("instrucoes") ?? "",
    janelaInicio: dados.get("janelaInicio") ?? "",
    janelaFim: dados.get("janelaFim") ?? "",
  });

  if (!analise.success) return { erros: errosDoZod(analise.error.issues) };

  try {
    // O agente precisa de um número para falar. Criar a instância aqui evita
    // o estado "agente pronto, Severina sem número" — que pareceria
    // configurado e nunca falaria.
    await garantirInstancia(contexto);
    await criarAgente(contexto, analise.data);
  } catch (erro) {
    return paraMensagem(erro);
  }

  revalidatePath("/assistente/agentes");
  redirect("/assistente/agentes");
}

export async function alternarAgenteAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await alternarAgente(contexto, id);
  revalidatePath("/assistente/agentes");
}

export async function excluirAgenteAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await desativarAgente(contexto, id);
  revalidatePath("/assistente/agentes");
}

export async function criarVinculoAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaVinculo.safeParse({
    usuarioId: dados.get("usuarioId") ?? "",
    telefone: dados.get("telefone") ?? "",
  });

  if (!analise.success) return { erros: errosDoZod(analise.error.issues) };

  try {
    await criarVinculo(contexto, analise.data);
  } catch (erro) {
    return paraMensagem(erro);
  }

  revalidatePath("/assistente/vinculos");
  return { ok: true };
}

export async function removerVinculoAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await removerVinculo(contexto, id);
  revalidatePath("/assistente/vinculos");
}

/** A chave geral. Desligada, a Severina cala por completo. */
export async function alternarInstanciaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await alternarInstancia(contexto, id);
  revalidatePath("/assistente");
  revalidatePath("/assistente/vinculos");
}
