import type { Prisma, RespostaDeChecklist } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { esquemaAtribuicaoResposta, esquemaValorItem } from "../schemas/modelo";
import {
  calcularNota,
  conformidadeDoItem,
  descricaoDaPendencia,
  impedimentosParaFechar,
  type ItemRespondido,
} from "../schemas/pontuacao";

import { exigirUnidade, nomesDeUsuarios } from "./rotinas";

export type ValorItem = {
  conforme?: boolean | null;
  naoSeAplica?: boolean;
  valorNumero?: number | null;
  valorTexto?: string | null;
  valorSelecao?: string[];
  observacao?: string | null;
  versaoEsperada?: number;
};

/** Todas as mutações da folha usam a mesma trava, inclusive evidência e IA. */
export async function comRespostaBloqueada<T>(
  contexto: ContextoSessao,
  respostaId: string,
  executar: (
    tx: Prisma.TransactionClient,
    resposta: RespostaDeChecklist,
  ) => Promise<T>,
): Promise<T> {
  if (!pode(contexto, "checklists.ver"))
    throw new SemPermissao("ver os checklists");
  const unidade = exigirUnidade(contexto);
  return db.$transaction(
    async (tx) => {
      const [linha] = await tx.$queryRaw<{ id: string }[]>`
      SELECT r."id" FROM "resposta_de_checklist" r
      JOIN "modelo_de_checklist" m ON m."id" = r."modeloId"
      WHERE r."id" = ${respostaId} AND r."unidadeId" = ${unidade.id}
        AND m."organizacaoId" = ${contexto.organizacao.id}
      FOR UPDATE OF r`;
      if (!linha) throw new Error("Checklist não encontrado.");
      const resposta = await tx.respostaDeChecklist.findUniqueOrThrow({
        where: { id: linha.id },
      });
      return executar(tx, resposta);
    },
    { timeout: 20_000 },
  );
}

export function exigirPodeResponder(
  contexto: ContextoSessao,
  resposta: Pick<RespostaDeChecklist, "responsavelId">,
) {
  if (!pode(contexto, "checklists.responder"))
    throw new SemPermissao("responder checklists");
  if (
    resposta.responsavelId &&
    resposta.responsavelId !== contexto.usuario.id &&
    !pode(contexto, "checklists.editar")
  ) {
    throw new SemPermissao("responder o checklist atribuído a outra pessoa");
  }
}

export async function auditarResposta(
  tx: Prisma.TransactionClient,
  contexto: ContextoSessao,
  respostaId: string,
  antes: unknown,
  depois: unknown,
) {
  await tx.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade: "RespostaDeChecklist",
      entidadeId: respostaId,
      acao: antes === null ? "CRIOU" : "ALTEROU",
      valoresAntes:
        antes == null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois == null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}

function exigirAberta(resposta: Pick<RespostaDeChecklist, "status">) {
  if (resposta.status !== "ABERTA")
    throw new Error("Este checklist já foi fechado e não aceita alterações.");
}

async function validarResponsavel(
  tx: Prisma.TransactionClient,
  contexto: ContextoSessao,
  responsavelId: string | null,
) {
  if (!responsavelId) return;
  const unidade = exigirUnidade(contexto);
  const acesso = await tx.acesso.findFirst({
    where: {
      usuarioId: responsavelId,
      organizacaoId: contexto.organizacao.id,
      status: "ATIVO",
      excluidoEm: null,
      OR: [{ unidadeId: unidade.id }, { unidadeId: null }],
    },
    select: { id: true },
  });
  if (!acesso) throw new Error("Esta pessoa não tem acesso a esta loja.");
}

