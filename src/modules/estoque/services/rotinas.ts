import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  proximaCobranca,
  statusDaRotina,
  type Agenda,
  type StatusRotina,
} from "../schemas/agenda";

import { criarContagem, exigirUnidade } from "./contagens";

/**
 * AS ROTINAS DE CONTAGEM.
 *
 * A rotina é o que transforma contagem em hábito: "a praça se conta todo dia
 * às 7h, o inventário completo é dia 1º". A tela mostra o que está atrasado
 * sem ninguém precisar lembrar — e é essa cobrança silenciosa que faz o CMV
 * sair toda semana em vez de "quando der".
 */

export type RotinaComStatus = {
  id: string;
  nome: string;
  recorrencia: "DIARIA" | "SEMANAL" | "MENSAL";
  diaDaSemana: number | null;
  diaDoMes: number | null;
  horario: string | null;
  local: { id: string; nome: string } | null;
  categorias: string[];
  ultimaFechadaEm: Date | null;
  proxima: Date;
  status: StatusRotina;
  contagemAbertaId: string | null;
};

export async function listarRotinas(
  contexto: ContextoSessao,
): Promise<RotinaComStatus[]> {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  const rotinas = await db.rotinaDeContagem.findMany({
    where: { unidadeId: unidade.id, ativo: true },
    include: {
      local: { select: { id: true, nome: true } },
      contagens: {
        // A última fechada dá o status; uma aberta vira o atalho "continuar".
        where: { canceladaEm: null },
        orderBy: { referencia: "desc" },
        take: 5,
        select: { id: true, status: true, referencia: true },
      },
    },
    orderBy: { nome: "asc" },
  });

  const hoje = new Date();

  return rotinas.map((r) => {
    const agenda: Agenda = {
      recorrencia: r.recorrencia,
      diaDaSemana: r.diaDaSemana,
      diaDoMes: r.diaDoMes,
    };

    const ultimaFechada =
      r.contagens.find((c) => c.status === "FECHADA")?.referencia ?? null;
    const aberta = r.contagens.find((c) => c.status === "ABERTA");

    return {
      id: r.id,
      nome: r.nome,
      recorrencia: r.recorrencia,
      diaDaSemana: r.diaDaSemana,
      diaDoMes: r.diaDoMes,
      horario: r.horario,
      local: r.local,
      categorias: r.categorias,
      ultimaFechadaEm: ultimaFechada,
      proxima: proximaCobranca(agenda, ultimaFechada, hoje),
      status: statusDaRotina(agenda, ultimaFechada, hoje),
      contagemAbertaId: aberta?.id ?? null,
    };
  });
}

export async function criarRotina(
  contexto: ContextoSessao,
  dados: {
    nome: string;
    recorrencia: "DIARIA" | "SEMANAL" | "MENSAL";
    diaDaSemana: number | null;
    diaDoMes: number | null;
    horario: string | null;
    localId: string | null;
    categorias: string[];
  },
) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("criar rotinas de contagem");
  }
  const unidade = exigirUnidade(contexto);

  return db.rotinaDeContagem.create({
    data: {
      unidadeId: unidade.id,
      nome: dados.nome,
      recorrencia: dados.recorrencia,
      diaDaSemana: dados.recorrencia === "SEMANAL" ? dados.diaDaSemana : null,
      diaDoMes: dados.recorrencia === "MENSAL" ? dados.diaDoMes : null,
      horario: dados.horario,
      localId: dados.localId,
      categorias: dados.categorias,
    },
  });
}

/**
 * "Contar agora": abre a contagem desta rotina.
 *
 * Se já existe uma aberta, devolve ela — apertar o botão duas vezes não pode
 * criar duas folhas pela metade.
 */
export async function executarRotina(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("abrir contagens");
  }
  const unidade = exigirUnidade(contexto);

  const rotina = await db.rotinaDeContagem.findFirst({
    where: { id, unidadeId: unidade.id, ativo: true },
    include: {
      contagens: {
        where: { status: "ABERTA", canceladaEm: null },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!rotina) throw new Error("Rotina não encontrada.");

  if (rotina.contagens[0]) return { id: rotina.contagens[0].id };

  return criarContagem(contexto, {
    referencia: new Date(),
    descricao: rotina.nome,
    categorias: rotina.categorias,
    localId: rotina.localId,
    rotinaId: rotina.id,
  });
}

export async function desativarRotina(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("alterar rotinas de contagem");
  }
  const unidade = exigirUnidade(contexto);

  const rotina = await db.rotinaDeContagem.findFirst({
    where: { id, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!rotina) throw new Error("Rotina não encontrada.");

  await db.rotinaDeContagem.update({
    where: { id },
    data: { ativo: false },
  });
}

/** Os lugares da unidade — para o formulário de rotina e de contagem. */
export async function listarLocais(contexto: ContextoSessao) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  return db.localEstoque.findMany({
    where: { unidadeId: unidade.id, ativo: true },
    select: { id: true, nome: true },
    orderBy: { ordem: "asc" },
  });
}
