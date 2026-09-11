import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  centavosDoBanco,
  fatorDoBanco,
  milesimosDoBanco,
  type Centavos,
  type DezMilesimos,
  type Milesimos,
} from "../schemas/aritmetica";
import {
  montarGrade,
  precisaJustificar,
  sugerirMenorCusto,
  type ItemParaComparar,
  type PropostaParaComparar,
} from "../schemas/comparacao";
import { descreverEmbalagem } from "../schemas/embalagem";

import { registrar, type Cliente } from "./auditoria";
import { prepararSolicitacoesNaTransacao } from "./solicitacoes";

/**
 * A COMPARAÇÃO DA RODADA — o banco de um lado, a regra pura do outro.
 *
 * Aqui só se busca, se traduz Decimal em inteiro e se grava a ESCOLHA. A
 * conta mora em `schemas/comparacao.ts`. A sugestão é recalculada no servidor
 * a cada escolha: é contra ela que se decide se a escolha precisa de
 * justificativa — nunca contra o que a tela disse que a sugestão era.
 */

function exigirVer(ctx: ContextoSessao) {
  if (!pode(ctx, "compras.cotar") && !pode(ctx, "compras.aprovar")) {
    throw new SemPermissao("ver a comparação de preços");
  }
}

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export type PrecoDirecionado = {
  fornecedorId: string;
  fornecedor: string;
  origem: string;
  itemDePropostaId: string | null;
  nomeEmbalagem: string | null;
  pecas: number;
  conteudo: DezMilesimos | null;
  unidadeConteudo: ItemParaComparar["unidade"] | null;
  fracionavel: boolean;
  fator: DezMilesimos;
  precoEmbalagem: Centavos;
  frete: Centavos | null;
};

