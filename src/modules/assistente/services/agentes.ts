import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { DadosAgente } from "../schemas/agente";

/**
 * OS AGENTES — o que o dono cria na tela.
 *
 * É esta tabela que faz a Severina não depender de programador para mudar
 * horário, destinatário ou jeito de falar. Um sistema que só o programador
 * mexe é um sistema que morre quando o programador some.
 */

export type AgenteNaLista = {
  id: string;
  nome: string;
  ativo: boolean;
  gatilho: string;
  horario: string | null;
  unidadeNome: string | null;
  destinatarios: number;
  ultimaMensagemEm: Date | null;
};

function configDeHorario(bruto: unknown): {
  horario?: string;
  diasDaSemana?: number[];
} {
  return (bruto ?? {}) as { horario?: string; diasDaSemana?: number[] };
}

export async function listarAgentes(
  contexto: ContextoSessao,
): Promise<AgenteNaLista[]> {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver os agentes da Severina");
  }

  const agentes = await db.agenteSeverina.findMany({
    where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    include: {
      conversas: {
        orderBy: { ultimaMensagemEm: "desc" },
        take: 1,
        select: { ultimaMensagemEm: true },
      },
    },
  });

  // A unidade vem por consulta separada: a Severina não declara relação com o
  // Core, e o porquê está escrito em `assistente.prisma`.
  const unidades = await db.unidade.findMany({
    where: { organizacaoId: contexto.organizacao.id },
    select: { id: true, nome: true },
  });
  const nomeDaUnidade = new Map(unidades.map((u) => [u.id, u.nome]));

  return agentes.map((a) => ({
    id: a.id,
    nome: a.nome,
    ativo: a.ativo,
    gatilho: a.gatilho,
    horario: configDeHorario(a.gatilhoConfig).horario ?? null,
    unidadeNome: a.unidadeId ? (nomeDaUnidade.get(a.unidadeId) ?? null) : null,
    destinatarios:
      a.destinatariosPapeis.length + a.destinatariosUsuarios.length,
    ultimaMensagemEm: a.conversas[0]?.ultimaMensagemEm ?? null,
  }));
}

export async function criarAgente(
  contexto: ContextoSessao,
  dados: DadosAgente,
) {
  if (!pode(contexto, "assistente.configurar")) {
    throw new SemPermissao("criar agentes");
  }

  return db.agenteSeverina.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: dados.unidadeId,
      nome: dados.nome,
      tipo: "AVISO",
      gatilho: dados.gatilho,
      gatilhoConfig:
        dados.gatilho === "HORARIO"
          ? { horario: dados.horario, diasDaSemana: dados.diasDaSemana }
          : {},
      destinatariosPapeis: dados.destinatariosPapeis,
      destinatariosUsuarios: dados.destinatariosUsuarios,
      instrucoes: dados.instrucoes,
      limites: {
        ...(dados.janelaInicio ? { janelaInicio: dados.janelaInicio } : {}),
        ...(dados.janelaFim ? { janelaFim: dados.janelaFim } : {}),
      },
      // Nasce DESLIGADO de propósito. Agente que começa falando é agente que
      // manda a primeira mensagem errada para a equipe inteira, e a primeira
      // impressão da Severina é a que fica.
      ativo: false,
    },
    select: { id: true },
  });
}

/**
 * Liga e desliga. É o botão que a pessoa vai usar mais vezes do que qualquer
 * outro nesta tela — inclusive às pressas, quando algo estiver errado.
 */
export async function alternarAgente(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "assistente.configurar")) {
    throw new SemPermissao("ligar e desligar agentes");
  }

  const agente = await db.agenteSeverina.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: { id: true, ativo: true },
  });
  if (!agente) throw new Error("Agente não encontrado.");

  await db.agenteSeverina.update({
    where: { id },
    data: { ativo: !agente.ativo },
  });
}

export async function desativarAgente(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "assistente.configurar")) {
    throw new SemPermissao("excluir agentes");
  }

  const agente = await db.agenteSeverina.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: { id: true },
  });
  if (!agente) throw new Error("Agente não encontrado.");

  // Exclusão lógica: as conversas que ele gerou continuam fazendo sentido, e
  // "por que a Severina mandou isso?" precisa continuar tendo resposta.
  await db.agenteSeverina.update({
    where: { id },
    data: { excluidoEm: new Date(), ativo: false },
  });
}

/** Os papéis e as pessoas que o formulário oferece como destinatários. */
export async function opcoesDeDestinatario(contexto: ContextoSessao) {
  if (!pode(contexto, "assistente.configurar")) {
    throw new SemPermissao("configurar agentes");
  }

  const [papeis, vinculos, unidades] = await Promise.all([
    db.papel.findMany({
      where: { organizacaoId: contexto.organizacao.id },
      select: { nome: true },
      orderBy: { nome: "asc" },
    }),
    db.vinculoWhatsapp.findMany({
      where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
      select: { usuarioId: true },
    }),
    db.unidade.findMany({
      where: {
        organizacaoId: contexto.organizacao.id,
        ativa: true,
        excluidoEm: null,
      },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  // Só oferece quem TEM número ligado. Deixar escolher alguém sem vínculo
  // seria montar um agente que parece configurado e nunca fala com aquela
  // pessoa — sem erro em lugar nenhum.
  const pessoas = await db.usuario.findMany({
    where: { id: { in: vinculos.map((v) => v.usuarioId) }, excluidoEm: null },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });

  return { papeis: papeis.map((p) => p.nome), pessoas, unidades };
}
