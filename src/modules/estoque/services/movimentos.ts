import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  resumirPerdas,
  type MovimentoParaResumo,
  type TipoDeMovimento,
} from "../schemas/movimentos";

import { exigirUnidade } from "./contagens";

/**
 * OS MOVIMENTOS.
 *
 * Toda escrita aqui mexe em DUAS coisas na mesma transação: o razão (o fato) e
 * a posição (o saldo). Separá-las abriria a porta para o saldo divergir do
 * histórico — e um saldo que não se explica pela lista é exatamente o que
 * fazia ninguém confiar no número anterior.
 */

export type DadosSaida = {
  insumoId: string;
  localId: string;
  tipo: Extract<
    TipoDeMovimento,
    "PERDA" | "QUEBRA" | "CONSUMO_INTERNO" | "DOACAO"
  >;
  quantidade: number;
  motivo: string | null;
  ocorridoEm: Date;
};

/**
 * Registra uma saída: lixo, quebra, refeição de funcionário, doação.
 *
 * O custo é congelado agora, do custo médio do insumo. A perda de terça vale o
 * preço de terça — se a mussarela subir na quinta, o prejuízo de terça não
 * aumenta sozinho.
 */
export async function registrarSaida(
  contexto: ContextoSessao,
  dados: DadosSaida,
) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("registrar saídas de estoque");
  }
  const unidade = exigirUnidade(contexto);

  const [insumo, local] = await Promise.all([
    db.insumo.findFirst({
      where: {
        id: dados.insumoId,
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
      },
      select: { id: true, custoMedio: true },
    }),
    db.localEstoque.findFirst({
      where: { id: dados.localId, unidadeId: unidade.id },
      select: { id: true },
    }),
  ]);

  if (!insumo) throw new Error("Insumo não encontrado.");
  if (!local) throw new Error("Lugar não encontrado nesta unidade.");
  if (dados.quantidade <= 0) {
    throw new Error("A quantidade precisa ser maior que zero.");
  }

  await db.$transaction([
    db.movimentoEstoque.create({
      data: {
        unidadeId: unidade.id,
        insumoId: dados.insumoId,
        localId: dados.localId,
        tipo: dados.tipo,
        quantidade: dados.quantidade,
        custoUnitario: insumo.custoMedio,
        motivo: dados.motivo,
        ocorridoEm: dados.ocorridoEm,
        registradoPorId: contexto.usuario.id,
      },
    }),
    // `upsert` porque a saída pode acontecer num lugar onde a posição nunca
    // foi criada — jogar fora o que chegou hoje e ainda não foi contado é
    // rotina, não exceção.
    db.posicaoEstoque.upsert({
      where: {
        localId_insumoId: {
          localId: dados.localId,
          insumoId: dados.insumoId,
        },
      },
      update: { quantidade: { decrement: dados.quantidade } },
      create: {
        unidadeId: unidade.id,
        localId: dados.localId,
        insumoId: dados.insumoId,
        quantidade: -dados.quantidade,
      },
    }),
  ]);
}

/**
 * Move mercadoria de um lugar para outro dentro da mesma loja.
 *
 * Uma linha só descreve a mudança inteira. Duas linhas espelhadas dobrariam o
 * histórico e criariam a chance de uma existir sem a outra — que é como um
 * saldo passa a não fechar.
 */
