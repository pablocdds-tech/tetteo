import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import {
  prazoAtual,
  proximaCobranca,
  statusDaRotina,
  type Agenda,
  type StatusRotina,
} from "@/lib/agenda";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { DadosRotinaChecklist } from "../schemas/modelo";

import { registrar } from "./auditoria";

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
  /** A ocorrência vigente — a que está sendo cobrada agora. */
  prazo: Date;
  status: StatusRotina;
  respostaAbertaId: string | null;
  /** Quantos itens da folha aberta já foram respondidos. */
  respondidos: number;
};

/**
 * O RECORTE DE TEMPO da lista.
 *
 *   hoje    o que precisa de alguém agora: atrasado, vencendo hoje, e o que
 *           já foi feito hoje — para a pessoa ver o próprio trabalho.
 *   semana  o mesmo, mais o que vence nos próximos sete dias.
 *
 * São dois CONJUNTOS DE DADOS diferentes, não dois jeitos de olhar o mesmo.
 * Por isso o período mora no endereço da página e não na memória do
 * navegador: o botão Voltar funciona, e o link colado no grupo do WhatsApp
 * abre a mesma tela que a pessoa estava vendo.
 */
export type Periodo = "hoje" | "semana";

export function ehPeriodo(valor: string | undefined): valor is Periodo {
  return valor === "hoje" || valor === "semana";
}

/** A data sem o horário — meia-noite local. */
function soData(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * A LISTA DE ROTINAS — a coluna da esquerda.
 *
 * A ordem é por urgência, não alfabética: atrasado em cima. Quem chega às 7h
 * lê de cima para baixo e sabe o que fazer sem perguntar a ninguém — é essa
 * cobrança silenciosa que faz o checklist virar hábito em vez de campanha.
 *
 * O período recorta o CONJUNTO, e é por isso que ele é argumento desta função
 * e não um filtro na tela: "semana" busca rotinas que "hoje" nem trouxe.
 */
export async function listarRotinas(
  contexto: ContextoSessao,
  periodo: Periodo = "hoje",
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
          // Quantos itens já foram respondidos: é o "3 de 12" da lista, e o
          // que permite ver o progresso sem abrir a folha.
          _count: {
            select: { itens: { where: { respondidoEm: { not: null } } } },
          },
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
      prazo: prazoAtual(agenda, hoje),
      status: statusDaRotina(agenda, ultimaFechadaEm, hoje),
      respostaAbertaId: aberta?.id ?? null,
      respondidos: aberta?._count.itens ?? 0,
    };
  });

  // O RECORTE.
  //
  // "Hoje" não é "o que vence hoje": é o que precisa de alguém hoje. Uma
  // rotina atrasada de terça continua sendo trabalho de hoje, e some da tela
  // exatamente quando for feita — não quando a terça acabar.
  //
  // O que já foi feito hoje FICA na lista, apagado no rodapé. Sumir com o
  // trabalho concluído é o jeito mais rápido de a pessoa achar que perdeu o
  // que fez, e refazer.
  const inicioDeHoje = soData(hoje);
  const daquiASeteDias = new Date(inicioDeHoje);
  daquiASeteDias.setDate(daquiASeteDias.getDate() + 7);

  const noPeriodo = lista.filter((r) => {
    const feitaHoje =
      r.ultimaFechadaEm !== null &&
      soData(r.ultimaFechadaEm).getTime() === inicioDeHoje.getTime();

    if (r.status !== "feita" || feitaHoje) return true;
    return periodo === "semana" && r.proxima < daquiASeteDias;
  });

  const peso = { atrasada: 0, aguardando: 1, feita: 2 };
  return noPeriodo.sort((a, b) => {
    const diferenca = peso[a.status] - peso[b.status];
    if (diferenca !== 0) return diferenca;
    // Entre duas que ainda não foram feitas, a mais antiga primeiro: um
    // atraso de três dias cobra mais do que o de ontem.
    if (a.status !== "feita" && a.prazo.getTime() !== b.prazo.getTime()) {
      return a.prazo.getTime() - b.prazo.getTime();
    }
    // Dentro do mesmo status, a ordem é a do relógio: quem abre às 7h aparece
    // antes de quem fecha às 23h.
    return (a.horario ?? "99:99").localeCompare(b.horario ?? "99:99");
  });
}

export async function nomesDeUsuarios(ids: string[]) {
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

/**
 * Os modelos que não são cobrados nesta loja — para o formulário.
 *
 * Conta só as rotinas ATIVAS: um checklist cuja rotina foi removida volta a
 * aparecer aqui, e agendá-lo de novo reativa a mesma rotina (`criarRotina`).
 */
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
      rotinas: { none: { unidadeId: unidade.id, ativo: true } },
    },
    select: { id: true, nome: true, _count: { select: { itens: true } } },
    orderBy: { nome: "asc" },
  });
}

