import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import {
  proximaCobranca,
  statusDaRotina,
  type Agenda,
  type StatusRotina,
} from "@/lib/agenda";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { DadosRotinaChecklist } from "../schemas/modelo";

/**
 * AS ROTINAS — quando e de quem cobrar.
 *
 * A agenda é a mesma do Estoque, palavra por palavra: mora em `lib/agenda` e
 * é usada pelos dois. "Abertura todo dia às 7h" e "contagem da praça todo dia
 * às 7h" são o mesmo problema, e duas cópias da mesma regra de atraso é uma
 * cópia esperando para divergir.
 */

/**
 * Checklist é presencial. "A rede" não abre a loja às 7h — quem abre é uma
 * pessoa, num endereço.
 */
export function exigirUnidade(contexto: ContextoSessao) {
  if (!contexto.unidadeAtiva) throw new ExigeUnidade();
  return contexto.unidadeAtiva;
}

export type RotinaDoDia = {
  id: string;
  modeloId: string;
  nome: string;
  descricao: string | null;
  totalItens: number;
  recorrencia: "DIARIA" | "SEMANAL" | "MENSAL";
  diaDaSemana: number | null;
  diaDoMes: number | null;
  horario: string | null;
  responsavel: { id: string; nome: string } | null;
  ultimaFechadaEm: Date | null;
  ultimaPontuacao: number | null;
  proxima: Date;
  status: StatusRotina;
  respostaAbertaId: string | null;
};

/**
 * A TELA DO DIA.
 *
 * A ordem é por urgência, não alfabética: atrasado em cima. Quem chega às 7h
 * lê de cima para baixo e sabe o que fazer sem perguntar a ninguém — é essa
 * cobrança silenciosa que faz o checklist virar hábito em vez de campanha.
 */
export async function listarDoDia(
  contexto: ContextoSessao,
): Promise<RotinaDoDia[]> {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver os checklists");
  }
  const unidade = exigirUnidade(contexto);

  const rotinas = await db.rotinaDeChecklist.findMany({
    where: {
      unidadeId: unidade.id,
      ativo: true,
      modelo: { ativo: true, excluidoEm: null },
    },
    include: {
      modelo: {
        select: {
          id: true,
          nome: true,
          descricao: true,
          _count: { select: { itens: true } },
        },
      },
      respostas: {
        // A última fechada dá o status; uma aberta vira o atalho "continuar".
        where: { canceladaEm: null },
        orderBy: { referencia: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          referencia: true,
          pontuacao: true,
        },
      },
    },
  });

  const responsaveis = await nomesDeUsuarios(
    rotinas.map((r) => r.responsavelId).filter((id): id is string => !!id),
  );

  const hoje = new Date();

  const lista = rotinas.map((r) => {
    const agenda: Agenda = {
      recorrencia: r.recorrencia,
      diaDaSemana: r.diaDaSemana,
      diaDoMes: r.diaDoMes,
    };

    const fechada = r.respostas.find((x) => x.status === "FECHADA");
    const aberta = r.respostas.find((x) => x.status === "ABERTA");
    const ultimaFechadaEm = fechada?.referencia ?? null;

    return {
      id: r.id,
      modeloId: r.modelo.id,
      nome: r.modelo.nome,
      descricao: r.modelo.descricao,
      totalItens: r.modelo._count.itens,
      recorrencia: r.recorrencia,
      diaDaSemana: r.diaDaSemana,
      diaDoMes: r.diaDoMes,
      horario: r.horario,
      responsavel: r.responsavelId
        ? (responsaveis.get(r.responsavelId) ?? null)
        : null,
      ultimaFechadaEm,
      ultimaPontuacao:
        fechada?.pontuacao != null ? Number(fechada.pontuacao) : null,
      proxima: proximaCobranca(agenda, ultimaFechadaEm, hoje),
      status: statusDaRotina(agenda, ultimaFechadaEm, hoje),
      respostaAbertaId: aberta?.id ?? null,
    };
  });

  const peso = { atrasada: 0, aguardando: 1, feita: 2 };
  return lista.sort((a, b) => {
    const diferenca = peso[a.status] - peso[b.status];
    if (diferenca !== 0) return diferenca;
    // Dentro do mesmo status, a ordem é a do relógio: quem abre às 7h aparece
    // antes de quem fecha às 23h.
    return (a.horario ?? "99:99").localeCompare(b.horario ?? "99:99");
  });
}

async function nomesDeUsuarios(ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; nome: string }>();

  const usuarios = await db.usuario.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, nome: true },
  });

  return new Map(usuarios.map((u) => [u.id, u]));
}

/**
 * Quem pode ser responsável nesta loja.
 *
 * Vem dos acessos, não da tabela de usuários: quem não entra na loja não pode
 * ser cobrado por ela. Acesso de rede entra também — o dono responde por todas.
 */
export async function listarResponsaveis(contexto: ContextoSessao) {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver os checklists");
  }
  const unidade = exigirUnidade(contexto);

  const acessos = await db.acesso.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      status: "ATIVO",
      excluidoEm: null,
      OR: [{ unidadeId: unidade.id }, { unidadeId: null }],
    },
    select: { usuario: { select: { id: true, nome: true } } },
  });

  const unicos = new Map(acessos.map((a) => [a.usuario.id, a.usuario]));
  return [...unicos.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Os modelos que ainda não têm rotina nesta loja — para o formulário. */
export async function modelosSemRotina(contexto: ContextoSessao) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("criar rotinas de checklist");
  }
  const unidade = exigirUnidade(contexto);

  return db.modeloDeChecklist.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
      ativo: true,
      rotinas: { none: { unidadeId: unidade.id } },
    },
    select: { id: true, nome: true, _count: { select: { itens: true } } },
    orderBy: { nome: "asc" },
  });
}

export async function criarRotina(
  contexto: ContextoSessao,
  dados: DadosRotinaChecklist,
) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("criar rotinas de checklist");
  }
  const unidade = exigirUnidade(contexto);

  // O modelo precisa ser desta rede — sem isto, um id colado à mão agendaria
  // o checklist de outra empresa.
  const modelo = await db.modeloDeChecklist.findFirst({
    where: {
      id: dados.modeloId,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    select: { id: true, _count: { select: { itens: true } } },
  });
  if (!modelo) throw new Error("Checklist não encontrado.");
  if (modelo._count.itens === 0) {
    throw new Error(
      "Este checklist ainda não tem nenhum item. Escreva as perguntas antes de agendar.",
    );
  }

  return db.rotinaDeChecklist.create({
    data: {
      unidadeId: unidade.id,
      modeloId: dados.modeloId,
      recorrencia: dados.recorrencia,
      diaDaSemana: dados.recorrencia === "SEMANAL" ? dados.diaDaSemana : null,
      diaDoMes: dados.recorrencia === "MENSAL" ? dados.diaDoMes : null,
      horario: dados.horario ?? null,
      responsavelId: dados.responsavelId,
    },
  });
}

export async function desativarRotina(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar rotinas de checklist");
  }
  const unidade = exigirUnidade(contexto);

  const rotina = await db.rotinaDeChecklist.findFirst({
    where: { id, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!rotina) throw new Error("Rotina não encontrada.");

  await db.rotinaDeChecklist.update({
    where: { id },
    data: { ativo: false },
  });
}
