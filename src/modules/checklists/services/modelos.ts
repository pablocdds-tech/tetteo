import type { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { DadosItemModelo } from "../schemas/modelo";

import { registrar } from "./auditoria";

/**
 * OS MODELOS — o que perguntar.
 *
 * Escopo de ORGANIZAÇÃO, não de unidade. "Abertura da Pizzaria" é escrita uma
 * vez e as duas lojas respondem exatamente a mesma coisa; é o que torna a
 * comparação entre elas uma comparação de verdade.
 *
 * Por isso esta é a única parte do módulo que funciona com o seletor em "Rede
 * Completa": escrever o checklist é trabalho de escritório, respondê-lo é
 * trabalho de loja.
 */

export async function listarModelos(contexto: ContextoSessao) {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver os checklists");
  }

  return db.modeloDeChecklist.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    include: {
      _count: { select: { itens: true, rotinas: true } },
    },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });
}

export async function obterModelo(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver os checklists");
  }

  return db.modeloDeChecklist.findFirst({
    // Busca SEMPRE com escopo: mesmo com o id certo, o modelo de outra rede
    // não aparece.
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
    include: {
      itens: { orderBy: { ordem: "asc" } },
      rotinas: {
        select: {
          id: true,
          unidadeId: true,
          recorrencia: true,
          horario: true,
          ativo: true,
        },
      },
    },
  });
}

export async function criarModelo(
  contexto: ContextoSessao,
  dados: { nome: string; descricao: string | null },
) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("criar modelos de checklist");
  }

  const modelo = await db.modeloDeChecklist.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      nome: dados.nome,
      descricao: dados.descricao,
      criadoPorId: contexto.usuario.id,
    },
  });

  await registrar(contexto, "ModeloDeChecklist", "CRIOU", modelo.id, null, {
    nome: dados.nome,
  });

  return modelo;
}

export async function atualizarModelo(
  contexto: ContextoSessao,
  id: string,
  dados: { nome: string; descricao: string | null },
) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar modelos de checklist");
  }

  const antes = await db.modeloDeChecklist.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: { nome: true, descricao: true },
  });
  if (!antes) throw new Error("Checklist não encontrado.");

  await db.modeloDeChecklist.update({ where: { id }, data: dados });

  await registrar(contexto, "ModeloDeChecklist", "ALTEROU", id, antes, dados);
}

export async function alternarModelo(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar modelos de checklist");
  }

  const modelo = await db.modeloDeChecklist.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: { ativo: true },
  });
  if (!modelo) throw new Error("Checklist não encontrado.");

  await db.modeloDeChecklist.update({
    where: { id },
    data: { ativo: !modelo.ativo },
  });

  await registrar(
    contexto,
    "ModeloDeChecklist",
    "ALTEROU",
    id,
    { ativo: modelo.ativo },
    { ativo: !modelo.ativo },
  );
}

// ---------------------------------------------------------------------------
// OS ITENS
// ---------------------------------------------------------------------------

