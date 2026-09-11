import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { normalizarTelefone, telefoneDoJid } from "@/lib/telefone";
import { db } from "@/server/db";

import { registrarAuditoria } from "./auditoria";

/**
 * OS VÍNCULOS — quem existe para a Severina.
 *
 * Sem linha aqui, a pessoa não existe: a Severina não fala com ela, e (na
 * fase 2) mensagem vinda dela é descartada sem ser gravada. É o que impede os
 * mil contatos pessoais do número de entrarem no banco de gestão.
 *
 * A tabela existe porque o WhatsApp migrou para o LID e escondeu o telefone
 * de quem escreve — comparar com `Usuario.telefone` deixou de funcionar.
 */

export type VinculoNaLista = {
  id: string;
  usuarioId: string;
  nome: string;
  email: string;
  telefone: string;
  confirmadoEm: Date | null;
  /** Autorizado para receber avisos — decisão de um responsável. */
  autorizadoEm: Date | null;
};

export async function listarVinculos(
  contexto: ContextoSessao,
): Promise<VinculoNaLista[]> {
  if (!pode(contexto, "assistente.vincular")) {
    throw new SemPermissao("ver os números vinculados");
  }

  const vinculos = await db.vinculoWhatsapp.findMany({
    where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
    orderBy: { criadoEm: "asc" },
  });

  const pessoas = await db.usuario.findMany({
    where: { id: { in: vinculos.map((v) => v.usuarioId) } },
    select: { id: true, nome: true, email: true },
  });
  const porId = new Map(pessoas.map((p) => [p.id, p]));

  return vinculos.map((v) => ({
    id: v.id,
    usuarioId: v.usuarioId,
    nome: porId.get(v.usuarioId)?.nome ?? "(usuário removido)",
    email: porId.get(v.usuarioId)?.email ?? "",
    telefone: v.telefone,
    confirmadoEm: v.confirmadoEm,
    autorizadoEm: v.autorizadoEm,
  }));
}

/** Quem ainda pode ganhar um vínculo. */
export async function pessoasSemVinculo(contexto: ContextoSessao) {
  if (!pode(contexto, "assistente.vincular")) {
    throw new SemPermissao("vincular números");
  }

  const jaVinculados = await db.vinculoWhatsapp.findMany({
    where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: { usuarioId: true },
  });

  const acessos = await db.acesso.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      status: "ATIVO",
      excluidoEm: null,
      usuarioId: { notIn: jaVinculados.map((v) => v.usuarioId) },
    },
    select: { usuarioId: true },
  });

  return db.usuario.findMany({
    where: {
      id: { in: [...new Set(acessos.map((a) => a.usuarioId))] },
      excluidoEm: null,
    },
    select: { id: true, nome: true, email: true },
    orderBy: { nome: "asc" },
  });
}

export async function criarVinculo(
  contexto: ContextoSessao,
  dados: { usuarioId: string; telefone: string },
) {
  if (!pode(contexto, "assistente.vincular")) {
    throw new SemPermissao("vincular números");
  }

  const telefone = normalizarTelefone(dados.telefone);
  // Recusar é melhor do que adivinhar: um número inventado vira mensagem para
  // um estranho, no WhatsApp pessoal de alguém.
  if (!telefone) {
    throw new Error("Não consegui entender esse telefone. Ex.: 84 98133-6549");
  }

  // O `remoteJid` começa no formato antigo. Quando a pessoa escrever pela
  // primeira vez e chegar um LID, a fase 2 atualiza o vínculo — até lá, o
  // envio funciona, porque enviar só precisa do número.
  const remoteJid = `${telefone}@s.whatsapp.net`;

  const existente = await db.vinculoWhatsapp.findFirst({
    where: { organizacaoId: contexto.organizacao.id, remoteJid },
    select: { id: true, excluidoEm: true },
  });

  if (existente) {
    // Vínculo excluído que volta: reaproveita a linha em vez de criar uma
    // segunda com o mesmo número, que a chave única recusaria.
    await db.vinculoWhatsapp.update({
      where: { id: existente.id },
      data: { usuarioId: dados.usuarioId, telefone, excluidoEm: null },
    });
    return { id: existente.id };
  }

  return db.vinculoWhatsapp.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      usuarioId: dados.usuarioId,
      remoteJid,
      telefone,
    },
    select: { id: true },
  });
}

