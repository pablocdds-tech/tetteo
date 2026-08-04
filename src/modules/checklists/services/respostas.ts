import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  calcularNota,
  conformidadeDoItem,
  descricaoDaPendencia,
  impedimentosParaFechar,
  type ItemRespondido,
} from "../schemas/pontuacao";

import { registrar } from "./auditoria";
import { exigirUnidade } from "./rotinas";

/**
 * AS RESPOSTAS — o que aconteceu num dia.
 *
 * A invariante deste arquivo é a mesma da contagem de estoque: **checklist
 * fechado não muda**. Um checklist é uma afirmação com hora e assinatura — "às
 * 7h03 a câmara fria estava limpa". Se a afirmação puder ser editada depois,
 * ela para de provar qualquer coisa, e o histórico vira ficção.
 *
 * Por isso o texto da pergunta é COPIADO para a resposta na abertura. Corrigir
 * a redação de um item amanhã não pode reescrever o que foi respondido ontem.
 */

export type ValorItem = {
  conforme?: boolean | null;
  naoSeAplica?: boolean;
  valorNumero?: number | null;
  valorTexto?: string | null;
  observacao?: string | null;
};

/**
 * Abre o checklist e congela a folha.
 *
 * Os itens são copiados AGORA. Se uma pergunta for acrescentada amanhã, ela
 * não entra no checklist de hoje — senão a folha mudaria debaixo de quem está
 * respondendo.
 */