/** Confere que o modelo é desta rede antes de mexer em qualquer item dele. */
async function exigirModelo(contexto: ContextoSessao, modeloId: string) {
  const modelo = await db.modeloDeChecklist.findFirst({
    where: {
      id: modeloId,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    select: { id: true },
  });
  if (!modelo) throw new Error("Checklist não encontrado.");
  return modelo;
}

async function auditarItens(
  tx: Prisma.TransactionClient,
  contexto: ContextoSessao,
  modeloId: string,
  antes: unknown,
  depois: unknown,
) {
  await tx.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade: "ModeloDeChecklist",
      entidadeId: modeloId,
      acao: "ALTEROU",
      valoresAntes:
        antes == null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois == null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}

export async function adicionarItem(
  contexto: ContextoSessao,
  modeloId: string,
  dados: DadosItemModelo,
) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar modelos de checklist");
  }
  await exigirModelo(contexto, modeloId);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "modelo_de_checklist" WHERE "id" = ${modeloId} FOR UPDATE`;
    if ((await tx.itemDeModelo.count({ where: { modeloId } })) >= 200)
      throw new Error(
        "Um checklist pode ter até 200 perguntas. Crie outro modelo para a próxima etapa.",
      );

    // O item novo vai para o fim da lista. Quem escreve um checklist escreve na
    // ordem em que anda pela loja, e essa ordem é a própria sequência da
    // digitação.
    const ultimo = await tx.itemDeModelo.findFirst({
      where: { modeloId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });

    // Faixa só faz sentido em item numérico; guardá-la num "sim/não" criaria uma
    // regra invisível que ninguém entenderia depois.
    const numerico = dados.tipo === "NUMERO";

    const item = await tx.itemDeModelo.create({
      data: {
        modeloId,
        texto: dados.texto,
        secao: dados.secao,
        tipo: dados.tipo,
        ordem: (ultimo?.ordem ?? -1) + 1,
        obrigatorio: dados.obrigatorio,
        exigeObservacaoSeNao: dados.exigeObservacaoSeNao,
        exigeFoto: dados.exigeFoto,
        exigeVideo: dados.exigeVideo,
        opcoes:
          dados.tipo === "SELECAO_UNICA" || dados.tipo === "MULTIPLA_ESCOLHA"
            ? dados.opcoes
            : [],
        analisarIA: dados.analisarIA,
        criterioIA: dados.analisarIA ? dados.criterioIA : null,
        rotuloUnidade: numerico ? dados.rotuloUnidade : null,
        minimo: numerico ? (dados.minimo ?? null) : null,
        maximo: numerico ? (dados.maximo ?? null) : null,
      },
    });
    await auditarItens(tx, contexto, modeloId, null, {
      itemId: item.id,
      ...dados,
    });
    return item;
  });
}

/** A edição só vale para futuras folhas: a resposta já contém seu snapshot. */
export async function atualizarItemModelo(
  contexto: ContextoSessao,
  modeloId: string,
  itemId: string,
  dados: DadosItemModelo,
) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar modelos de checklist");
  }
  await exigirModelo(contexto, modeloId);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "modelo_de_checklist" WHERE "id" = ${modeloId} FOR UPDATE`;
    const anterior = await tx.itemDeModelo.findFirst({
      where: { id: itemId, modeloId },
    });
    if (!anterior) throw new Error("Item não encontrado neste checklist.");
    const numerico = dados.tipo === "NUMERO";
    const atualizado = await tx.itemDeModelo.update({
      where: { id: itemId },
      data: {
        texto: dados.texto,
        secao: dados.secao,
        tipo: dados.tipo,
        obrigatorio: dados.obrigatorio,
        exigeObservacaoSeNao: dados.exigeObservacaoSeNao,
        exigeFoto: dados.exigeFoto,
        exigeVideo: dados.exigeVideo,
        opcoes:
          dados.tipo === "SELECAO_UNICA" || dados.tipo === "MULTIPLA_ESCOLHA"
            ? dados.opcoes
            : [],
        analisarIA: dados.analisarIA,
        criterioIA: dados.analisarIA ? dados.criterioIA : null,
        rotuloUnidade: numerico ? dados.rotuloUnidade : null,
        minimo: numerico ? (dados.minimo ?? null) : null,
        maximo: numerico ? (dados.maximo ?? null) : null,
      },
    });
    await auditarItens(tx, contexto, modeloId, anterior, atualizado);
    return atualizado;
  });
}

export async function removerItem(
  contexto: ContextoSessao,
  modeloId: string,
  itemId: string,
) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar modelos de checklist");
  }
  await exigirModelo(contexto, modeloId);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "modelo_de_checklist" WHERE "id" = ${modeloId} FOR UPDATE`;
    const item = await tx.itemDeModelo.findFirst({
      where: { id: itemId, modeloId },
    });
    if (!item) throw new Error("Item não encontrado neste checklist.");

    const respondido = await tx.respostaItem.count({ where: { itemId } });

    if (respondido > 0) {
      // A resposta guarda o texto da pergunta, então apagar o item não corrompe
      // o histórico. Mas o vínculo é usado para comparar o mesmo item ao longo
      // do tempo — e apagar quebraria essa linha.
      throw new Error(
        "Este item já foi respondido alguma vez e não pode ser apagado. Crie um novo item e deixe este de fora dos próximos checklists desativando o modelo antigo.",
      );
    }

    await tx.itemDeModelo.delete({ where: { id: itemId } });
    await auditarItens(
      tx,
      contexto,
      modeloId,
      { itemId, texto: item.texto },
      { itemRemovido: itemId },
    );
  });
}

/** Sobe ou desce um item na folha. */
export async function moverItem(
  contexto: ContextoSessao,
  modeloId: string,
  itemId: string,
  direcao: "cima" | "baixo",
) {
  if (!pode(contexto, "checklists.editar")) {
    throw new SemPermissao("alterar modelos de checklist");
  }
  await exigirModelo(contexto, modeloId);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "modelo_de_checklist" WHERE "id" = ${modeloId} FOR UPDATE`;

    const itens = await tx.itemDeModelo.findMany({
      where: { modeloId },
      orderBy: { ordem: "asc" },
      select: { id: true, ordem: true },
    });

    const posicao = itens.findIndex((i) => i.id === itemId);
    if (posicao < 0) return;

    const vizinho = direcao === "cima" ? posicao - 1 : posicao + 1;
    if (vizinho < 0 || vizinho >= itens.length) return;

    // Reescreve a ordem inteira em vez de trocar dois números. Modelos
    // importados ou editados à mão chegam com ordens repetidas, e trocar dois
    // valores iguais não move nada.
    const nova = [...itens];
    [nova[posicao], nova[vizinho]] = [nova[vizinho], nova[posicao]];

    await Promise.all(
      nova.map((item, indice) =>
        tx.itemDeModelo.update({
          where: { id: item.id },
          data: { ordem: indice },
        }),
      ),
    );
    await auditarItens(
      tx,
      contexto,
      modeloId,
      { ordem: itens.map((i) => i.id) },
      { ordem: nova.map((i) => i.id) },
    );
  });
}