export async function removerVinculo(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "assistente.vincular")) {
    throw new SemPermissao("remover vínculos");
  }

  const vinculo = await db.vinculoWhatsapp.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    select: { id: true },
  });
  if (!vinculo) throw new Error("Vínculo não encontrado.");

  await db.vinculoWhatsapp.update({
    where: { id },
    data: { excluidoEm: new Date() },
  });
}

// ---------------------------------------------------------------------------
// A INSTÂNCIA — o número, e a chave geral
// ---------------------------------------------------------------------------

export async function obterInstancia(contexto: ContextoSessao) {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver a Severina");
  }

  return db.instanciaWhatsapp.findFirst({
    where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
  });
}

/**
 * Garante que existe uma instância para esta organização.
 *
 * O nome vem do ambiente porque quem manda é a Evolution: o Tetteo não
 * escolhe como a instância se chama, ele descobre.
 */
export async function garantirInstancia(contexto: ContextoSessao) {
  if (!pode(contexto, "assistente.configurar")) {
    throw new SemPermissao("configurar a Severina");
  }

  const nome = process.env.EVOLUTION_INSTANCIA ?? "severina";
  const existente = await db.instanciaWhatsapp.findFirst({
    where: { organizacaoId: contexto.organizacao.id, nome },
  });
  if (existente) return existente;

  return db.instanciaWhatsapp.create({
    data: { organizacaoId: contexto.organizacao.id, nome, ativa: true },
  });
}

// A CHAVE GERAL mora em `conexao.ts` (`alternarEnvio`): a permissão é
// conferida na loja DO NÚMERO, não na loja aberta na tela.

// ---------------------------------------------------------------------------
// AUTORIZADOS PARA AVISOS — quem pode RECEBER, decidido por um responsável
// ---------------------------------------------------------------------------

/**
 * Ter vínculo é existir para a Severina. Receber aviso é outra decisão, e
 * mais séria: é dizer "este telefone recebe o que acontece na loja". Por
 * isso é permissão separada (`assistente.autorizar`) e deixa rastro.
 */
export async function autorizarVinculo(
  contexto: ContextoSessao,
  id: string,
  agora = new Date(),
): Promise<void> {
  if (!pode(contexto, "assistente.autorizar")) {
    throw new SemPermissao("autorizar destinatários de avisos");
  }
  const vinculo = await db.vinculoWhatsapp.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: { id: true, autorizadoEm: true },
  });
  if (!vinculo) throw new Error("Vínculo não encontrado.");
  if (vinculo.autorizadoEm) return;

  await db.vinculoWhatsapp.update({
    where: { id },
    data: { autorizadoEm: agora, autorizadoPorId: contexto.usuario.id },
  });
  await registrarAuditoria(contexto, {
    entidade: "VinculoWhatsapp",
    entidadeId: id,
    acao: "ALTEROU",
    antes: { autorizadoParaAvisos: false },
    depois: { autorizadoParaAvisos: true },
  });
}

/** Revogada, a pessoa para de receber — inclusive o que já estava confirmado. */
export async function revogarAutorizacao(
  contexto: ContextoSessao,
  id: string,
): Promise<void> {
  if (!pode(contexto, "assistente.autorizar")) {
    throw new SemPermissao("revogar destinatários de avisos");
  }
  const vinculo = await db.vinculoWhatsapp.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    select: { id: true, autorizadoEm: true },
  });
  if (!vinculo) throw new Error("Vínculo não encontrado.");
  if (!vinculo.autorizadoEm) return;

  await db.vinculoWhatsapp.update({
    where: { id },
    data: { autorizadoEm: null, autorizadoPorId: null },
  });
  await registrarAuditoria(contexto, {
    entidade: "VinculoWhatsapp",
    entidadeId: id,
    acao: "ALTEROU",
    antes: { autorizadoParaAvisos: true },
    depois: { autorizadoParaAvisos: false },
  });
}

/**
 * Quem escreveu é alguém vinculado? Devolve só o id do vínculo — o
 * identificador de contato não segue adiante, e não é gravado em lugar
 * nenhum. Sem vínculo, a mensagem é de ninguém.
 */
export async function vinculoPorContato(
  organizacaoId: string,
  remoteJid: string,
): Promise<string | null> {
  const telefone = telefoneDoJid(remoteJid);
  const vinculo = await db.vinculoWhatsapp.findFirst({
    where: {
      organizacaoId,
      excluidoEm: null,
      OR: [{ remoteJid }, ...(telefone ? [{ telefone }] : [])],
    },
    select: { id: true },
  });
  return vinculo?.id ?? null;
}
