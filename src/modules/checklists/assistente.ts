import type { AvisoDoModulo, FatoDoModulo } from "@/core/registry/tipos";
import { db } from "@/server/db";

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
 * Hoje, um fato só: o FECHAMENTO da loja foi concluído, e está pronto para o
 * gerente revisar. Nada aqui envia coisa alguma — vira rascunho, e uma pessoa
 * decide.
 */
export const assistenteDosChecklists = {
  modulo: "checklists",

  /** Lembretes de rotina ainda moram na tela do Checklists. */
  async avisos(): Promise<AvisoDoModulo[]> {
    return [];
  },

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

    const fechamentos = respostas.filter(
      (r) => r.fechadaEm !== null && ehModeloDeFechamento(r.modelo.nome),
    );
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
      return [
        {
          chave: `checklists:fechamento:${r.id}`,
          tipo: "checklists.fechamento",
          referenciaId: r.id,
          unidadeId: r.unidadeId,
          titulo: "Fechamento pronto para revisão",
          linhas: linhasDoFechamento({
            loja: unidade.nome,
            modelo: r.modelo.nome,
            fechadaEm: r.fechadaEm,
            fuso: unidade.fusoHorario,
            quem: pessoas.find((p) => p.id === r.fechadaPorId)?.nome ?? null,
            pontuacao: r.pontuacao === null ? null : Number(r.pontuacao),
            naoConformes: r.itensNaoConformes,
          }),
          caminho: `/checklists/${r.id}`,
          ocorridoEm: r.fechadaEm,
          permissaoNecessaria: "checklists.ver",
        },
      ];
    });
  },
};