export async function transferir(
  contexto: ContextoSessao,
  dados: {
    insumoId: string;
    localId: string;
    localDestinoId: string;
    quantidade: number;
    motivo: string | null;
  },
) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("transferir estoque");
  }
  const unidade = exigirUnidade(contexto);

  if (dados.localId === dados.localDestinoId) {
    throw new Error("Origem e destino são o mesmo lugar.");
  }
  if (dados.quantidade <= 0) {
    throw new Error("A quantidade precisa ser maior que zero.");
  }

  const locais = await db.localEstoque.count({
    where: {
      id: { in: [dados.localId, dados.localDestinoId] },
      unidadeId: unidade.id,
    },
  });
  if (locais !== 2) throw new Error("Lugar não encontrado nesta unidade.");

  const insumo = await db.insumo.findFirst({
    where: {
      id: dados.insumoId,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    select: { custoMedio: true },
  });
  if (!insumo) throw new Error("Insumo não encontrado.");

  await db.$transaction([
    db.movimentoEstoque.create({
      data: {
        unidadeId: unidade.id,
        insumoId: dados.insumoId,
        localId: dados.localId,
        localDestinoId: dados.localDestinoId,
        tipo: "TRANSFERENCIA",
        quantidade: dados.quantidade,
        custoUnitario: insumo.custoMedio,
        motivo: dados.motivo,
        registradoPorId: contexto.usuario.id,
      },
    }),
    db.posicaoEstoque.upsert({
      where: {
        localId_insumoId: { localId: dados.localId, insumoId: dados.insumoId },
      },
      update: { quantidade: { decrement: dados.quantidade } },
      create: {
        unidadeId: unidade.id,
        localId: dados.localId,
        insumoId: dados.insumoId,
        quantidade: -dados.quantidade,
      },
    }),
    db.posicaoEstoque.upsert({
      where: {
        localId_insumoId: {
          localId: dados.localDestinoId,
          insumoId: dados.insumoId,
        },
      },
      update: { quantidade: { increment: dados.quantidade } },
      create: {
        unidadeId: unidade.id,
        localId: dados.localDestinoId,
        insumoId: dados.insumoId,
        quantidade: dados.quantidade,
      },
    }),
  ]);
}

export async function listarMovimentos(
  contexto: ContextoSessao,
  filtro: { de?: Date; ate?: Date; tipo?: TipoDeMovimento } = {},
) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  const linhas = await db.movimentoEstoque.findMany({
    where: {
      unidadeId: unidade.id,
      ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
      ...(filtro.de || filtro.ate
        ? {
            ocorridoEm: {
              ...(filtro.de ? { gte: filtro.de } : {}),
              ...(filtro.ate ? { lte: filtro.ate } : {}),
            },
          }
        : {}),
    },
    include: {
      insumo: {
        select: {
          nome: true,
          categoria: true,
          unidadeMedida: true,
          unidadeRotulo: true,
        },
      },
      local: { select: { nome: true } },
      localDestino: { select: { nome: true } },
    },
    orderBy: { ocorridoEm: "desc" },
    take: 200,
  });

  return linhas.map((m) => ({
    id: m.id,
    tipo: m.tipo,
    insumo: m.insumo.nome,
    categoria: m.insumo.categoria,
    unidade: m.insumo.unidadeRotulo ?? m.insumo.unidadeMedida,
    local: m.local.nome,
    localDestino: m.localDestino?.nome ?? null,
    quantidade: Number(m.quantidade),
    custoUnitario: Number(m.custoUnitario),
    valor:
      Math.round(Number(m.quantidade) * Number(m.custoUnitario) * 100) / 100,
    motivo: m.motivo,
    ocorridoEm: m.ocorridoEm,
  }));
}

/** O que foi para o lixo no período, e por quê. */
export async function perdasDoPeriodo(
  contexto: ContextoSessao,
  de: Date,
  ate: Date,
) {
  if (!pode(contexto, "estoque.custos")) {
    throw new SemPermissao("ver o valor das perdas");
  }
  const unidade = exigirUnidade(contexto);

  const linhas = await db.movimentoEstoque.findMany({
    where: {
      unidadeId: unidade.id,
      ocorridoEm: { gte: de, lte: ate },
      tipo: { in: ["PERDA", "QUEBRA", "CONSUMO_INTERNO", "DOACAO"] },
    },
    include: {
      insumo: { select: { nome: true, categoria: true } },
    },
  });

  const paraResumo: MovimentoParaResumo[] = linhas.map((m) => ({
    tipo: m.tipo,
    quantidade: Number(m.quantidade),
    custoUnitario: Number(m.custoUnitario),
    motivo: m.motivo,
    insumo: m.insumo.nome,
    categoria: m.insumo.categoria,
  }));

  return resumirPerdas(paraResumo);
}