async function abrirNoBanco(
  tx: Prisma.TransactionClient,
  contexto: ContextoSessao,
  dados: {
    modeloId: string;
    referencia: Date;
    rotinaId?: string | null;
    responsavelId?: string | null;
  },
) {
  const unidade = exigirUnidade(contexto);
  if (
    !(dados.referencia instanceof Date) ||
    !Number.isFinite(dados.referencia.getTime())
  )
    throw new Error("Data inválida.");
  const modelo = await tx.modeloDeChecklist.findFirst({
    where: {
      id: dados.modeloId,
      organizacaoId: contexto.organizacao.id,
      ativo: true,
      excluidoEm: null,
    },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });
  if (!modelo) throw new Error("Checklist não encontrado.");
  if (modelo.itens.length === 0)
    throw new Error(
      "Este checklist ainda não tem nenhuma pergunta. Escreva os itens antes de responder.",
    );
  if (modelo.itens.length > 200)
    throw new Error(
      "Um checklist pode ter até 200 perguntas. Divida este modelo em etapas.",
    );
  const responsavelId = dados.rotinaId
    ? (dados.responsavelId ?? null)
    : contexto.usuario.id;
  await validarResponsavel(tx, contexto, responsavelId);
  exigirPodeResponder(contexto, { responsavelId });
  const resposta = await tx.respostaDeChecklist.create({
    data: {
      unidadeId: unidade.id,
      modeloId: modelo.id,
      rotinaId: dados.rotinaId ?? null,
      referencia: dados.referencia,
      abertaPorId: contexto.usuario.id,
      responsavelId,
      itens: {
        createMany: {
          data: modelo.itens.map((item, ordem) => ({
            itemId: item.id,
            textoItem: item.texto,
            secao: item.secao,
            tipo: item.tipo,
            ordem,
            obrigatorio: item.obrigatorio,
            exigeObservacaoSeNao: item.exigeObservacaoSeNao,
            exigeFoto: item.exigeFoto,
            exigeVideo: item.exigeVideo,
            rotuloUnidade: item.rotuloUnidade,
            minimo: item.minimo,
            maximo: item.maximo,
            opcoes: item.opcoes,
            analisarIA: item.analisarIA,
            criterioIA: item.criterioIA,
          })),
        },
      },
    },
  });
  await auditarResposta(tx, contexto, resposta.id, null, {
    modelo: modelo.nome,
    referencia: dados.referencia.toISOString(),
    itens: modelo.itens.length,
    responsavelId,
  });
  return resposta;
}

