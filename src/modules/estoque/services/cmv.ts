import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  calcularCmv,
  type CompraDoPeriodo,
  type ItemContado,
} from "../schemas/cmv";

import { exigirUnidade } from "./contagens";

/**
 * O CMV a partir do que está no banco.
 *
 * O serviço só junta as peças; a aritmética mora em `schemas/cmv.ts`, onde
 * pode ser testada sem banco. Aqui a responsabilidade é escolher as peças
 * CERTAS — e a escolha do período é a parte que engana.
 */

/** As contagens fechadas que podem servir de ponta. */
export async function contagensParaCmv(contexto: ContextoSessao) {
  if (!pode(contexto, "estoque.custos")) {
    throw new SemPermissao("ver os custos e o CMV");
  }
  const unidade = exigirUnidade(contexto);

  return db.contagem.findMany({
    where: { unidadeId: unidade.id, status: "FECHADA", canceladaEm: null },
    orderBy: { referencia: "desc" },
    select: {
      id: true,
      referencia: true,
      descricao: true,
      local: { select: { nome: true } },
      _count: { select: { itens: true } },
    },
    take: 60,
  });
}

export async function calcularCmvDoPeriodo(
  contexto: ContextoSessao,
  inicialId: string,
  finalId: string,
) {
  if (!pode(contexto, "estoque.custos")) {
    throw new SemPermissao("ver os custos e o CMV");
  }
  const unidade = exigirUnidade(contexto);

  const contagens = await db.contagem.findMany({
    where: {
      id: { in: [inicialId, finalId] },
      unidadeId: unidade.id,
      status: "FECHADA",
      canceladaEm: null,
    },
    include: {
      local: { select: { id: true, nome: true } },
      itens: {
        include: {
          insumo: {
            select: {
              id: true,
              nome: true,
              categoria: true,
              unidadeMedida: true,
              unidadeRotulo: true,
            },
          },
        },
      },
    },
  });

  const inicial = contagens.find((c) => c.id === inicialId);
  const final = contagens.find((c) => c.id === finalId);

  if (!inicial || !final) {
    throw new Error("Escolha duas contagens fechadas desta unidade.");
  }
  if (inicial.referencia >= final.referencia) {
    throw new Error(
      "A contagem inicial precisa ser anterior à final. Confira as datas.",
    );
  }

  const paraItem = (itens: (typeof inicial)["itens"]): ItemContado[] =>
    itens.map((i) => ({
      insumoId: i.insumoId,
      nome: i.insumo.nome,
      categoria: i.insumo.categoria,
      unidade: i.insumo.unidadeRotulo ?? i.insumo.unidadeMedida,
      quantidade: i.quantidade === null ? null : Number(i.quantidade),
      custoUnitario: Number(i.custoUnitario),
    }));

  // As compras do MEIO: recebidas depois da primeira contagem e até a
  // segunda. O limite usa a data de RECEBIMENTO, não a de lançamento —
  // digitar a nota com três dias de atraso não pode mudar o período dela.
  const itensDeNota = await db.notaEntradaItem.findMany({
    where: {
      nota: {
        unidadeId: unidade.id,
        status: "LANCADA",
        canceladaEm: null,
        recebidaEm: { gt: inicial.referencia, lte: final.referencia },
        // Contagem de um lugar só compara com o que entrou NAQUELE lugar.
        ...(final.localId ? { localDestinoId: final.localId } : {}),
      },
    },
    select: { insumoId: true, quantidade: true, valorTotal: true },
  });

  // A DEVOLUÇÃO desconta a compra: mercadoria que entrou e voltou para o
  // fornecedor não foi consumida. Sem isto ela apareceria como consumo — o
  // queijo devolvido na quarta viraria CMV da semana.
  const devolucoes = await db.movimentoEstoque.findMany({
    where: {
      unidadeId: unidade.id,
      tipo: "DEVOLUCAO",
      ocorridoEm: { gt: inicial.referencia, lte: final.referencia },
      ...(final.localId ? { localId: final.localId } : {}),
    },
    select: { insumoId: true, quantidade: true, custoUnitario: true },
  });

  const compras: CompraDoPeriodo[] = [
    ...itensDeNota.map((i) => ({
      insumoId: i.insumoId,
      quantidade: Number(i.quantidade),
      valor: Number(i.valorTotal),
    })),
    ...devolucoes.map((d) => ({
      insumoId: d.insumoId,
      quantidade: -Number(d.quantidade),
      valor: -Number(d.quantidade) * Number(d.custoUnitario),
    })),
  ];

  const resultado = calcularCmv(
    paraItem(inicial.itens),
    paraItem(final.itens),
    compras,
  );

  const dias = Math.max(
    1,
    Math.round(
      (final.referencia.getTime() - inicial.referencia.getTime()) / 86_400_000,
    ),
  );

  return {
    ...resultado,
    periodo: {
      inicial: {
        id: inicial.id,
        referencia: inicial.referencia,
        descricao: inicial.descricao,
        local: inicial.local?.nome ?? null,
      },
      final: {
        id: final.id,
        referencia: final.referencia,
        descricao: final.descricao,
        local: final.local?.nome ?? null,
      },
      dias,
      notas: itensDeNota.length,
    },
  };
}