export class RotinaJaAgendada extends Error {
  constructor() {
    super("Este checklist já está agendado nesta loja.");
  }
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

  const agenda = {
    recorrencia: dados.recorrencia,
    diaDaSemana: dados.recorrencia === "SEMANAL" ? dados.diaDaSemana : null,
    diaDoMes: dados.recorrencia === "MENSAL" ? dados.diaDoMes : null,
    horario: dados.horario ?? null,
    responsavelId: dados.responsavelId,
  };

  // AGENDAR DE NOVO O QUE FOI REMOVIDO reativa a rotina antiga em vez de
  // criar outra. "Remover" só desliga (`ativo = false`), e a regra de uma
  // rotina por checklist por loja continua valendo — é ela que mantém o
  // histórico de conclusão num lugar só. Uma rotina nova começaria do zero, e
  // "a abertura deu 71% em agosto" sumiria da tela sem ter sumido do banco.
  const existente = await db.rotinaDeChecklist.findUnique({
    where: {
      unidadeId_modeloId: { unidadeId: unidade.id, modeloId: dados.modeloId },
    },
    select: {
      id: true,
      ativo: true,
      recorrencia: true,
      diaDaSemana: true,
      diaDoMes: true,
      horario: true,
      responsavelId: true,
    },
  });

  if (existente?.ativo) throw new RotinaJaAgendada();

  if (existente) {
    const { id, ...antes } = existente;
    const rotina = await db.rotinaDeChecklist.update({
      where: { id },
      data: { ...agenda, ativo: true },
    });
    await registrar(contexto, "RotinaDeChecklist", "ALTEROU", id, antes, {
      ...agenda,
      ativo: true,
    });
    return rotina;
  }

  const rotina = await db.rotinaDeChecklist.create({
    data: { unidadeId: unidade.id, modeloId: dados.modeloId, ...agenda },
  });
  await registrar(contexto, "RotinaDeChecklist", "CRIOU", rotina.id, null, {
    modeloId: dados.modeloId,
    ...agenda,
  });
  return rotina;
}

/**
 * TROCA DE RESPONSÁVEL.
 *
 * Faltava. Até aqui, o dono de uma rotina era escolhido na criação e não
 * mudava mais — e a realidade de um restaurante é que o Alisson pede demissão,
 * a Cida entra de férias e alguém precisa assumir a abertura na segunda.
 *
 * Duas travas:
 *
 *   1. Só entra quem TEM ACESSO a esta loja (a mesma lista de
 *      `listarResponsaveis`). Sem isso, um id colado à mão poria a abertura da
 *      pizzaria no nome de um funcionário do Texanos.
 *   2. `null` é uma resposta válida e quer dizer "de quem estiver de plantão"
 *      — não é o mesmo que "ninguém decidiu ainda", e a tela escreve isso.
 *
 * Fica na auditoria: "quem cobrava" é o tipo de coisa que alguém contesta
 * depois.
 */
export async function alterarResponsavel(
  contexto: ContextoSessao,
  rotinaId: string,
  responsavelId: string | null,
) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar rotinas de checklist");
  }
  const unidade = exigirUnidade(contexto);

  const rotina = await db.rotinaDeChecklist.findFirst({
    where: { id: rotinaId, unidadeId: unidade.id, ativo: true },
    select: { id: true, responsavelId: true },
  });
  if (!rotina) throw new Error("Rotina não encontrada.");

  // O nome volta para a tela: a confirmação diz DE QUEM a rotina passou a ser.
  let nome: string | null = null;
  if (responsavelId) {
    const permitidos = await listarResponsaveis(contexto);
    const pessoa = permitidos.find((p) => p.id === responsavelId);
    if (!pessoa) {
      throw new Error(
        "Esta pessoa não tem acesso a esta loja, e por isso não pode ser cobrada por ela.",
      );
    }
    nome = pessoa.nome;
  }

  if (rotina.responsavelId === responsavelId) return { nome };

  await db.rotinaDeChecklist.update({
    where: { id: rotinaId },
    data: { responsavelId },
  });

  await registrar(
    contexto,
    "RotinaDeChecklist",
    "ALTEROU",
    rotinaId,
    { responsavelId: rotina.responsavelId },
    { responsavelId },
  );

  return { nome };
}

export async function desativarRotina(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar rotinas de checklist");
  }
  const unidade = exigirUnidade(contexto);

  const rotina = await db.rotinaDeChecklist.findFirst({
    where: { id, unidadeId: unidade.id },
    select: { id: true, ativo: true },
  });
  if (!rotina) throw new Error("Rotina não encontrada.");
  if (!rotina.ativo) return;

  await db.rotinaDeChecklist.update({
    where: { id },
    data: { ativo: false },
  });

  // Parar de cobrar a abertura é o tipo de decisão que alguém contesta depois.
  await registrar(
    contexto,
    "RotinaDeChecklist",
    "ALTEROU",
    id,
    { ativo: true },
    { ativo: false },
  );
}
