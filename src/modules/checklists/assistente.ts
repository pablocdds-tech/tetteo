import type { AvisoDoModulo, FatoDoModulo } from "@/core/registry/tipos";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

import {
  avisoDaRotina,
  avisoDeConclusao,
  avisoDePendencia,
  avisoDePrazo,
} from "./schemas/avisos";
import {
  ehModeloDeFechamento,
  linhasDoFechamento,
} from "./schemas/fato-de-fechamento";

/**
 * O QUE O CHECKLISTS CONTA À SEVERINA.
 *
 * A Severina não sabe o que é uma resposta de checklist, e não pode saber —
 * um App nunca importa de outro. Ela pergunta "o que aconteceu?" e este
 * arquivo responde, no vocabulário do Core (`FatoDoModulo`).
 *
 * Cobranças e conclusões entram nos agentes já configurados; conclusões
 * também viram rascunhos para o fluxo de envio confirmado.
 * Este módulo não ativa canais, não escolhe telefone e não envia mensagens.
 */
export async function listarAvisosDosChecklists(
  contexto: ContextoSessao,
  agora: Date,
): Promise<AvisoDoModulo[]> {
  if (!contexto.unidadeAtiva || !pode(contexto, "checklists.ver")) return [];
  const unidade = await db.unidade.findFirst({
    where: {
      id: contexto.unidadeAtiva.id,
      organizacaoId: contexto.organizacao.id,
      ativa: true,
      excluidoEm: null,
    },
    select: { id: true, fusoHorario: true },
  });
  if (!unidade) return [];

  const gestor = pode(contexto, "checklists.editar");
  const dono = gestor
    ? {}
    : { OR: [{ responsavelId: contexto.usuario.id }, { responsavelId: null }] };
  const [rotinas, respostas, pendencias, conferencias, conclusoes] =
    await Promise.all([
      db.rotinaDeChecklist.findMany({
        where: {
          unidadeId: unidade.id,
          ativo: true,
          modelo: {
            organizacaoId: contexto.organizacao.id,
            ativo: true,
            excluidoEm: null,
          },
          ...dono,
        },
        select: {
          id: true,
          recorrencia: true,
          diaDaSemana: true,
          diaDoMes: true,
          horario: true,
          modelo: { select: { nome: true } },
          respostas: {
            where: { status: "FECHADA", canceladaEm: null },
            orderBy: { referencia: "desc" },
            take: 1,
            select: { referencia: true },
          },
        },
        orderBy: { criadoEm: "asc" },
        take: 100,
      }),
      db.respostaDeChecklist.findMany({
        where: {
          unidadeId: unidade.id,
          status: "ABERTA",
          canceladaEm: null,
          prazoEm: { lt: agora },
          modelo: { organizacaoId: contexto.organizacao.id },
          ...dono,
        },
        select: { id: true, prazoEm: true, modelo: { select: { nome: true } } },
        orderBy: { prazoEm: "asc" },
        take: 100,
      }),
      db.pendencia.findMany({
        where: {
          unidadeId: unidade.id,
          status: "ABERTA",
          // Sem dono, a pendência cabe ao gestor; a equipe recebe as suas.
          ...(gestor ? {} : { responsavelId: contexto.usuario.id }),
        },
        select: { id: true, descricao: true, prazo: true },
        orderBy: { criadoEm: "asc" },
        take: 100,
      }),
      gestor
        ? db.respostaDeChecklist.findMany({
            where: {
              unidadeId: unidade.id,
              status: "FECHADA",
              canceladaEm: null,
              modelo: { organizacaoId: contexto.organizacao.id },
              itens: {
                some: {
                  analisarIA: true,
                  naoSeAplica: false,
                  resultadoIA: {
                    in: [
                      "NAO_SOLICITADA",
                      "PENDENTE",
                      "REPROVADO",
                      "INCONCLUSIVO",
                      "INDISPONIVEL",
                    ],
                  },
                },
              },
            },
            select: { id: true, modelo: { select: { nome: true } } },
            orderBy: { fechadaEm: "desc" },
            take: 100,
          })
        : Promise.resolve([]),
      db.respostaDeChecklist.findMany({
        where: {
          unidadeId: unidade.id,
          status: "FECHADA",
          canceladaEm: null,
          modelo: { organizacaoId: contexto.organizacao.id },
          fechadaEm: {
            gte: new Date(agora.getTime() - 24 * 60 * 60_000),
            lte: agora,
          },
          ...(gestor ? {} : { fechadaPorId: contexto.usuario.id }),
        },
        select: {
          id: true,
          fechadaEm: true,
          itensNaoConformes: true,
          modelo: { select: { nome: true } },
        },
        orderBy: { fechadaEm: "desc" },
        take: 100,
      }),
    ]);

  const avisos: AvisoDoModulo[] = [];
  for (const r of conclusoes) {
    if (!r.fechadaEm) continue;
    const aviso = avisoDeConclusao(
      {
        id: r.id,
        nome: r.modelo.nome,
        fechadaEm: r.fechadaEm,
        itensNaoConformes: r.itensNaoConformes,
      },
      agora,
    );
    if (aviso) avisos.push(aviso);
  }
  for (const r of respostas) {
    if (!r.prazoEm) continue;
    const aviso = avisoDePrazo(
      { id: r.id, nome: r.modelo.nome, prazoEm: r.prazoEm },
      agora,
    );
    if (aviso) avisos.push(aviso);
  }
  for (const r of rotinas) {
    const aviso = avisoDaRotina(
      {
        ...r,
        nome: r.modelo.nome,
        ultimaFechada: r.respostas[0]?.referencia ?? null,
      },
      agora,
      unidade.fusoHorario,
    );
    if (aviso) avisos.push(aviso);
  }
  avisos.push(
    ...pendencias.map((p) => avisoDePendencia(p, agora, unidade.fusoHorario)),
  );
  avisos.push(
    ...conferencias.map((r) => ({
      chave: `checklists:conferencia:${r.id}:revisar`,
      assunto: `O checklist "${r.modelo.nome}" foi preenchido e tem conferência de IA pendente ou resultado que precisa de revisão do gestor.`,
      referenciaTipo: "resposta_de_checklist",
      referenciaId: r.id,
    })),
  );
  return avisos.slice(0, 30);
}

