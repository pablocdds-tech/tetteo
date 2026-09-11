import type { Prisma } from "@prisma/client";

import {
  contextoDeFundo,
  pode,
  type ContextoSessao,
} from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  estadoPelaConsulta,
  type ConsultaDoProvedor,
  type EstadoGravado,
} from "../schemas/conexao";

import { registrarAuditoria } from "./auditoria";

/**
 * A CONEXÃO — o número, do jeito que a Severina o enxerga.
 *
 * Não conhece a Evolution: guarda o que o provedor contou (estado, última
 * notícia) e as decisões de gente (loja autorizada, envio ligado,
 * agendamentos pausados). Quem pergunta ao provedor é a camada `app/`, que
 * depois entrega a resposta aqui para gravar.
 *
 * A REGRA QUE SUSTENTA O QR CODE: a permissão vale NA LOJA DA CONEXÃO, não na
 * loja que está aberta na tela. Quem é Gerente no Centro e só Consulta na
 * Zona Sul não conecta o número da Zona Sul — nem com o Centro aberto. O
 * contexto é montado para aquela pessoa naquela loja, e `pode()` decide ali.
 */

const SELECAO = {
  id: true,
  organizacaoId: true,
  unidadeId: true,
  nome: true,
  provedor: true,
  numeroProprio: true,
  ativa: true,
  estado: true,
  estadoDesde: true,
  vistoEm: true,
  motivoAtencao: true,
  agendamentosPausados: true,
  eventosConfiguradosEm: true,
  ultimoEnvioEm: true,
  conectadaEm: true,
  desconectadaEm: true,
} satisfies Prisma.InstanciaWhatsappSelect;

export type ConexaoInterna = Prisma.InstanciaWhatsappGetPayload<{
  select: typeof SELECAO;
}>;

export type ConexaoNaTela = ConexaoInterna & { unidadeNome: string | null };

/** A pessoa pode `chave` naquela loja? Loja vazia = a rede inteira. */
export async function podeNaLoja(
  usuarioId: string,
  unidadeId: string | null,
  chave: string,
): Promise<boolean> {
  const naLoja = await contextoDeFundo(usuarioId, unidadeId);
  return naLoja !== null && pode(naLoja, chave);
}

/** Carrega a conexão da organização e confere a permissão na loja dela. */
export async function exigirNaLojaDaConexao(
  contexto: ContextoSessao,
  conexaoId: string,
  chave: string,
  acao: string,
): Promise<ConexaoInterna> {
  const conexao = await db.instanciaWhatsapp.findFirst({
    where: {
      id: conexaoId,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    select: SELECAO,
  });
  if (!conexao) throw new Error("Conexão não encontrada.");
  if (!(await podeNaLoja(contexto.usuario.id, conexao.unidadeId, chave))) {
    throw new SemPermissao(acao);
  }
  return conexao;
}

/** Quem vê a conexão na tela: a da rede, só quem vê a rede. */
function enxerga(contexto: ContextoSessao, unidadeId: string | null): boolean {
  if (unidadeId === null) return contexto.podeVerRedeInteira;
  return contexto.unidadesVisiveis.some((u) => u.id === unidadeId);
}

export async function listarConexoes(
  contexto: ContextoSessao,
): Promise<ConexaoNaTela[]> {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver o WhatsApp");
  }

  const todas = await db.instanciaWhatsapp.findMany({
    where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: SELECAO,
    orderBy: { criadoEm: "asc" },
  });

  const nomes = new Map(contexto.unidadesVisiveis.map((u) => [u.id, u.nome]));
  return todas
    .filter((c) => enxerga(contexto, c.unidadeId))
    .map((c) => ({
      ...c,
      unidadeNome: c.unidadeId ? (nomes.get(c.unidadeId) ?? null) : null,
    }));
}