/** Tudo o que a comparação precisa, lido com o cliente que for passado. */
export async function dadosDaComparacao(
  cliente: Cliente,
  organizacaoId: string,
  rodadaId: string,
) {
  const rodada = await cliente.rodadaDeCompra.findFirst({
    where: { id: rodadaId, organizacaoId },
    select: {
      id: true,
      numero: true,
      descricao: true,
      estado: true,
      versao: true,
      entregaDe: true,
      entregaAte: true,
    },
  });
  if (!rodada) return null;

  // Em sequência, e não em paralelo: dentro de uma transação o cliente é UMA
  // conexão, e consultas simultâneas nela são recusadas pelo driver novo.
  const itensDb = await cliente.itemDaRodada.findMany({
    where: { rodadaId },
    orderBy: { ordem: "asc" },
    include: {
      insumo: { select: { nome: true, unidadeMedida: true } },
      fornecedorFixo: { select: { id: true, nome: true } },
    },
  });
  const origens = await cliente.itemDeRequisicao.findMany({
    where: { requisicao: { rodadaId, status: "ENVIADA" } },
    select: { id: true, insumoId: true, unidadeId: true, quantidade: true },
  });
  const solicitacoes = await cliente.solicitacaoDeCotacao.findMany({
    where: { rodadaId },
    include: {
      fornecedor: { select: { nome: true } },
      itens: { select: { id: true, itemDaRodadaId: true, direcionado: true } },
      versoes: {
        orderBy: { numero: "desc" },
        take: 1,
        include: { itens: true },
      },
    },
    orderBy: { fornecedor: { nome: "asc" } },
  });
  const fixos = await cliente.fornecedorInsumo.findMany({
    where: { organizacaoId, fixo: true, ativo: true },
    select: {
      fornecedorId: true,
      insumoId: true,
      nomeEmbalagem: true,
      pecas: true,
      conteudo: true,
      unidadeConteudo: true,
      fracionavel: true,
      fator: true,
      precoReferencia: true,
      precoReferenciaOrigem: true,
      precoReferenciaEm: true,
    },
  });

  const itens: (ItemParaComparar & {
    insumoId: string;
    fornecedorFixo: { id: string; nome: string } | null;
    requisicoes: { unidadeId: string; itemDeRequisicaoId: string }[];
  })[] = itensDb.map((i) => {
    const suas = origens.filter((o) => o.insumoId === i.insumoId);
    return {
      id: i.id,
      insumoId: i.insumoId,
      nome: i.insumo.nome,
      unidade: i.insumo.unidadeMedida,
      modo: i.modo,
      fornecedorFixo: i.fornecedorFixo,
      porLoja: suas.map((o) => ({
        unidadeId: o.unidadeId,
        quantidade: milesimosDoBanco(o.quantidade),
      })),
      requisicoes: suas.map((o) => ({
        unidadeId: o.unidadeId,
        itemDeRequisicaoId: o.id,
      })),
    };
  });

  const baseDoItem = new Map(itens.map((i) => [i.id, i.unidade]));

  const propostas: PropostaParaComparar[] = solicitacoes.map((s) => {
    const versao = s.versoes[0] ?? null;
    const doItem = new Map(s.itens.map((i) => [i.id, i.itemDaRodadaId]));
    return {
      fornecedorId: s.fornecedorId,
      nome: s.fornecedor.nome,
      versao: versao?.numero ?? 0,
      frete: versao?.frete == null ? null : centavosDoBanco(versao.frete),
      minimo:
        versao?.pedidoMinimo == null
          ? null
          : centavosDoBanco(versao.pedidoMinimo),
      prazoDias: versao?.prazoEntregaDias ?? null,
      itensSolicitados: s.itens
        .filter((i) => !i.direcionado)
        .map((i) => i.itemDaRodadaId),
      ofertas: (versao?.itens ?? [])
        .filter((o) => doItem.has(o.itemDaSolicitacaoId))
        .map((o) => {
          const itemId = doItem.get(o.itemDaSolicitacaoId)!;
          const base = baseDoItem.get(itemId)!;
          return {
            itemId,
            itemDePropostaId: o.id,
            situacao: o.situacao,
            fator: o.fator === null ? null : fatorDoBanco(o.fator),
            fatorMotivo: o.fatorMotivo,
            fracionavel: o.fracionavel,
            precoEmbalagem:
              o.precoEmbalagem === null
                ? null
                : centavosDoBanco(o.precoEmbalagem),
            precoZeroAutorizado: o.precoZeroAutorizado,
            disponivel:
              o.disponivel === null ? null : milesimosDoBanco(o.disponivel),
            descricaoEmbalagem: [
              o.nomeEmbalagem,
              descreverEmbalagem(
                {
                  pecas: o.pecas,
                  conteudo:
                    o.conteudo === null ? null : fatorDoBanco(o.conteudo),
                  unidadeConteudo: o.unidadeConteudo,
                  fracionavel: o.fracionavel,
                },
                base,
              ),
            ]
              .filter(Boolean)
              .join(" · "),
          };
        }),
    };
  });

  /**
   * O preço do item DIRECIONADO: a resposta do próprio fornecedor fixo, se
   * ele confirmou; senão, o preço de referência, dito com a data e a origem.
   */
  const direcionados = itens
    .filter((i) => i.modo === "DIRECIONADO" && i.fornecedorFixo)
    .map((i) => {
      const solicitacao = solicitacoes.find(
        (s) => s.fornecedorId === i.fornecedorFixo!.id,
      );
      const versao = solicitacao?.versoes[0];
      const meuItem = solicitacao?.itens.find((x) => x.itemDaRodadaId === i.id);
      const oferta = versao?.itens.find(
        (o) => o.itemDaSolicitacaoId === meuItem?.id,
      );

      let preco: PrecoDirecionado | null = null;
      if (
        oferta?.situacao === "COTADO" &&
        oferta.fator &&
        oferta.precoEmbalagem !== null
      ) {
        preco = {
          fornecedorId: i.fornecedorFixo!.id,
          fornecedor: i.fornecedorFixo!.nome,
          origem: `Confirmado pelo fornecedor fixo (proposta v${versao!.numero})`,
          itemDePropostaId: oferta.id,
          nomeEmbalagem: oferta.nomeEmbalagem,
          pecas: oferta.pecas,
          conteudo:
            oferta.conteudo === null ? null : fatorDoBanco(oferta.conteudo),
          unidadeConteudo: oferta.unidadeConteudo,
          fracionavel: oferta.fracionavel,
          fator: fatorDoBanco(oferta.fator),
          precoEmbalagem: centavosDoBanco(oferta.precoEmbalagem),
          frete: versao!.frete == null ? null : centavosDoBanco(versao!.frete),
        };
      } else {
        const ref = fixos.find(
          (f) =>
            f.insumoId === i.insumoId &&
            f.fornecedorId === i.fornecedorFixo!.id,
        );
        if (ref?.fator && ref.precoReferencia !== null) {
          preco = {
            fornecedorId: i.fornecedorFixo!.id,
            fornecedor: i.fornecedorFixo!.nome,
            origem: `Preço de referência${ref.precoReferenciaEm ? ` de ${dataCurta.format(ref.precoReferenciaEm)}` : ""}${ref.precoReferenciaOrigem ? ` (${ref.precoReferenciaOrigem})` : ""}`,
            itemDePropostaId: null,
            nomeEmbalagem: ref.nomeEmbalagem,
            pecas: ref.pecas,
            conteudo: ref.conteudo === null ? null : fatorDoBanco(ref.conteudo),
            unidadeConteudo: ref.unidadeConteudo,
            fracionavel: ref.fracionavel,
            fator: fatorDoBanco(ref.fator),
            precoEmbalagem: centavosDoBanco(ref.precoReferencia),
            frete: null,
          };
        }
      }
      return { item: i, preco };
    });

  return { rodada, itens, propostas, direcionados, solicitacoes };
}

