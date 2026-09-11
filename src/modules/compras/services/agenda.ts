import { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { aberturaDaSemana, ocorrenciaDaSemana } from "../schemas/rodada";

import { registrar } from "./auditoria";

/**
 * A AGENDA DAS RODADAS — o relógio que abre a semana de compra sozinho.
 *
 * Uma rodada por agenda POR SEMANA. A garantia é do banco, não de uma
 * consulta antes: `(agendaId, ocorrencia)` é único, e duas cópias do servidor
 * batendo no mesmo minuto fazem uma inserção e uma recusa. Mudar o dia da
 * agenda no meio da semana não abre a segunda rodada daquela semana — a chave
 * é a semana, não o dia.
 */

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

export type DadosDaAgenda = {
  id?: string;
  nome: string;
  diaDaSemana: number;
  horaAbertura: string;
  horasParaRequisicao: number;
  horasParaCotacao: number;
  entregaDeDias: number;
  entregaAteDias: number;
  unidadeIds: string[];
  ativa: boolean;
};

export async function salvarAgenda(
  ctx: ContextoSessao,
  dados: DadosDaAgenda,
): Promise<{ id: string }> {
  if (!pode(ctx, "compras.rodadas")) {
    throw new SemPermissao("mudar a agenda das rodadas");
  }
  const nome = dados.nome.trim();
  if (nome.length < 2) throw new Error("Dê um nome à agenda.");
  if (
    !Number.isInteger(dados.diaDaSemana) ||
    dados.diaDaSemana < 0 ||
    dados.diaDaSemana > 6
  ) {
    throw new Error("Escolha o dia da semana.");
  }
  if (!HORA.test(dados.horaAbertura)) {
    throw new Error("Informe a hora como 07:00.");
  }
  if (dados.horasParaCotacao <= dados.horasParaRequisicao) {
    throw new Error(
      "O prazo da cotação precisa vir depois do prazo das requisições.",
    );
  }
  if (dados.entregaAteDias < dados.entregaDeDias) {
    throw new Error("A janela de entrega termina antes de começar.");
  }
  const visiveis = new Set(ctx.unidadesVisiveis.map((u) => u.id));
  const lojas = [...new Set(dados.unidadeIds)];
  if (lojas.length === 0) throw new Error("Escolha ao menos uma loja.");
  if (lojas.some((id) => !visiveis.has(id))) {
    throw new SemPermissao("incluir uma loja que você não enxerga");
  }

  const campos = {
    nome,
    diaDaSemana: dados.diaDaSemana,
    horaAbertura: dados.horaAbertura,
    horasParaRequisicao: dados.horasParaRequisicao,
    horasParaCotacao: dados.horasParaCotacao,
    entregaDeDias: dados.entregaDeDias,
    entregaAteDias: dados.entregaAteDias,
    unidadeIds: lojas,
    ativa: dados.ativa,
  };

  if (dados.id) {
    const antes = await db.agendaDeRodada.findFirst({
      where: { id: dados.id, organizacaoId: ctx.organizacao.id },
    });
    if (!antes) throw new Error("Agenda não encontrada.");
    await db.agendaDeRodada.update({
      where: { id: dados.id },
      data: { ...campos, versao: { increment: 1 } },
    });
    await registrar(db, ctx, {
      entidade: "AgendaDeRodada",
      entidadeId: dados.id,
      acao: "ALTEROU",
      antes: {
        diaDaSemana: antes.diaDaSemana,
        horaAbertura: antes.horaAbertura,
        ativa: antes.ativa,
      },
      depois: {
        diaDaSemana: campos.diaDaSemana,
        horaAbertura: campos.horaAbertura,
        ativa: campos.ativa,
      },
    });
    return { id: dados.id };
  }

  const criada = await db.agendaDeRodada.create({
    data: {
      ...campos,
      organizacaoId: ctx.organizacao.id,
      responsavelId: ctx.usuario.id,
      criadoPorId: ctx.usuario.id,
    },
    select: { id: true },
  });
  await registrar(db, ctx, {
    entidade: "AgendaDeRodada",
    entidadeId: criada.id,
    acao: "CRIOU",
    depois: campos,
  });
  return criada;
}

export async function listarAgendas(ctx: ContextoSessao) {
  if (!pode(ctx, "compras.ver")) throw new SemPermissao("ver compras");
  return db.agendaDeRodada.findMany({
    where: { organizacaoId: ctx.organizacao.id },
    orderBy: { nome: "asc" },
  });
}

/**
 * Abre as rodadas cuja hora chegou nesta semana. Roda no relógio, sem
 * ninguém logado; devolve quantas abriu.
 *
 * A rodada já nasce COLETANDO: é para isso que a agenda existe — a loja abre
 * o sistema na segunda de manhã e a lista da semana está esperando.
 */
export async function abrirRodadasAgendadas(agora: Date): Promise<number> {
  const agendas = await db.agendaDeRodada.findMany({ where: { ativa: true } });
  if (agendas.length === 0) return 0;

  const fusos = new Map(
    (
      await db.organizacao.findMany({
        where: {
          id: { in: [...new Set(agendas.map((a) => a.organizacaoId))] },
        },
        select: { id: true, fusoHorario: true, ativa: true },
      })
    ).map((o) => [o.id, o]),
  );

  let abertas = 0;

  for (const agenda of agendas) {
    const org = fusos.get(agenda.organizacaoId);
    if (!org?.ativa || agenda.unidadeIds.length === 0) continue;

    const abertura = aberturaDaSemana(agenda, agora, org.fusoHorario);
    if (agora < abertura) continue;

    const ocorrencia = ocorrenciaDaSemana(agora, org.fusoHorario);
    const semana = ocorrencia.split("-W")[1];

    // O relógio bate a cada minuto e a semana tem dez mil minutos: sem esta
    // consulta, cada batida depois da abertura esbarraria na unicidade e
    // deixaria um erro no log. A consulta evita o barulho; quem GARANTE a
    // rodada única continua sendo o banco, logo abaixo.
    const jaAberta = await db.rodadaDeCompra.findUnique({
      where: { agendaId_ocorrencia: { agendaId: agenda.id, ocorrencia } },
      select: { id: true },
    });
    if (jaAberta) continue;

    try {
      await db.$transaction(async (tx) => {
        const rodada = await tx.rodadaDeCompra.create({
          data: {
            organizacaoId: agenda.organizacaoId,
            descricao: `${agenda.nome} · semana ${semana}`,
            estado: "COLETANDO",
            agendaId: agenda.id,
            ocorrencia,
            prazoRequisicao: new Date(
              abertura.getTime() + agenda.horasParaRequisicao * HORA_MS,
            ),
            prazoCotacao: new Date(
              abertura.getTime() + agenda.horasParaCotacao * HORA_MS,
            ),
            entregaDe: new Date(
              abertura.getTime() + agenda.entregaDeDias * DIA_MS,
            ),
            entregaAte: new Date(
              abertura.getTime() + agenda.entregaAteDias * DIA_MS,
            ),
            responsavelId: agenda.responsavelId,
          },
          select: { id: true },
        });
        await tx.requisicao.createMany({
          data: agenda.unidadeIds.map((unidadeId) => ({
            organizacaoId: agenda.organizacaoId,
            rodadaId: rodada.id,
            unidadeId,
          })),
        });
        await registrar(tx, null, {
          organizacaoId: agenda.organizacaoId,
          entidade: "RodadaDeCompra",
          entidadeId: rodada.id,
          acao: "CRIOU",
          depois: {
            agenda: agenda.nome,
            ocorrencia,
            versaoDaAgenda: agenda.versao,
          },
        });
      });
      abertas++;
    } catch (erro) {
      // A rodada desta semana já existe: era a outra cópia do relógio, ou uma
      // batida anterior. É o resultado esperado, não uma falha.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === "P2002"
      ) {
        continue;
      }
      throw erro;
    }
  }

  return abertas;
}