export async function abrirResposta(
  contexto: ContextoSessao,
  dados: { modeloId: string; referencia: Date; rotinaId?: string | null },
) {
  if (!pode(contexto, "checklists.responder")) {
    throw new SemPermissao("responder checklists");
  }
  const unidade = exigirUnidade(contexto);

  const modelo = await db.modeloDeChecklist.findFirst({
    where: {
      id: dados.modeloId,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });
  if (!modelo) throw new Error("Checklist não encontrado.");
  if (modelo.itens.length === 0) {
    throw new Error(
      "Este checklist ainda não tem nenhuma pergunta. Escreva os itens antes de responder.",
    );
  }

  const resposta = await db.respostaDeChecklist.create({
    data: {
      unidadeId: unidade.id,
      modeloId: modelo.id,
      rotinaId: dados.rotinaId ?? null,
      referencia: dados.referencia,
      abertaPorId: contexto.usuario.id,
      itens: {
        createMany: {
          data: modelo.itens.map((item, indice) => ({
            itemId: item.id,
            textoItem: item.texto,
            secao: item.secao,
            tipo: item.tipo,
            ordem: indice,
          })),
        },
      },
    },
  });

  await registrar(contexto, "RespostaDeChecklist", "CRIOU", resposta.id, null, {
    modelo: modelo.nome,
    referencia: dados.referencia.toISOString(),
    itens: modelo.itens.length,
  });

  return resposta;
}

/**
 * "Responder agora": abre (ou retoma) o checklist da rotina.
 *
 * Se já existe um aberto, devolve ele — apertar o botão duas vezes não pode
 * criar duas folhas pela metade.
 */
export async function executarRotina(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.responder")) {
    throw new SemPermissao("responder checklists");
  }
  const unidade = exigirUnidade(contexto);

  const rotina = await db.rotinaDeChecklist.findFirst({
    where: { id, unidadeId: unidade.id, ativo: true },
    include: {
      respostas: {
        where: { status: "ABERTA", canceladaEm: null },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!rotina) throw new Error("Rotina não encontrada.");

  if (rotina.respostas[0]) return { id: rotina.respostas[0].id };

  return abrirResposta(contexto, {
    modeloId: rotina.modeloId,
    referencia: new Date(),
    rotinaId: rotina.id,
  });
}

export async function obterResposta(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.ver")) {
    throw new SemPermissao("ver os checklists");
  }
  const unidade = exigirUnidade(contexto);

  return db.respostaDeChecklist.findFirst({
    where: { id, unidadeId: unidade.id },
    include: {
      modelo: { select: { id: true, nome: true, descricao: true } },
      itens: {
        orderBy: { ordem: "asc" },
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
        },
      },
      pendencias: {
        where: { status: { not: "CANCELADA" } },
        select: { id: true, descricao: true, status: true },
      },
    },
  });
}

export type RespostaCompleta = NonNullable<
  Awaited<ReturnType<typeof obterResposta>>
>;

/** Traduz a linha do banco para o formato que a conta da nota entende. */
export function paraPontuacao(
  item: RespostaCompleta["itens"][number],
): ItemRespondido {
  return {
    textoItem: item.textoItem,
    tipo: item.tipo,
    obrigatorio: item.item.obrigatorio,
    conforme: item.conforme,
    naoSeAplica: item.naoSeAplica,
    valorNumero: item.valorNumero === null ? null : Number(item.valorNumero),
    valorTexto: item.valorTexto,
    minimo: item.item.minimo === null ? null : Number(item.item.minimo),
    maximo: item.item.maximo === null ? null : Number(item.item.maximo),
    observacao: item.observacao,
    exigeObservacaoSeNao: item.item.exigeObservacaoSeNao,
  };
}

/**
 * Grava o que foi preenchido.
 *
 * Recebe só o que a tela mandou. Chaves ausentes não são tocadas — salvar uma
 * parte da folha não pode apagar o resto.
 */
export async function salvarRespostas(
  contexto: ContextoSessao,
  respostaId: string,
  valores: Map<string, ValorItem>,
) {
  if (!pode(contexto, "checklists.responder")) {
    throw new SemPermissao("responder checklists");
  }
  const unidade = exigirUnidade(contexto);

  const resposta = await db.respostaDeChecklist.findFirst({
    where: { id: respostaId, unidadeId: unidade.id },
    select: { id: true, status: true },
  });
  if (!resposta) throw new Error("Checklist não encontrado.");
  if (resposta.status !== "ABERTA") {
    throw new Error("Este checklist já foi fechado e não aceita alterações.");
  }

  const agora = new Date();

  await db.$transaction(
    [...valores].map(([itemId, valor]) => {
      const respondeu =
        valor.naoSeAplica === true ||
        valor.conforme != null ||
        valor.valorNumero != null ||
        (valor.valorTexto ?? "").trim() !== "";

      return db.respostaItem.update({
        where: { respostaId_itemId: { respostaId, itemId } },
        data: {
          conforme: valor.conforme ?? null,
          naoSeAplica: valor.naoSeAplica ?? false,
          valorNumero: valor.valorNumero ?? null,
          valorTexto: valor.valorTexto ?? null,
          observacao: valor.observacao ?? null,
          respondidoPorId: respondeu ? contexto.usuario.id : null,
          respondidoEm: respondeu ? agora : null,
        },
      });
    }),
  );

  return valores.size;
}

/**
 * Fecha o checklist.
 *
 * Três coisas acontecem aqui, e a terceira é a razão de o módulo existir:
 *
 *   1. a conformidade de cada item é CONGELADA na linha
 *   2. a nota é calculada e guardada
 *   3. cada não conformidade vira uma PENDÊNCIA
 *
 * Sem o passo 3, o checklist é ritual: todo dia se anota que a coifa está suja
 * e todo dia ela continua suja. A pendência é o que obriga alguém a dizer o
 * que foi feito.
 *
 * A pendência nasce SEM responsável de propósito. O natural seria atribuir a
 * quem respondeu, mas quem encontra o problema quase nunca é quem conserta —
 * dar ao pizzaiolo a tarefa de trocar o compressor treina a equipe a ignorar a
 * lista. Sem dono, ela aparece no topo da tela do gerente até alguém assumir.
 */
export async function fecharResposta(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.responder")) {
    throw new SemPermissao("fechar checklists");
  }
  const unidade = exigirUnidade(contexto);

  const resposta = await obterResposta(contexto, id);
  if (!resposta) throw new Error("Checklist não encontrado.");
  if (resposta.status !== "ABERTA") {
    throw new Error("Este checklist já foi fechado.");
  }

  const itens = resposta.itens.map(paraPontuacao);

  const impedimentos = impedimentosParaFechar(itens);
  if (impedimentos.length > 0) {
    // Uma frase por linha: quem lê está de pé, com o celular na mão.
    throw new Error(impedimentos.join("\n"));
  }

  const nota = calcularNota(itens);
  const agora = new Date();

  // Casa a linha do banco com o item já traduzido pelo ÍNDICE, não pelo texto:
  // dois itens podem ter a mesma pergunta em seções diferentes ("Piso limpo?"
  // na cozinha e no salão), e casar por texto prenderia a pendência na linha
  // errada.
  const problemas = resposta.itens
    .map((linha, indice) => ({ linha, item: itens[indice] }))
    .filter(({ item }) => conformidadeDoItem(item) === false)
    .map(({ linha, item }) => ({
      respostaItemId: linha.id,
      descricao: descricaoDaPendencia(item),
    }));

  await db.$transaction([
    // Congela a conformidade item a item. O "sim/não" já está na linha; o que
    // se congela aqui é o veredito do NÚMERO, que hoje depende da faixa
    // cadastrada no modelo — e a faixa pode mudar amanhã.
    ...resposta.itens.map((linha, indice) =>
      db.respostaItem.update({
        where: { id: linha.id },
        data: {
          conforme: linha.naoSeAplica
            ? null
            : (conformidadeCongelada(itens[indice]) ?? linha.conforme),
        },
      }),
    ),

    db.respostaDeChecklist.update({
      where: { id },
      data: {
        status: "FECHADA",
        fechadaEm: agora,
        fechadaPorId: contexto.usuario.id,
        itensConformes: nota.conformes,
        itensNaoConformes: nota.naoConformes,
        pontuacao: nota.pontuacao,
      },
    }),

    ...problemas.map((problema) =>
      db.pendencia.create({
        data: {
          unidadeId: unidade.id,
          respostaId: id,
          respostaItemId: problema.respostaItemId,
          descricao: problema.descricao,
          criadaPorId: contexto.usuario.id,
        },
      }),
    ),
  ]);

  await registrar(
    contexto,
    "RespostaDeChecklist",
    "ALTEROU",
    id,
    { status: "ABERTA" },
    {
      status: "FECHADA",
      pontuacao: nota.pontuacao,
      conformes: nota.conformes,
      naoConformes: nota.naoConformes,
      pendenciasAbertas: problemas.length,
    },
  );

  return { pontuacao: nota.pontuacao, pendencias: problemas.length };
}

