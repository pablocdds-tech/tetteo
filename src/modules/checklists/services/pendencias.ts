import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { registrar } from "./auditoria";
import { exigirUnidade } from "./rotinas";

/**
 * AS PENDÊNCIAS — o que sobrou para consertar.
 *
 * É a razão de o módulo existir. Marcar "não conforme" e seguir a vida
 * transforma o checklist em ritual: todo dia se anota que a coifa está suja e
 * todo dia ela continua suja. A pendência tem dono, prazo e só sai da tela
 * quando alguém escreve o que fez.
 *
 * Fechar uma pendência EXIGE texto. "Resolvido" com um clique seco não deixa
 * nada para conferir depois, e três meses adiante ninguém sabe se a coifa foi
 * limpa ou se alguém só quis limpar a tela.
 */

export type PendenciaNaLista = {
  id: string;
  descricao: string;
  status: "ABERTA" | "RESOLVIDA" | "CANCELADA";
  prazo: Date | null;
  atrasada: boolean;
  responsavel: { id: string; nome: string } | null;
  origem: { respostaId: string; modelo: string; referencia: Date } | null;
  resolucao: string | null;
  resolvidaEm: Date | null;
  criadoEm: Date;
};

function soData(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function listarPendencias(
  contexto: ContextoSessao,
  filtros: { incluirResolvidas?: boolean } = {},
): Promise<PendenciaNaLista[]> {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver as pendências");
  }
  const unidade = exigirUnidade(contexto);

  const linhas = await db.pendencia.findMany({
    where: {
      unidadeId: unidade.id,
      status: filtros.incluirResolvidas
        ? { not: "CANCELADA" }
        : { equals: "ABERTA" },
    },
    include: {
      resposta: {
        select: {
          id: true,
          referencia: true,
          modelo: { select: { nome: true } },
        },
      },
    },
    orderBy: { criadoEm: "desc" },
    take: 200,
  });

  const responsaveis = await db.usuario.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            linhas
              .map((l) => l.responsavelId)
              .filter((id): id is string => !!id),
          ),
        ],
      },
    },
    select: { id: true, nome: true },
  });
  const porId = new Map(responsaveis.map((u) => [u.id, u]));

  const hoje = soData(new Date());

  const lista = linhas.map((l) => ({
    id: l.id,
    descricao: l.descricao,
    status: l.status,
    prazo: l.prazo,
    atrasada:
      l.status === "ABERTA" && l.prazo !== null && soData(l.prazo) < hoje,
    responsavel: l.responsavelId ? (porId.get(l.responsavelId) ?? null) : null,
    origem: l.resposta
      ? {
          respostaId: l.resposta.id,
          modelo: l.resposta.modelo.nome,
          referencia: l.resposta.referencia,
        }
      : null,
    resolucao: l.resolucao,
    resolvidaEm: l.resolvidaEm,
    criadoEm: l.criadoEm,
  }));

  /**
   * A ordem é a fila de trabalho do gerente, não a cronologia:
   *
   *   1. atrasada         o prazo passou
   *   2. sem responsável  ninguém assumiu — é o estado que mais apodrece
   *   3. com prazo        as próximas a vencer
   *   4. sem prazo        o resto
   *   5. resolvida        histórico, no fim
   *
   * A pendência sem dono vem antes da com prazo de propósito: uma tarefa com
   * prazo e dono está andando; uma sem dono não está com ninguém, e é a que
   * some da vista até virar problema de novo no checklist de amanhã.
   */
  const peso = (p: PendenciaNaLista) => {
    if (p.status !== "ABERTA") return 4;
    if (p.atrasada) return 0;
    if (!p.responsavel) return 1;
    if (p.prazo) return 2;
    return 3;
  };

  return lista.sort((a, b) => {
    const diferenca = peso(a) - peso(b);
    if (diferenca !== 0) return diferenca;
    if (a.prazo && b.prazo) return a.prazo.getTime() - b.prazo.getTime();
    return b.criadoEm.getTime() - a.criadoEm.getTime();
  });
}

