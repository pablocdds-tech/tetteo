"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";

import { esquemaAgente, esquemaVinculo } from "./schemas/agente";
import { esquemaRascunho } from "./schemas/aviso";
import {
  alternarAgente,
  criarAgente,
  desativarAgente,
} from "./services/agentes";
import {
  criarRascunho,
  descartarAviso,
  obterAviso,
  type AvisoNoDetalhe,
} from "./services/avisos";
import {
  alternarAgendamentos,
  alternarEnvio,
  cadastrarConexao,
  definirLoja,
} from "./services/conexao";
import {
  autorizarVinculo,
  criarVinculo,
  garantirInstancia,
  removerVinculo,
  revogarAutorizacao,
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
  // Só a mensagem de um Error "puro" chega à tela: é o que os serviços
  // escrevem para gente. Erro de banco ou de rede tem outra classe, e a
  // mensagem dele carrega host, tabela e SQL.
  if (erro instanceof Error && erro.constructor === Error) {
    return { erro: erro.message };
  }
  console.error(
    "[assistente] ação falhou:",
    erro instanceof Error ? erro.name : "erro",
  );
  return { erro: "Algo deu errado ao salvar. Tente de novo em instantes." };
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

/**
 * A chave geral. Desligada, a Severina cala por completo — e a permissão é
 * conferida na loja do número, como na tela WhatsApp.
 */
export async function alternarInstanciaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await alternarEnvio(contexto, id);
  revalidatePath("/assistente");
  revalidatePath("/assistente/vinculos");
}

// ---------------------------------------------------------------------------
// WHATSAPP — o que a tela faz sem falar com o provedor
//
// O que precisa da Evolution (QR, reconectar, eventos, confirmar e enviar)
// mora em `app/(shell)/assistente/acoes-whatsapp.ts`: só a camada `app/`
// alcança o conector.
// ---------------------------------------------------------------------------

async function contextoOuLogin() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  return contexto;
}

function revalidarWhatsapp() {
  revalidatePath("/assistente/whatsapp");
  revalidatePath("/assistente/avisos");
  revalidatePath("/assistente/vinculos");
}

/** Autorizar é dizer "este telefone recebe o que acontece na loja". */
export async function autorizarVinculoAcao(dados: FormData) {
  const contexto = await contextoOuLogin();
  const id = String(dados.get("id") ?? "");
  if (!id) return;
  await autorizarVinculo(contexto, id);
  revalidarWhatsapp();
}

export async function revogarAutorizacaoAcao(dados: FormData) {
  const contexto = await contextoOuLogin();
  const id = String(dados.get("id") ?? "");
  if (!id) return;
  await revogarAutorizacao(contexto, id);
  revalidarWhatsapp();
}

export async function alternarEnvioAcao(dados: FormData) {
  const contexto = await contextoOuLogin();
  const id = String(dados.get("id") ?? "");
  if (!id) return;
  await alternarEnvio(contexto, id);
  revalidarWhatsapp();
}

export async function alternarAgendamentosAcao(dados: FormData) {
  const contexto = await contextoOuLogin();
  const id = String(dados.get("id") ?? "");
  if (!id) return;
  await alternarAgendamentos(contexto, id);
  revalidarWhatsapp();
}

export async function definirLojaAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await contextoOuLogin();
  const id = String(dados.get("id") ?? "");
  const unidadeId = String(dados.get("unidadeId") ?? "");
  try {
    await definirLoja(contexto, id, unidadeId || null);
  } catch (erro) {
    return paraMensagem(erro);
  }
  revalidarWhatsapp();
  return { ok: true };
}

/** Cadastra no Tetteo a instância que JÁ EXISTE na Evolution. */
export async function cadastrarConexaoAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await contextoOuLogin();
  const nome = String(dados.get("nome") ?? "").trim();
  const unidadeId = String(dados.get("unidadeId") ?? "");
  if (!nome) return { erros: { nome: "Escreva o nome da instância" } };
  try {
    await cadastrarConexao(contexto, { nome, unidadeId: unidadeId || null });
  } catch (erro) {
    return paraMensagem(erro);
  }
  revalidarWhatsapp();
  return { ok: true };
}

export async function criarRascunhoAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await contextoOuLogin();
  const analise = esquemaRascunho.safeParse({
    titulo: dados.get("titulo") ?? "",
    texto: dados.get("texto") ?? "",
  });
  if (!analise.success) return { erros: errosDoZod(analise.error.issues) };

  const unidadeId = String(dados.get("unidadeId") ?? "");
  try {
    await criarRascunho(
      contexto,
      { ...analise.data, unidadeId: unidadeId || null },
      new Date(),
    );
  } catch (erro) {
    return paraMensagem(erro);
  }
  revalidarWhatsapp();
  return { ok: true };
}

export async function descartarAvisoAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await contextoOuLogin();
  const id = String(dados.get("id") ?? "");
  try {
    const r = await descartarAviso(contexto, id, new Date());
    if (!r.descartado)
      return { erro: "Este aviso já não pode ser descartado." };
  } catch (erro) {
    return paraMensagem(erro);
  }
  revalidarWhatsapp();
  return { ok: true };
}

/** O detalhe do aviso, pedido quando o painel lateral abre. */
export async function abrirAvisoAcao(
  id: string,
): Promise<AvisoNoDetalhe | null> {
  const contexto = await contextoOuLogin();
  return obterAviso(contexto, id);
}