/** O veredito congelado: só interessa quando ele foi DERIVADO de uma faixa. */
function conformidadeCongelada(item: ItemRespondido): boolean | null {
  if (item.tipo !== "NUMERO") return null;
  if (item.minimo === null && item.maximo === null) return null;
  if (item.valorNumero === null) return null;
  if (item.minimo !== null && item.valorNumero < item.minimo) return false;
  if (item.maximo !== null && item.valorNumero > item.maximo) return false;
  return true;
}

/**
 * Cancela o checklist.
 *
 * Não existe reabrir: um checklist fechado já pode ter gerado pendência que
 * alguém está resolvendo. Cancelar é explícito, o registro continua no banco e
 * deixa rastro.
 */
export async function cancelarResposta(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "checklists.responder")) {
    throw new SemPermissao("cancelar checklists");
  }
  const unidade = exigirUnidade(contexto);

  const resposta = await db.respostaDeChecklist.findFirst({
    where: { id, unidadeId: unidade.id, canceladaEm: null },
    select: { id: true, status: true },
  });
  if (!resposta) throw new Error("Checklist não encontrado.");

  await db.$transaction([
    db.respostaDeChecklist.update({
      where: { id },
      data: { status: "CANCELADA", canceladaEm: new Date() },
    }),
    // As pendências que ele gerou vão junto: cobrar conserto de um checklist
    // que foi anulado é cobrar por engano.
    db.pendencia.updateMany({
      where: { respostaId: id, status: "ABERTA" },
      data: { status: "CANCELADA" },
    }),
  ]);

  await registrar(
    contexto,
    "RespostaDeChecklist",
    "EXCLUIU",
    id,
    { status: resposta.status },
    null,
  );
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