export async function compararRodada(ctx: ContextoSessao, rodadaId: string) {
  exigirVer(ctx);
  const dados = await dadosDaComparacao(db, ctx.organizacao.id, rodadaId);
  if (!dados) return null;

  const grade = montarGrade(dados.itens, dados.propostas);
  const sugestao = sugerirMenorCusto(grade, dados.propostas);
  const escolhas = await db.escolhaDeItem.findMany({ where: { rodadaId } });
  const lojas = await db.unidade.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            dados.itens.flatMap((i) => i.porLoja.map((l) => l.unidadeId)),
          ),
        ],
      },
    },
    select: { id: true, nome: true },
  });

  return {
    rodada: dados.rodada,
    grade,
    sugestao,
    escolhas: escolhas.map((e) => ({
      itemDaRodadaId: e.itemDaRodadaId,
      fornecedorId: e.fornecedorId,
      itemDePropostaId: e.itemDePropostaId,
      seguiuSugestao: e.seguiuSugestao,
      justificativa: e.justificativa,
    })),
    direcionados: dados.direcionados.map((d) => ({
      itemId: d.item.id,
      nome: d.item.nome,
      unidade: d.item.unidade,
      necessario: d.item.porLoja.reduce(
        (s, l) => s + l.quantidade,
        0n,
      ) as Milesimos,
      fornecedorFixo: d.item.fornecedorFixo,
      preco: d.preco,
    })),
    solicitacoes: dados.solicitacoes.map((s) => ({
      fornecedorId: s.fornecedorId,
      fornecedor: s.fornecedor.nome,
      status: s.status,
      versao: s.versaoAtual,
    })),
    /** Frete e mínimo POR ENTREGA, da última versão de cada um. */
    fretes: dados.propostas.map((p) => ({
      fornecedorId: p.fornecedorId,
      frete: p.frete,
      minimo: p.minimo,
    })),
    lojas,
  };
}

/**
 * A escolha do comprador, item a item.
 *
 * Só escolhe o que dá para comprar: célula comparável, ou com disponibilidade
 * menor que a necessidade (com justificativa). Fator desconhecido, sem
 * resposta, indisponível e zero não autorizado não viram pedido.
 */
export async function escolher(
  ctx: ContextoSessao,
  rodadaId: string,
  dados: {
    itemDaRodadaId: string;
    fornecedorId: string;
    justificativa: string | null;
  },
): Promise<void> {
  if (!pode(ctx, "compras.cotar"))
    throw new SemPermissao("escolher fornecedores");

  const comparacao = await dadosDaComparacao(db, ctx.organizacao.id, rodadaId);
  if (!comparacao) throw new Error("Rodada não encontrada.");
  if (comparacao.rodada.estado !== "REVISAO") {
    throw new Error("A escolha é feita com a cotação encerrada, em revisão.");
  }

  const grade = montarGrade(comparacao.itens, comparacao.propostas);
  const linha = grade.linhas.find((l) => l.item.id === dados.itemDaRodadaId);
  if (!linha) throw new Error("Este item não está em disputa nesta rodada.");
  const celula = linha.celulas.find(
    (c) => c.fornecedorId === dados.fornecedorId,
  );
  if (
    !celula ||
    !["cotado", "disponibilidade-insuficiente"].includes(celula.estado)
  ) {
    const motivo: Record<string, string> = {
      "sem-resposta": "este fornecedor não cotou o item",
      indisponivel: "este fornecedor não tem o item",
      "conferir-fator":
        "a embalagem dele não tem conversão conhecida — confira o fator antes",
      "zero-sem-autorizacao": "o preço zero não foi autorizado",
      "nao-solicitado": "o item não foi pedido a este fornecedor",
    };
    throw new Error(
      `Não dá para escolher: ${motivo[celula?.estado ?? "nao-solicitado"]}.`,
    );
  }

  const sugestao = sugerirMenorCusto(grade, comparacao.propostas);
  const justificar =
    celula.estado !== "cotado" ||
    precisaJustificar(
      sugestao.ok ? sugestao.sugestao : null,
      dados.itemDaRodadaId,
      dados.fornecedorId,
    );
  const justificativa = dados.justificativa?.trim().slice(0, 300) || null;
  if (justificar && !justificativa) {
    throw new Error(
      celula.estado !== "cotado"
        ? "Este fornecedor não tem a quantidade toda. Justifique a escolha."
        : "Esta escolha é diferente da sugestão de menor custo total. Escreva o porquê — fica registrado.",
    );
  }

  await db.escolhaDeItem.upsert({
    where: { itemDaRodadaId: dados.itemDaRodadaId },
    create: {
      rodadaId,
      itemDaRodadaId: dados.itemDaRodadaId,
      fornecedorId: dados.fornecedorId,
      itemDePropostaId: celula.itemDePropostaId,
      seguiuSugestao: !justificar,
      justificativa,
      escolhidaPorId: ctx.usuario.id,
    },
    update: {
      fornecedorId: dados.fornecedorId,
      itemDePropostaId: celula.itemDePropostaId,
      seguiuSugestao: !justificar,
      justificativa,
      escolhidaPorId: ctx.usuario.id,
      escolhidaEm: new Date(),
    },
  });

  await registrar(db, ctx, {
    entidade: "EscolhaDeItem",
    entidadeId: dados.itemDaRodadaId,
    acao: "ALTEROU",
    depois: {
      fornecedorId: dados.fornecedorId,
      seguiuSugestao: !justificar,
      justificativa,
    },
  });
}