export const assistenteDosChecklists = {
  modulo: "checklists",

  avisos: listarAvisosDosChecklists,

  async eventos(
    escopo: { organizacaoId: string; unidadeIds: string[] },
    desde: Date,
  ): Promise<FatoDoModulo[]> {
    if (escopo.unidadeIds.length === 0) return [];

    const respostas = await db.respostaDeChecklist.findMany({
      where: {
        unidadeId: { in: escopo.unidadeIds },
        status: "FECHADA",
        fechadaEm: { gte: desde },
        modelo: { organizacaoId: escopo.organizacaoId },
      },
      select: {
        id: true,
        unidadeId: true,
        fechadaEm: true,
        fechadaPorId: true,
        pontuacao: true,
        itensNaoConformes: true,
        modelo: { select: { nome: true } },
      },
      orderBy: { fechadaEm: "asc" },
    });

    const fechamentos = respostas.filter((r) => r.fechadaEm !== null);
    if (fechamentos.length === 0) return [];

    const [unidades, pessoas] = await Promise.all([
      db.unidade.findMany({
        where: {
          id: { in: [...new Set(fechamentos.map((r) => r.unidadeId))] },
        },
        select: { id: true, nome: true, fusoHorario: true },
      }),
      db.usuario.findMany({
        where: {
          id: {
            in: fechamentos
              .map((r) => r.fechadaPorId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        select: { id: true, nome: true },
      }),
    ]);

    return fechamentos.flatMap((r) => {
      const unidade = unidades.find((u) => u.id === r.unidadeId);
      if (!unidade || !r.fechadaEm) return [];
      const fechamento = ehModeloDeFechamento(r.modelo.nome);
      return [
        {
          chave: `checklists:${fechamento ? "fechamento" : "conclusao"}:${r.id}`,
          tipo: fechamento ? "checklists.fechamento" : "checklists.conclusao",
          referenciaId: r.id,
          unidadeId: r.unidadeId,
          titulo: fechamento
            ? "Fechamento pronto para revisão"
            : "Checklist preenchido",
          linhas: [
            ...linhasDoFechamento({
              loja: unidade.nome,
              modelo: r.modelo.nome,
              fechadaEm: r.fechadaEm,
              fuso: unidade.fusoHorario,
              quem: pessoas.find((p) => p.id === r.fechadaPorId)?.nome ?? null,
              pontuacao: r.pontuacao === null ? null : Number(r.pontuacao),
              naoConformes: r.itensNaoConformes,
            }),
            "Preenchimento concluído. A conferência das evidências é uma etapa separada.",
          ],
          caminho: `/checklists/${r.id}`,
          ocorridoEm: r.fechadaEm,
          permissaoNecessaria: "checklists.ver",
        },
      ];
    });
  },
};