export async function contarPendenciasAbertas(contexto: ContextoSessao) {
  if (!pode(contexto, "checklists.ver")) return 0;
  if (!contexto.unidadeAtiva) return 0;

  return db.pendencia.count({
    where: { unidadeId: contexto.unidadeAtiva.id, status: "ABERTA" },
  });
}

export async function criarPendencia(
  contexto: ContextoSessao,
  dados: {
    descricao: string;
    responsavelId: string | null;
    prazo: Date | null;
  },
) {
  if (!pode(contexto, "checklists.responder")) {
    throw new SemPermissao("abrir pendências");
  }
  const unidade = exigirUnidade(contexto);

  const pendencia = await db.pendencia.create({
    data: {
      unidadeId: unidade.id,
      descricao: dados.descricao,
      responsavelId: dados.responsavelId,
      prazo: dados.prazo,
      criadaPorId: contexto.usuario.id,
    },
  });

  await registrar(contexto, "Pendencia", "CRIOU", pendencia.id, null, {
    descricao: dados.descricao,
  });

  return pendencia;
}

/** Atribui (ou reatribui) o dono e o prazo. */
export async function atribuirPendencia(
  contexto: ContextoSessao,
  id: string,
  dados: { responsavelId: string | null; prazo: Date | null },
) {
  if (!pode(contexto, "checklists.resolver")) {
    throw new SemPermissao("atribuir pendências");
  }
  const unidade = exigirUnidade(contexto);

  const antes = await db.pendencia.findFirst({
    where: { id, unidadeId: unidade.id, status: "ABERTA" },
    select: { responsavelId: true, prazo: true },
  });
  if (!antes) throw new Error("Pendência não encontrada ou já resolvida.");

  await db.pendencia.update({ where: { id }, data: dados });

  await registrar(contexto, "Pendencia", "ALTEROU", id, antes, dados);
}

export async function resolverPendencia(
  contexto: ContextoSessao,
  id: string,
  resolucao: string,
) {
  if (!pode(contexto, "checklists.resolver")) {
    throw new SemPermissao("resolver pendências");
  }
  const unidade = exigirUnidade(contexto);

  const pendencia = await db.pendencia.findFirst({
    where: { id, unidadeId: unidade.id, status: "ABERTA" },
    select: { id: true, descricao: true },
  });
  if (!pendencia) throw new Error("Pendência não encontrada ou já resolvida.");

  await db.pendencia.update({
    where: { id },
    data: {
      status: "RESOLVIDA",
      resolucao,
      resolvidaEm: new Date(),
      resolvidaPorId: contexto.usuario.id,
    },
  });

  await registrar(
    contexto,
    "Pendencia",
    "ALTEROU",
    id,
    { status: "ABERTA" },
    { status: "RESOLVIDA", resolucao },
  );
}

/**
 * Reabre uma pendência dada como resolvida.
 *
 * Existe porque a conferência é depois: o gerente lê "coifa limpa", vai olhar
 * e a coifa está suja. Sem reabrir, o jeito de registrar isso seria criar uma
 * pendência nova — e a segunda tentativa perderia o vínculo com a primeira.
 */
export async function reabrirPendencia(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.resolver")) {
    throw new SemPermissao("reabrir pendências");
  }
  const unidade = exigirUnidade(contexto);

  const pendencia = await db.pendencia.findFirst({
    where: { id, unidadeId: unidade.id, status: "RESOLVIDA" },
    select: { id: true, resolucao: true },
  });
  if (!pendencia) throw new Error("Pendência não encontrada.");

  // A resolução recusada sai da linha mas não se perde: o `antes` da auditoria
  // guarda o que foi alegado, e é lá que se confere quem disse o quê.
  await db.pendencia.update({
    where: { id },
    data: {
      status: "ABERTA",
      resolucao: null,
      resolvidaEm: null,
      resolvidaPorId: null,
    },
  });

  await registrar(
    contexto,
    "Pendencia",
    "ALTEROU",
    id,
    { status: "RESOLVIDA", resolucao: pendencia.resolucao },
    { status: "ABERTA" },
  );
}