export async function abrirResposta(
  contexto: ContextoSessao,
  dados: { modeloId: string; referencia: Date; rotinaId?: string | null },
) {
  if (!pode(contexto, "checklists.responder"))
    throw new SemPermissao("responder checklists");
  const unidade = exigirUnidade(contexto);
  return db.$transaction(async (tx) => {
    if (!dados.rotinaId) return abrirNoBanco(tx, contexto, dados);
    const [linha] = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "rotina_de_checklist" WHERE "id" = ${dados.rotinaId} AND "unidadeId" = ${unidade.id} FOR UPDATE`;
    if (!linha) throw new Error("Rotina não encontrada.");
    const rotina = await tx.rotinaDeChecklist.findUniqueOrThrow({
      where: { id: linha.id },
    });
    if (!rotina.ativo || rotina.modeloId !== dados.modeloId)
      throw new Error("Rotina não encontrada.");
    const existente = await tx.respostaDeChecklist.findFirst({
      where: { rotinaId: rotina.id, status: "ABERTA", canceladaEm: null },
    });
    if (existente) {
      exigirPodeResponder(contexto, existente);
      return existente;
    }
    return abrirNoBanco(tx, contexto, {
      ...dados,
      responsavelId: rotina.responsavelId,
    });
  });
}

export async function executarRotina(contexto: ContextoSessao, id: string) {
  const unidade = exigirUnidade(contexto);
  const rotina = await db.rotinaDeChecklist.findFirst({
    where: {
      id,
      unidadeId: unidade.id,
      ativo: true,
      modelo: { organizacaoId: contexto.organizacao.id },
    },
    select: { modeloId: true },
  });
  if (!rotina) throw new Error("Rotina não encontrada.");
  return abrirResposta(contexto, {
    modeloId: rotina.modeloId,
    referencia: new Date(),
    rotinaId: id,
  });
}

const inclusaoDaResposta = {
  modelo: { select: { id: true, nome: true, descricao: true } },
  itens: {
    orderBy: { ordem: "asc" as const },
    include: {
      item: {
        select: {
          obrigatorio: true,
          exigeObservacaoSeNao: true,
          exigeFoto: true,
          rotuloUnidade: true,
          minimo: true,
          maximo: true,
        },
      },
      evidencias: {
        where: { excluidoEm: null, arquivo: { excluidoEm: null } },
        include: {
          arquivo: { select: { id: true, tipo: true, nomeOriginal: true } },
        },
      },
    },
  },
  pendencias: {
    where: { status: { not: "CANCELADA" as const } },
    select: { id: true, descricao: true, status: true },
  },
} satisfies Prisma.RespostaDeChecklistInclude;

export async function obterResposta(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.ver"))
    throw new SemPermissao("ver os checklists");
  const unidade = exigirUnidade(contexto);
  return db.respostaDeChecklist.findFirst({
    where: {
      id,
      unidadeId: unidade.id,
      modelo: { organizacaoId: contexto.organizacao.id },
    },
    include: inclusaoDaResposta,
  });
}

export type RespostaCompleta = NonNullable<
  Awaited<ReturnType<typeof obterResposta>>
>;

export function paraPontuacao(
  item: RespostaCompleta["itens"][number],
): ItemRespondido {
  return {
    textoItem: item.textoItem,
    tipo: item.tipo,
    obrigatorio: item.obrigatorio,
    conforme: item.conforme,
    naoSeAplica: item.naoSeAplica,
    valorNumero: item.valorNumero === null ? null : Number(item.valorNumero),
    valorTexto: item.valorTexto,
    valorSelecao: item.valorSelecao,
    opcoes: item.opcoes,
    minimo: item.minimo === null ? null : Number(item.minimo),
    maximo: item.maximo === null ? null : Number(item.maximo),
    observacao: item.observacao,
    exigeObservacaoSeNao: item.exigeObservacaoSeNao,
    exigeFoto: item.exigeFoto,
    exigeVideo: item.exigeVideo,
    fotos: item.evidencias.filter((e) => e.arquivo.tipo.startsWith("image/"))
      .length,
    videos: item.evidencias.filter((e) => e.arquivo.tipo.startsWith("video/"))
      .length,
    evidencias: item.evidencias.map((e) => ({ tipo: e.arquivo.tipo })),
  };
}

async function salvarNoBanco(
  tx: Prisma.TransactionClient,
  contexto: ContextoSessao,
  resposta: RespostaDeChecklist,
  valores: Map<string, ValorItem>,
) {
  exigirPodeResponder(contexto, resposta);
  exigirAberta(resposta);
  if (valores.size > 200) throw new Error("Envie até 200 itens por vez.");
  const linhas = await tx.respostaItem.findMany({
    where: { respostaId: resposta.id, itemId: { in: [...valores.keys()] } },
  });
  if (linhas.length !== valores.size)
    throw new Error(
      "A resposta contém um item que não pertence a este checklist.",
    );
  const salvas = [];
  for (const linha of linhas) {
    const { versaoEsperada, ...bruto } = valores.get(linha.itemId)!;
    if (
      versaoEsperada !== undefined &&
      (!Number.isInteger(versaoEsperada) || versaoEsperada !== linha.versao)
    )
      throw new Error(
        "Este item mudou em outra tela. Recarregue para conferir antes de responder.",
      );
    const analise = esquemaValorItem.safeParse(bruto);
    if (!analise.success)
      throw new Error("A resposta contém texto, número ou seleção inválidos.");
    const v = analise.data;
    const selecao = v.valorSelecao ?? [];
    const deSelecao =
      linha.tipo === "SELECAO_UNICA" || linha.tipo === "MULTIPLA_ESCOLHA";
    if (
      new Set(selecao).size !== selecao.length ||
      selecao.some((opcao) => !linha.opcoes.includes(opcao)) ||
      (!deSelecao && selecao.length > 0) ||
      (linha.tipo === "SELECAO_UNICA" && selecao.length > 1)
    )
      throw new Error(`Revise as opções de: ${linha.textoItem}`);
    if (
      (linha.tipo !== "SIM_NAO" && v.conforme != null) ||
      (linha.tipo !== "NUMERO" && v.valorNumero != null) ||
      (linha.tipo !== "TEXTO" && (v.valorTexto ?? "").trim())
    )
      throw new Error(
        `A resposta não corresponde ao tipo de: ${linha.textoItem}`,
      );
    const dados = {
      conforme: v.conforme ?? null,
      naoSeAplica: v.naoSeAplica ?? false,
      valorNumero: v.valorNumero ?? null,
      valorTexto: v.valorTexto || null,
      valorSelecao: selecao,
      observacao: v.observacao || null,
    };
    const anterior = {
      conforme: linha.conforme,
      naoSeAplica: linha.naoSeAplica,
      valorNumero:
        linha.valorNumero === null ? null : Number(linha.valorNumero),
      valorTexto: linha.valorTexto,
      valorSelecao: linha.valorSelecao,
      observacao: linha.observacao,
    };
    if (JSON.stringify(anterior) === JSON.stringify(dados)) {
      salvas.push(linha);
      continue;
    }
    const respondeu =
      dados.naoSeAplica ||
      (linha.tipo === "SIM_NAO"
        ? dados.conforme !== null
        : linha.tipo === "NUMERO"
          ? dados.valorNumero !== null
          : deSelecao
            ? selecao.length > 0
            : !!dados.valorTexto);
    const salva = await tx.respostaItem.update({
      where: { id: linha.id },
      data: {
        ...dados,
        respondidoPorId: respondeu ? contexto.usuario.id : null,
        respondidoEm: respondeu ? new Date() : null,
        versao: { increment: 1 },
        resultadoIA: "NAO_SOLICITADA",
        motivoIA: null,
        confiancaIA: null,
        analisadaVersao: null,
        analiseIniciadaEm: null,
        revisadoPorId: null,
        revisadoEm: null,
      },
    });
    await auditarResposta(
      tx,
      contexto,
      resposta.id,
      { itemId: linha.itemId, versao: linha.versao, ...anterior },
      { itemId: linha.itemId, versao: salva.versao, ...dados },
    );
    salvas.push(salva);
  }
  if (salvas.some((linha, i) => linha.versao !== linhas[i].versao))
    await tx.respostaDeChecklist.update({
      where: { id: resposta.id },
      data: { versao: { increment: 1 } },
    });
  return salvas;
}

export async function salvarRespostas(
  contexto: ContextoSessao,
  respostaId: string,
  valores: Map<string, ValorItem>,
) {
  return comRespostaBloqueada(contexto, respostaId, async (tx, resposta) => {
    await salvarNoBanco(tx, contexto, resposta, valores);
    return valores.size;
  });
}

export async function salvarItem(
  contexto: ContextoSessao,
  respostaId: string,
  itemId: string,
  valor: ValorItem,
  versaoEsperada?: number,
) {
  return comRespostaBloqueada(contexto, respostaId, async (tx, resposta) => {
    const [linha] = await salvarNoBanco(
      tx,
      contexto,
      resposta,
      new Map([
        [
          itemId,
          { ...valor, versaoEsperada: versaoEsperada ?? valor.versaoEsperada },
        ],
      ]),
    );
    return {
      respondidoEm: linha.respondidoEm,
      respondidoPor: linha.respondidoPorId
        ? linha.respondidoPorId === contexto.usuario.id
          ? contexto.usuario.nome
          : ((
              await tx.usuario.findUnique({
                where: { id: linha.respondidoPorId },
                select: { nome: true },
              })
            )?.nome ?? null)
        : null,
      versao: linha.versao,
    };
  });
}

export async function atribuirResposta(
  contexto: ContextoSessao,
  id: string,
  dados: { responsavelId: string | null; prazoEm: Date | null },
) {
  if (!pode(contexto, "checklists.editar"))
    throw new SemPermissao("atribuir checklists");
  const analise = esquemaAtribuicaoResposta.safeParse(dados);
  if (!analise.success)
    throw new Error("Informe um responsável e um prazo válidos.");
  return comRespostaBloqueada(contexto, id, async (tx, resposta) => {
    exigirPodeResponder(contexto, resposta);
    exigirAberta(resposta);
    await validarResponsavel(tx, contexto, analise.data.responsavelId);
    const atualizada = await tx.respostaDeChecklist.update({
      where: { id },
      data: { ...analise.data, versao: { increment: 1 } },
    });
    await auditarResposta(
      tx,
      contexto,
      id,
      { responsavelId: resposta.responsavelId, prazoEm: resposta.prazoEm },
      analise.data,
    );
    return atualizada;
  });
}

/**
 * O HISTÓRICO DE UMA ROTINA — as últimas vezes em que ela foi cumprida.
 *
 * Fica ao lado da folha, no detalhe, e não numa tela separada. "A abertura de
 * ontem deu 71%" é a informação que muda o jeito de responder a de hoje; num
 * link para outra página, ela não é lida.
 */
export async function historicoDaRotina(
  contexto: ContextoSessao,
  rotinaId: string,
  limite = 6,
) {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver os checklists");
  }
  const unidade = exigirUnidade(contexto);

  const respostas = await db.respostaDeChecklist.findMany({
    where: {
      rotinaId,
      unidadeId: unidade.id,
      status: "FECHADA",
      canceladaEm: null,
    },
    orderBy: { referencia: "desc" },
    take: limite,
    select: {
      id: true,
      referencia: true,
      fechadaEm: true,
      fechadaPorId: true,
      pontuacao: true,
      itensConformes: true,
      itensNaoConformes: true,
      _count: { select: { pendencias: true } },
    },
  });

  const nomes = await nomesDeUsuarios(
    respostas.map((r) => r.fechadaPorId).filter((id): id is string => !!id),
  );

  return respostas.map((r) => ({
    id: r.id,
    referencia: r.referencia,
    fechadaEm: r.fechadaEm,
    fechadaPor: r.fechadaPorId
      ? (nomes.get(r.fechadaPorId)?.nome ?? null)
      : null,
    pontuacao: r.pontuacao === null ? null : Number(r.pontuacao),
    conformes: r.itensConformes,
    naoConformes: r.itensNaoConformes,
    pendencias: r._count.pendencias,
  }));
}

export type LinhaDoHistorico = Awaited<
  ReturnType<typeof historicoDaRotina>
>[number];

/** Fecha, calcula e cria pendências sob a mesma trava da edição. */
export async function fecharResposta(
  contexto: ContextoSessao,
  id: string,
  versaoEsperada?: number,
) {
  return comRespostaBloqueada(contexto, id, async (tx, resposta) => {
    exigirPodeResponder(contexto, resposta);
    if (resposta.status === "FECHADA")
      return {
        pontuacao:
          resposta.pontuacao === null ? null : Number(resposta.pontuacao),
        pendencias: await tx.pendencia.count({ where: { respostaId: id } }),
      };
    exigirAberta(resposta);
    if (
      versaoEsperada !== undefined &&
      (!Number.isInteger(versaoEsperada) || versaoEsperada !== resposta.versao)
    )
      throw new Error(
        "O checklist mudou em outra tela. Recarregue e confira antes de concluir.",
      );
    const completa = await tx.respostaDeChecklist.findUniqueOrThrow({
      where: { id },
      include: inclusaoDaResposta,
    });
    const itens = completa.itens.map(paraPontuacao);
    const impedimentos = impedimentosParaFechar(itens);
    if (impedimentos.length > 0) throw new Error(impedimentos.join("\n"));
    const nota = calcularNota(itens);
    let problemas = 0;
    for (const [indice, linha] of completa.itens.entries()) {
      const conformidade = conformidadeDoItem(itens[indice]);
      if (linha.tipo === "NUMERO")
        await tx.respostaItem.update({
          where: { id: linha.id },
          data: { conforme: conformidade },
        });
      if (conformidade === false) {
        await tx.pendencia.create({
          data: {
            unidadeId: resposta.unidadeId,
            respostaId: id,
            respostaItemId: linha.id,
            descricao: descricaoDaPendencia(itens[indice]),
            criadaPorId: contexto.usuario.id,
          },
        });
        problemas += 1;
      }
    }
    await tx.respostaDeChecklist.update({
      where: { id },
      data: {
        status: "FECHADA",
        fechadaEm: new Date(),
        fechadaPorId: contexto.usuario.id,
        itensConformes: nota.conformes,
        itensNaoConformes: nota.naoConformes,
        pontuacao: nota.pontuacao,
        versao: { increment: 1 },
      },
    });
    await auditarResposta(
      tx,
      contexto,
      id,
      { status: "ABERTA" },
      {
        status: "FECHADA",
        pontuacao: nota.pontuacao,
        pendenciasAbertas: problemas,
      },
    );
    return { pontuacao: nota.pontuacao, pendencias: problemas };
  });
}

export async function cancelarResposta(contexto: ContextoSessao, id: string) {
  return comRespostaBloqueada(contexto, id, async (tx, resposta) => {
    exigirPodeResponder(contexto, resposta);
    if (resposta.status === "CANCELADA") return;
    await tx.respostaDeChecklist.update({
      where: { id },
      data: {
        status: "CANCELADA",
        canceladaEm: new Date(),
        versao: { increment: 1 },
      },
    });
    await tx.pendencia.updateMany({
      where: { respostaId: id, status: "ABERTA" },
      data: { status: "CANCELADA" },
    });
    await auditarResposta(
      tx,
      contexto,
      id,
      { status: resposta.status },
      { status: "CANCELADA" },
    );
  });
}

/** O histórico: o que já foi respondido nesta loja. */
export async function listarHistorico(
  contexto: ContextoSessao,
  filtros: { modeloId?: string | null } = {},
) {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver os checklists");
  }
  const unidade = exigirUnidade(contexto);

  return db.respostaDeChecklist.findMany({
    where: {
      unidadeId: unidade.id,
      canceladaEm: null,
      ...(filtros.modeloId ? { modeloId: filtros.modeloId } : {}),
    },
    include: {
      modelo: { select: { id: true, nome: true } },
      _count: { select: { pendencias: true } },
    },
    orderBy: { referencia: "desc" },
    take: 60,
  });
}

/** Os checklists disponíveis para uma resposta avulsa. */
export async function modelosDisponiveis(contexto: ContextoSessao) {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver os checklists");
  }

  return db.modeloDeChecklist.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
      ativo: true,
      itens: { some: {} },
    },
    select: { id: true, nome: true, _count: { select: { itens: true } } },
    orderBy: { nome: "asc" },
  });
}