export async function obterConexao(
  contexto: ContextoSessao,
  id: string,
): Promise<ConexaoNaTela | null> {
  return (await listarConexoes(contexto)).find((c) => c.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// O QUE O RELÓGIO E O WEBHOOK USAM — sem contexto, sem tela
// ---------------------------------------------------------------------------

export async function conexoesCadastradas(
  apenasId?: string,
): Promise<ConexaoInterna[]> {
  return db.instanciaWhatsapp.findMany({
    where: { excluidoEm: null, ...(apenasId ? { id: apenasId } : {}) },
    select: SELECAO,
    orderBy: { criadoEm: "asc" },
  });
}

/**
 * A conexão pelo nome da instância — o único dado que o webhook traz.
 *
 * Nome de instância é único numa Evolution. Dois cadastros com o mesmo nome
 * é configuração errada, e na dúvida ninguém é aceito: a loja e a
 * organização saem do CADASTRO, nunca do que o corpo do webhook diz.
 */
export async function conexaoPorNome(
  nome: string,
): Promise<ConexaoInterna | null> {
  const achadas = await db.instanciaWhatsapp.findMany({
    where: { nome, excluidoEm: null },
    select: SELECAO,
    take: 2,
  });
  return achadas.length === 1 ? achadas[0] : null;
}

/**
 * Grava o que o provedor contou — pela consulta do relógio, pela tela, ou
 * pelo evento de conexão. As três passam pela mesma regra.
 */
export async function registrarConsulta(
  id: string,
  consulta: ConsultaDoProvedor,
  numero: string | null,
  agora: Date,
): Promise<EstadoGravado> {
  const atual = await db.instanciaWhatsapp.findUniqueOrThrow({
    where: { id },
    select: { estado: true, estadoDesde: true, motivoAtencao: true },
  });
  const novo = estadoPelaConsulta(consulta, atual, agora);
  const mudou = novo.estado !== atual.estado;

  await db.instanciaWhatsapp.update({
    where: { id },
    data: {
      estado: novo.estado,
      estadoDesde: novo.estadoDesde,
      motivoAtencao: novo.motivoAtencao,
      // "Última notícia" é o provedor RESPONDENDO. Erro não é notícia.
      ...(consulta.tipo === "ok" ? { vistoEm: agora } : {}),
      ...(mudou && novo.estado === "CONECTADO" ? { conectadaEm: agora } : {}),
      ...(mudou && novo.estado === "DESCONECTADO"
        ? { desconectadaEm: agora }
        : {}),
      ...(numero ? { numeroProprio: numero } : {}),
    },
  });
  return novo;
}

/** Qualquer evento que chegou é sinal de que o provedor está vivo. */
export async function marcarNoticia(id: string, agora: Date): Promise<void> {
  await db.instanciaWhatsapp.updateMany({
    where: { id, excluidoEm: null },
    data: { vistoEm: agora },
  });
}

export async function marcarEnvio(id: string, agora: Date): Promise<void> {
  await db.instanciaWhatsapp.update({
    where: { id },
    data: { ultimoEnvioEm: agora },
  });
}

export async function registrarEventosConfigurados(
  contexto: ContextoSessao,
  id: string,
  eventos: string[],
  agora: Date,
): Promise<void> {
  await db.instanciaWhatsapp.update({
    where: { id },
    data: { eventosConfiguradosEm: agora },
  });
  await registrarAuditoria(contexto, {
    entidade: "InstanciaWhatsapp",
    entidadeId: id,
    acao: "ALTEROU",
    depois: { eventosAplicados: eventos },
  });
}

/** Quem viu o QR Code, e quando. Ver o QR é poder tomar o número. */
export async function registrarPedidoDeQr(
  contexto: ContextoSessao,
  conexao: { id: string; unidadeId: string | null },
): Promise<void> {
  await registrarAuditoria(contexto, {
    entidade: "InstanciaWhatsapp",
    entidadeId: conexao.id,
    acao: "ACESSOU",
    unidadeId: conexao.unidadeId,
    depois: { pediu: "QR Code" },
  });
}

// ---------------------------------------------------------------------------
// AS DECISÕES DE GENTE
// ---------------------------------------------------------------------------

/**
 * A CHAVE GERAL do envio. Desligada, nada sai — nem aviso já confirmado.
 * É o botão do dia em que algo der errado.
 */
export async function alternarEnvio(
  contexto: ContextoSessao,
  id: string,
): Promise<void> {
  const conexao = await exigirNaLojaDaConexao(
    contexto,
    id,
    "assistente.conectar",
    "pausar ou liberar o envio do WhatsApp",
  );
  await db.instanciaWhatsapp.update({
    where: { id },
    data: { ativa: !conexao.ativa },
  });
  await registrarAuditoria(contexto, {
    entidade: "InstanciaWhatsapp",
    entidadeId: id,
    acao: "ALTEROU",
    unidadeId: conexao.unidadeId,
    antes: { envioLigado: conexao.ativa },
    depois: { envioLigado: !conexao.ativa },
  });
}

/**
 * Os agendamentos da Severina nascem pausados. Liberar é decisão do dono,
 * depois de escolher horário, fuso, público e conteúdo.
 */
export async function alternarAgendamentos(
  contexto: ContextoSessao,
  id: string,
): Promise<void> {
  const conexao = await exigirNaLojaDaConexao(
    contexto,
    id,
    "assistente.conectar",
    "pausar ou liberar os agendamentos",
  );
  await db.instanciaWhatsapp.update({
    where: { id },
    data: { agendamentosPausados: !conexao.agendamentosPausados },
  });
  await registrarAuditoria(contexto, {
    entidade: "InstanciaWhatsapp",
    entidadeId: id,
    acao: "ALTEROU",
    unidadeId: conexao.unidadeId,
    antes: { agendamentosPausados: conexao.agendamentosPausados },
    depois: { agendamentosPausados: !conexao.agendamentosPausados },
  });
}

/**
 * Para qual loja o número está autorizado. Trocar exige poder conectar na
 * loja de ANTES e na de DEPOIS — senão bastaria mover a conexão para a
 * própria loja para passar a ver o QR de outra.
 */
export async function definirLoja(
  contexto: ContextoSessao,
  id: string,
  unidadeId: string | null,
): Promise<void> {
  const conexao = await exigirNaLojaDaConexao(
    contexto,
    id,
    "assistente.conectar",
    "mudar a loja do número",
  );
  if (unidadeId !== null) {
    const existe = await db.unidade.findFirst({
      where: {
        id: unidadeId,
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
      },
      select: { id: true },
    });
    if (!existe) throw new Error("Loja não encontrada.");
  }
  if (
    !(await podeNaLoja(contexto.usuario.id, unidadeId, "assistente.conectar"))
  ) {
    throw new SemPermissao("autorizar o número para essa loja");
  }

  await db.instanciaWhatsapp.update({ where: { id }, data: { unidadeId } });
  await registrarAuditoria(contexto, {
    entidade: "InstanciaWhatsapp",
    entidadeId: id,
    acao: "ALTEROU",
    unidadeId,
    antes: { unidadeId: conexao.unidadeId },
    depois: { unidadeId },
  });
}

/**
 * Cadastra no Tetteo uma instância que JÁ EXISTE na Evolution.
 *
 * Não cria nada lá: o número já conectado continua conectado. Se o Tetteo já
 * tinha uma linha com esse nome (a Severina cria uma com o primeiro agente),
 * ela é reaproveitada — com o histórico junto.
 */
export async function cadastrarConexao(
  contexto: ContextoSessao,
  dados: { nome: string; unidadeId: string | null },
): Promise<{ id: string }> {
  if (
    !(await podeNaLoja(
      contexto.usuario.id,
      dados.unidadeId,
      "assistente.conectar",
    ))
  ) {
    throw new SemPermissao("cadastrar o número de WhatsApp");
  }
  const nome = dados.nome.trim();
  if (!nome) throw new Error("Falta o nome da instância na Evolution.");

  const existente = await db.instanciaWhatsapp.findFirst({
    where: { organizacaoId: contexto.organizacao.id, nome },
    select: { id: true },
  });
  const conexao = existente
    ? await db.instanciaWhatsapp.update({
        where: { id: existente.id },
        data: { excluidoEm: null },
        select: { id: true },
      })
    : await db.instanciaWhatsapp.create({
        data: {
          organizacaoId: contexto.organizacao.id,
          nome,
          unidadeId: dados.unidadeId,
          provedor: "EVOLUTION_BAILEYS",
          agendamentosPausados: true,
        },
        select: { id: true },
      });

  await registrarAuditoria(contexto, {
    entidade: "InstanciaWhatsapp",
    entidadeId: conexao.id,
    acao: existente ? "ALTEROU" : "CRIOU",
    unidadeId: dados.unidadeId,
    depois: { nome, unidadeId: dados.unidadeId },
  });
  return conexao;
}