/** "Usar a sugestão": grava as escolhas sugeridas, todas de uma vez. */
export async function aplicarSugestao(
  ctx: ContextoSessao,
  rodadaId: string,
): Promise<number> {
  if (!pode(ctx, "compras.cotar"))
    throw new SemPermissao("escolher fornecedores");
  const comparacao = await dadosDaComparacao(db, ctx.organizacao.id, rodadaId);
  if (!comparacao) throw new Error("Rodada não encontrada.");
  if (comparacao.rodada.estado !== "REVISAO") {
    throw new Error("A escolha é feita com a cotação encerrada, em revisão.");
  }
  const r = sugerirMenorCusto(
    montarGrade(comparacao.itens, comparacao.propostas),
    comparacao.propostas,
  );
  if (!r.ok) throw new Error(r.motivo);

  await db.$transaction(async (tx) => {
    for (const e of r.sugestao.escolhas) {
      await tx.escolhaDeItem.upsert({
        where: { itemDaRodadaId: e.itemId },
        create: {
          rodadaId,
          itemDaRodadaId: e.itemId,
          fornecedorId: e.fornecedorId,
          itemDePropostaId: e.itemDePropostaId,
          seguiuSugestao: true,
          escolhidaPorId: ctx.usuario.id,
        },
        update: {
          fornecedorId: e.fornecedorId,
          itemDePropostaId: e.itemDePropostaId,
          seguiuSugestao: true,
          justificativa: null,
          escolhidaPorId: ctx.usuario.id,
          escolhidaEm: new Date(),
        },
      });
    }
  });
  await registrar(db, ctx, {
    entidade: "RodadaDeCompra",
    entidadeId: rodadaId,
    acao: "ALTEROU",
    depois: {
      sugestaoAplicada: r.sugestao.escolhas.length,
      total: r.sugestao.total,
    },
  });
  return r.sugestao.escolhas.length;
}

/**
 * Exceção autorizada: tirar um item do fornecedor fixo e pôr em disputa.
 * Só com a cotação aberta, e com motivo gravado no item e na auditoria.
 */
export async function colocarEmDisputa(
  ctx: ContextoSessao,
  itemDaRodadaId: string,
  motivo: string,
): Promise<void> {
  if (!pode(ctx, "compras.cotar"))
    throw new SemPermissao("colocar item em disputa");
  const texto = motivo.trim();
  if (!texto) throw new Error("Tirar do fornecedor fixo exige um motivo.");

  await db.$transaction(async (tx) => {
    const item = await tx.itemDaRodada.findFirst({
      where: {
        id: itemDaRodadaId,
        rodada: { organizacaoId: ctx.organizacao.id },
      },
      include: {
        rodada: {
          select: {
            id: true,
            estado: true,
            organizacaoId: true,
            prazoCotacao: true,
          },
        },
      },
    });
    if (!item) throw new Error("Item não encontrado.");
    if (item.modo !== "DIRECIONADO")
      throw new Error("Este item já está em disputa.");
    if (item.rodada.estado !== "COTANDO") {
      throw new Error("Só dá para colocar em disputa com a cotação aberta.");
    }

    await tx.itemDaRodada.update({
      where: { id: item.id },
      data: {
        modo: "COTAVEL",
        excecaoMotivo: texto.slice(0, 300),
        excecaoPorId: ctx.usuario.id,
        excecaoEm: new Date(),
      },
    });
    await prepararSolicitacoesNaTransacao(tx, item.rodada);
    await tx.itemDaSolicitacao.updateMany({
      where: { itemDaRodadaId: item.id },
      data: { direcionado: false },
    });
    await registrar(tx, ctx, {
      entidade: "ItemDaRodada",
      entidadeId: item.id,
      acao: "ALTEROU",
      antes: { modo: "DIRECIONADO", fornecedorFixoId: item.fornecedorFixoId },
      depois: { modo: "COTAVEL", motivo: texto },
    });
  });
}
