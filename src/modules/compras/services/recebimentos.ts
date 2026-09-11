import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { Unidade } from "@/lib/unidades";
import { vincularArquivos } from "@/server/arquivos";
import { db } from "@/server/db";

import {
  CASAS,
  NumeroInvalido,
  centavosDoBanco,
  dividirArredondando,
  doBanco,
  fatorDoBanco,
  milesimosDigitados,
  milesimosDoBanco,
  paraDecimal,
  quantidadeBr,
  reais,
  totalFracionado,
  type Centavos,
  type Milesimos,
} from "../schemas/aritmetica";
import { descreverEmbalagem } from "../schemas/embalagem";
import { referenciaDoPedido } from "../schemas/mensagens";
import {
  conferir,
  type Entrada,
  type Informado,
  type LinhaParaConferir,
} from "../schemas/recebimento";

import { registrar } from "./auditoria";

/**
 * O RECEBIMENTO — o que chegou, conferido.
 *
 * Imutável: corrigir é outro recebimento (DEVOLUÇÃO), nunca editar. E a
 * entrada no estoque NÃO acontece aqui — é a nota de entrada do Estoque, que
 * o orquestrador (`app/(shell)/compras/recebimento/conferir.ts`) cria na MESMA
 * transação, entre `registrarRecebimentoNaTransacao` e `concluirNaTransacao`.
 *
 * As garantias:
 *
 *   DUPLO CLIQUE          a `chave` é gerada quando a tela abre e é única; o
 *                         segundo envio devolve o primeiro recebimento.
 *   DUAS CONFERÊNCIAS     o pedido é travado (`FOR UPDATE`); a segunda espera,
 *   AO MESMO TEMPO        e confere contra o acumulado da primeira — excedente
 *                         sem decisão é recusado.
 *   OUTRA LOJA            o pedido é procurado na loja ATIVA de quem confere.
 *   METADE GRAVADA        tudo numa transação; o pedido só é concluído dentro
 *                         dela, depois da entrada no estoque.
 */

type Tx = Prisma.TransactionClient;

export class ConferenciaInvalida extends Error {
  constructor(
    public readonly erros: { itemDePedidoId: string; mensagem: string }[],
  ) {
    super(erros.map((e) => e.mensagem).join(" "));
    this.name = "ConferenciaInvalida";
  }
}

function lojaAtiva(ctx: ContextoSessao) {
  if (!ctx.unidadeAtiva) throw new ExigeUnidade();
  return ctx.unidadeAtiva;
}

function exigirReceber(ctx: ContextoSessao) {
  if (!pode(ctx, "compras.receber"))
    throw new SemPermissao("conferir recebimentos");
}

type ItemComRecebidos = Prisma.ItemDePedidoGetPayload<{
  include: {
    itensRecebidos: {
      select: { quantidadeBoa: true; recebimento: { select: { tipo: true } } };
    };
  };
}>;

/** O pedido visto pela conferência: efetivo (sem o cancelado) e o que já entrou. */
export function linhasDoPedido(itens: ItemComRecebidos[]): LinhaParaConferir[] {
  return itens.map((i) => ({
    itemDePedidoId: i.id,
    insumoId: i.insumoId,
    nome: i.insumoNome,
    unidade: i.unidadeEstoque as Unidade,
    fator: fatorDoBanco(i.fatorConversao),
    fracionavel: i.fracionavel,
    pedido:
      milesimosDoBanco(i.quantidade) - milesimosDoBanco(i.quantidadeCancelada),
    recebidoAntes: i.itensRecebidos
      .filter((r) => r.recebimento.tipo === "ENTRADA")
      .reduce((s, r) => s + milesimosDoBanco(r.quantidadeBoa), 0n),
    precoEmbalagem: centavosDoBanco(i.precoEmbalagem),
  }));
}

async function travarPedido(tx: Tx, pedidoId: string) {
  const [linha] = await tx.$queryRaw<
    {
      id: string;
      organizacaoId: string;
      unidadeId: string;
      status: string;
      fornecedorId: string;
      numero: number;
      sequencia: number;
      pedidoOrigemId: string | null;
    }[]
  >`SELECT "id", "organizacaoId", "unidadeId", "status"::text AS "status",
           "fornecedorId", "numero", "sequencia", "pedidoOrigemId"
    FROM "pedido" WHERE "id" = ${pedidoId} FOR UPDATE`;
  return linha ?? null;
}

// ------------------------------------------------------------------ LEITURA

/** Pedidos aprovados da loja, esperando o caminhão. */
export async function pedidosParaReceber(ctx: ContextoSessao) {
  if (!pode(ctx, "compras.ver")) throw new SemPermissao("ver compras");
  const lojas = ctx.unidadeAtiva
    ? [ctx.unidadeAtiva.id]
    : ctx.unidadesVisiveis.map((u) => u.id);
  const pedidos = await db.pedido.findMany({
    where: {
      organizacaoId: ctx.organizacao.id,
      unidadeId: { in: lojas },
      status: { in: ["APROVADO", "CONCLUIDO"] },
    },
    include: {
      pedidoOrigem: { select: { numero: true } },
      _count: { select: { itens: true, recebimentos: true } },
    },
    orderBy: [{ status: "asc" }, { entregaDe: "asc" }, { criadoEm: "desc" }],
    take: 80,
  });
  return pedidos.map((p) => ({
    id: p.id,
    referencia: referenciaDoPedido(
      p.pedidoOrigem?.numero ?? p.numero,
      p.sequencia,
    ),
    loja: p.unidadeNome,
    fornecedor: p.fornecedorNome,
    status: p.status,
    situacaoRecebimento: p.situacaoRecebimento,
    entregaDe: p.entregaDe,
    entregaAte: p.entregaAte,
    itens: p._count.itens,
    entregas: p._count.recebimentos,
    total: p.total.toString(),
  }));
}

export type VistaDaConferencia = NonNullable<
  Awaited<ReturnType<typeof prepararConferencia>>
>;

export async function prepararConferencia(
  ctx: ContextoSessao,
  pedidoId: string,
) {
  if (!pode(ctx, "compras.ver")) throw new SemPermissao("ver compras");
  const loja = lojaAtiva(ctx);

  const pedido = await db.pedido.findFirst({
    where: {
      id: pedidoId,
      organizacaoId: ctx.organizacao.id,
      unidadeId: loja.id,
    },
    include: {
      pedidoOrigem: { select: { numero: true } },
      itens: {
        orderBy: { ordem: "asc" },
        include: {
          itensRecebidos: {
            select: {
              quantidadeBoa: true,
              recebimento: { select: { tipo: true } },
            },
          },
        },
      },
      recebimentos: {
        orderBy: { registradoEm: "asc" },
        include: { itens: true },
      },
      divergencias: { orderBy: { criadoEm: "asc" } },
    },
  });
  if (!pedido) return null;

  const [locais, notas, insumos] = await Promise.all([
    db.localEstoque.findMany({
      where: { unidadeId: loja.id, ativo: true },
      select: { id: true, nome: true },
      orderBy: { ordem: "asc" },
    }),
    db.notaEntrada.findMany({
      where: {
        unidadeId: loja.id,
        fornecedorId: pedido.fornecedorId,
        status: "LANCADA",
        recebimentoId: null,
        recebidaEm: { gte: new Date(Date.now() - 60 * 86_400_000) },
      },
      select: {
        id: true,
        numero: true,
        serie: true,
        recebidaEm: true,
        valorTotal: true,
      },
      orderBy: { recebidaEm: "desc" },
    }),
    db.insumo.findMany({
      where: {
        organizacaoId: ctx.organizacao.id,
        ativo: true,
        excluidoEm: null,
      },
      select: { id: true, nome: true, unidadeMedida: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  const linhas = linhasDoPedido(pedido.itens);
  const recebedores = await db.usuario.findMany({
    where: { id: { in: pedido.recebimentos.map((r) => r.recebidoPorId) } },
    select: { id: true, nome: true },
  });

  return {
    id: pedido.id,
    referencia: referenciaDoPedido(
      pedido.pedidoOrigem?.numero ?? pedido.numero,
      pedido.sequencia,
    ),
    status: pedido.status,
    situacaoRecebimento: pedido.situacaoRecebimento,
    fornecedor: pedido.fornecedorNome,
    loja: pedido.unidadeNome,
    entregaDe: pedido.entregaDe,
    entregaAte: pedido.entregaAte,
    podeConferir: pode(ctx, "compras.receber") && pedido.status === "APROVADO",
    // Gerada AGORA, quando a tela abre: é ela que torna o duplo clique inofensivo.
    chave: randomUUID(),
    linhas: pedido.itens.map((i) => {
      const l = linhas.find((x) => x.itemDePedidoId === i.id)!;
      const saldo = l.pedido - l.recebidoAntes;
      return {
        itemDePedidoId: i.id,
        insumoId: i.insumoId,
        nome: i.insumoNome,
        unidade: i.unidadeEstoque,
        fracionavel: i.fracionavel,
        nomeEmbalagem: i.nomeEmbalagem,
        embalagem: descreverEmbalagem(
          {
            pecas: i.pecas,
            conteudo: i.conteudo === null ? null : fatorDoBanco(i.conteudo),
            unidadeConteudo: i.unidadeConteudo,
            fracionavel: i.fracionavel,
          },
          i.unidadeEstoque,
        ),
        fator: i.fatorConversao.toString(),
        embalagensPedidas: i.embalagens.toString(),
        pedido: paraDecimal(l.pedido, CASAS.milesimos),
        recebido: paraDecimal(l.recebidoAntes, CASAS.milesimos),
        saldo: paraDecimal(saldo > 0n ? saldo : 0n, CASAS.milesimos),
        precoEmbalagem: i.precoEmbalagem.toString(),
      };
    }),
    locais,
    notas: notas.map((n) => ({ ...n, valorTotal: n.valorTotal.toString() })),
    insumos,
    historico: pedido.recebimentos.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      numero: r.numero,
      recebidaEm: r.recebidaEm,
      recebidoPor:
        recebedores.find((u) => u.id === r.recebidoPorId)?.nome ?? null,
      valorConferido: r.valorConferido.toString(),
      notaEntradaId: r.notaEntradaId,
      notaVinculadaExistente: r.notaVinculadaExistente,
      motivo: r.motivo,
      itens: r.itens.map((x) => ({
        id: x.id,
        itemDePedidoId: x.itemDePedidoId,
        insumoId: x.insumoId,
        quantidadeBoa: x.quantidadeBoa.toString(),
        quantidadeAvariada: x.quantidadeAvariada.toString(),
        quantidadeRecusada: x.quantidadeRecusada.toString(),
        fotoIds: x.fotoIds,
        lote: x.lote,
        validade: x.validade,
      })),
    })),
    divergencias: pedido.divergencias.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      detalhe: d.detalhe,
      estado: d.estado,
      impacto: d.impacto?.toString() ?? null,
    })),
  };
}

// ---------------------------------------------------------------- CONFERIR

export type DadosDaConferencia = {
  pedidoId: string;
  chave: string;
  recebidaEm: Date;
  localDestinoId: string;
  informados: Informado[];
  numeroNota: string | null;
  serieNota: string | null;
  chaveAcesso: string | null;
  /** Nota lançada à mão antes: liga a ela, sem nova entrada. */
  notaExistenteId: string | null;
  observacao: string | null;
};

export type RecebimentoRegistrado = {
  jaExistia: boolean;
  recebimentoId: string;
  pedidoId: string;
  unidadeId: string;
  fornecedorId: string;
  referencia: string;
  numero: number;
  entradas: Entrada[];
  linhas: LinhaParaConferir[];
  completo: boolean;
  valorTotal: Centavos;
  notaEntradaId: string | null;
};

export async function registrarRecebimentoNaTransacao(
  tx: Tx,
  ctx: ContextoSessao,
  dados: DadosDaConferencia,
): Promise<RecebimentoRegistrado> {
  exigirReceber(ctx);
  const loja = lojaAtiva(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(dados.chave)) {
    throw new Error(
      "A conferência perdeu a identificação. Recarregue a tela e confira de novo.",
    );
  }

  const pedido = await travarPedido(tx, dados.pedidoId);
  if (
    !pedido ||
    pedido.organizacaoId !== ctx.organizacao.id ||
    pedido.unidadeId !== loja.id
  ) {
    throw new Error("Pedido não encontrado nesta loja.");
  }
  const numeroRaiz = pedido.pedidoOrigemId
    ? (
        await tx.pedido.findUniqueOrThrow({
          where: { id: pedido.pedidoOrigemId },
          select: { numero: true },
        })
      ).numero
    : pedido.numero;
  const referencia = referenciaDoPedido(numeroRaiz, pedido.sequencia);

  // A chave é conferida DEPOIS da trava: se o mesmo envio chegou duas vezes,
  // o segundo esperou o primeiro terminar e agora o encontra aqui.
  const existente = await tx.recebimento.findUnique({
    where: { chave: dados.chave },
    select: { id: true, pedidoId: true, numero: true, notaEntradaId: true },
  });
  if (existente) {
    if (existente.pedidoId !== dados.pedidoId) {
      throw new Error(
        "Esta conferência pertence a outro pedido. Recarregue a tela.",
      );
    }
    return {
      jaExistia: true,
      recebimentoId: existente.id,
      pedidoId: pedido.id,
      unidadeId: pedido.unidadeId,
      fornecedorId: pedido.fornecedorId,
      referencia,
      numero: existente.numero,
      entradas: [],
      linhas: [],
      completo: false,
      valorTotal: 0n,
      notaEntradaId: existente.notaEntradaId,
    };
  }

  if (pedido.status !== "APROVADO") {
    throw new Error(
      pedido.status === "CONCLUIDO"
        ? "Este pedido já foi recebido por completo."
        : "Este pedido não está aberto para receber.",
    );
  }

  const itens = await tx.itemDePedido.findMany({
    where: { pedidoId: pedido.id },
    orderBy: { ordem: "asc" },
    include: {
      itensRecebidos: {
        select: {
          quantidadeBoa: true,
          recebimento: { select: { tipo: true } },
        },
      },
    },
  });
  const linhas = linhasDoPedido(itens);
  const r = conferir(linhas, dados.informados);
  if (!r.ok) throw new ConferenciaInvalida(r.erros);

  const substitutos = [
    ...new Set(
      r.entradas
        .filter((e) => e.substituicao && e.decisaoSubstituicao === "ACEITAR")
        .map((e) => e.insumoId),
    ),
  ];
  if (substitutos.length > 0) {
    const achados = await tx.insumo.count({
      where: {
        id: { in: substitutos },
        organizacaoId: ctx.organizacao.id,
        excluidoEm: null,
      },
    });
    if (achados !== substitutos.length)
      throw new Error("O insumo que veio no lugar não foi encontrado.");
  }

  const numero =
    (await tx.recebimento.count({
      where: { pedidoId: pedido.id, tipo: "ENTRADA" },
    })) + 1;

  const recebimento = await tx.recebimento.create({
    data: {
      organizacaoId: ctx.organizacao.id,
      unidadeId: pedido.unidadeId,
      pedidoId: pedido.id,
      tipo: "ENTRADA",
      numero,
      chave: dados.chave,
      recebidoPorId: ctx.usuario.id,
      recebidaEm: dados.recebidaEm,
      localDestinoId: dados.localDestinoId,
      numeroNota: dados.numeroNota,
      serieNota: dados.serieNota,
      chaveAcesso: dados.chaveAcesso,
      valorConferido: paraDecimal(r.valorTotal, CASAS.centavos),
      observacao: dados.observacao,
      itens: {
        create: r.entradas.map((e) => {
          const item = itens.find((i) => i.id === e.itemDePedidoId)!;
          return {
            itemDePedidoId: e.itemDePedidoId,
            insumoId: e.insumoId,
            embalagensBoas: paraDecimal(e.embalagensBoas, CASAS.milesimos),
            embalagensAvariada: paraDecimal(
              e.embalagensAvariadas,
              CASAS.milesimos,
            ),
            quantidadeBoa: paraDecimal(e.quantidadeBoa, CASAS.milesimos),
            quantidadeAvariada: paraDecimal(
              e.quantidadeAvariada,
              CASAS.milesimos,
            ),
            quantidadeRecusada: paraDecimal(
              e.quantidadeRecusada,
              CASAS.milesimos,
            ),
            fatorConversao: item.fatorConversao,
            valorUnitario: item.precoUnitario,
            valorTotal: paraDecimal(e.valorTotal, CASAS.centavos),
            decisaoExcedente: e.decisaoExcedente,
            substituicao: e.substituicao,
            decisaoSubstituicao: e.decisaoSubstituicao,
            lote: e.lote,
            validade: e.validade,
            observacao: e.observacao,
            fotoIds: e.fotoIds,
          };
        }),
      },
    },
    select: { id: true },
  });

  await vincularArquivos(
    tx,
    r.entradas.flatMap((e) => e.fotoIds),
    {
      organizacaoId: ctx.organizacao.id,
      enviadoPorId: ctx.usuario.id,
      entidade: "Recebimento",
      entidadeId: recebimento.id,
    },
  );

  if (r.divergencias.length > 0) {
    await tx.divergenciaDeCompra.createMany({
      data: r.divergencias.map((d) => ({
        organizacaoId: ctx.organizacao.id,
        unidadeId: pedido.unidadeId,
        pedidoId: pedido.id,
        recebimentoId: recebimento.id,
        itemDePedidoId: d.itemDePedidoId,
        tipo: d.tipo,
        detalhe: d.detalhe,
        quantidade: paraDecimal(d.quantidade, CASAS.milesimos),
        impacto: paraDecimal(d.impacto, CASAS.centavos),
        criadoPorId: ctx.usuario.id,
      })),
    });
  }

  await registrar(tx, ctx, {
    entidade: "Recebimento",
    entidadeId: recebimento.id,
    acao: "CRIOU",
    unidadeId: pedido.unidadeId,
    depois: {
      pedido: referencia,
      entrega: numero,
      valor: r.valorTotal,
      completo: r.completo,
      divergencias: r.divergencias.map((d) => d.tipo),
    },
  });

  return {
    jaExistia: false,
    recebimentoId: recebimento.id,
    pedidoId: pedido.id,
    unidadeId: pedido.unidadeId,
    fornecedorId: pedido.fornecedorId,
    referencia,
    numero,
    entradas: r.entradas,
    linhas,
    completo: r.completo,
    valorTotal: r.valorTotal,
    notaEntradaId: null,
  };
}

/** As linhas da nota de entrada que o recebimento cria — só o que entrou BOM. */
export function itensParaNota(r: RecebimentoRegistrado) {
  return r.entradas
    .filter((e) => e.quantidadeBoa > 0n)
    .map((e) => {
      const l = r.linhas.find((x) => x.itemDePedidoId === e.itemDePedidoId)!;
      const quantidadeNota = l.fracionavel
        ? e.quantidadeBoa
        : dividirArredondando(e.quantidadeBoa * 10_000n, l.fator);
      return {
        insumoId: e.insumoId,
        quantidadeNota: paraDecimal(quantidadeNota, CASAS.milesimos),
        fatorConversao: paraDecimal(l.fator, CASAS.dezMilesimos),
        quantidade: paraDecimal(e.quantidadeBoa, CASAS.milesimos),
        // Por unidade de estoque, 4 casas: valor ÷ quantidade.
        valorUnitario: paraDecimal(
          dividirArredondando(e.valorTotal * 100_000n, e.quantidadeBoa),
          4,
        ),
        valorTotal: paraDecimal(e.valorTotal, CASAS.centavos),
      };
    });
}

/**
 * Nota já lançada à mão: o estoque já recebeu pelo papel. O que a conferência
 * contou e a nota disse, quando diferente, vira divergência para conciliar —
 * nunca uma segunda entrada.
 */
export async function divergenciasDaNota(
  tx: Tx,
  ctx: ContextoSessao,
  r: RecebimentoRegistrado,
  notaId: string,
  nota: {
    valorTotal: string;
    itens: { insumoId: string; quantidade: string; valorTotal: string }[];
  },
): Promise<void> {
  const novas: Prisma.DivergenciaDeCompraCreateManyInput[] = [];
  const insumos = new Set([
    ...nota.itens.map((i) => i.insumoId),
    ...r.entradas.map((e) => e.insumoId),
  ]);
  const nomes = new Map(
    r.linhas.map((l) => [l.insumoId, { nome: l.nome, unidade: l.unidade }]),
  );

  for (const insumoId of insumos) {
    const naNota = nota.itens
      .filter((i) => i.insumoId === insumoId)
      .reduce((s, i) => s + milesimosDoBanco(i.quantidade), 0n);
    const contado = r.entradas
      .filter((e) => e.insumoId === insumoId)
      .reduce((s, e) => s + e.quantidadeBoa, 0n);
    if (naNota !== contado) {
      const info = nomes.get(insumoId);
      const u = info?.unidade ?? "UN";
      novas.push({
        organizacaoId: ctx.organizacao.id,
        unidadeId: r.unidadeId,
        pedidoId: r.pedidoId,
        recebimentoId: r.recebimentoId,
        notaEntradaId: notaId,
        tipo: "NOTA_QUANTIDADE",
        detalhe: `${info?.nome ?? "Item"}: a nota diz ${quantidadeBr(naNota, u)}, a conferência contou ${quantidadeBr(contado, u)}. O estoque ficou com o da nota — concilie.`,
        quantidade: paraDecimal(contado - naNota, CASAS.milesimos),
        criadoPorId: ctx.usuario.id,
      });
    }
  }
  const valorNota = doBanco(nota.valorTotal, CASAS.centavos);
  if (valorNota !== r.valorTotal) {
    novas.push({
      organizacaoId: ctx.organizacao.id,
      unidadeId: r.unidadeId,
      pedidoId: r.pedidoId,
      recebimentoId: r.recebimentoId,
      notaEntradaId: notaId,
      tipo: "NOTA_VALOR",
      detalhe: `A nota soma ${reais(valorNota)}; pelo preço do pedido, o que chegou vale ${reais(r.valorTotal)}.`,
      impacto: paraDecimal(valorNota - r.valorTotal, CASAS.centavos),
      criadoPorId: ctx.usuario.id,
    });
  }
  if (novas.length > 0)
    await tx.divergenciaDeCompra.createMany({ data: novas });
}

/** O fim da transação: liga a nota e atualiza a situação do pedido. */
export async function concluirNaTransacao(
  tx: Tx,
  ctx: ContextoSessao,
  dados: {
    pedidoId: string;
    recebimentoId: string;
    notaEntradaId: string | null;
    notaVinculadaExistente: boolean;
    completo: boolean;
  },
): Promise<void> {
  if (dados.notaEntradaId) {
    await tx.recebimento.update({
      where: { id: dados.recebimentoId },
      data: {
        notaEntradaId: dados.notaEntradaId,
        notaVinculadaExistente: dados.notaVinculadaExistente,
      },
    });
    await tx.divergenciaDeCompra.updateMany({
      where: { recebimentoId: dados.recebimentoId, notaEntradaId: null },
      data: { notaEntradaId: dados.notaEntradaId },
    });
  }
  await tx.pedido.update({
    where: { id: dados.pedidoId },
    data: {
      situacaoRecebimento: dados.completo ? "COMPLETO" : "PARCIAL",
      ...(dados.completo
        ? { status: "CONCLUIDO", concluidoEm: new Date() }
        : {}),
      versao: { increment: 1 },
    },
  });
  if (dados.completo) {
    await registrar(tx, ctx, {
      entidade: "Pedido",
      entidadeId: dados.pedidoId,
      acao: "ALTEROU",
      depois: { status: "CONCLUIDO", motivo: "Tudo recebido." },
    });
  }
}

// ------------------------------------------------------------ ENCERRAR SALDO

/** "O fornecedor não vai entregar o resto." Conclui com o motivo, e o que faltou vira divergência. */
export async function encerrarSaldo(
  ctx: ContextoSessao,
  pedidoId: string,
  motivo: string,
): Promise<void> {
  if (!pode(ctx, "compras.receber") && !pode(ctx, "compras.pedir")) {
    throw new SemPermissao("encerrar o saldo do pedido");
  }
  const texto = motivo.trim();
  if (!texto) throw new Error("Diga por que o saldo está sendo encerrado.");

  await db.$transaction(async (tx) => {
    const pedido = await travarPedido(tx, pedidoId);
    if (
      !pedido ||
      pedido.organizacaoId !== ctx.organizacao.id ||
      !ctx.unidadesVisiveis.some((u) => u.id === pedido.unidadeId)
    ) {
      throw new Error("Pedido não encontrado.");
    }
    if (pedido.status !== "APROVADO")
      throw new Error("Este pedido não está em aberto.");

    const itens = await tx.itemDePedido.findMany({
      where: { pedidoId },
      include: {
        itensRecebidos: {
          select: {
            quantidadeBoa: true,
            recebimento: { select: { tipo: true } },
          },
        },
      },
    });
    const pendentes = linhasDoPedido(itens).filter(
      (l) => l.pedido > l.recebidoAntes,
    );

    if (pendentes.length > 0) {
      await tx.divergenciaDeCompra.createMany({
        data: pendentes.map((l) => {
          const falta = l.pedido - l.recebidoAntes;
          return {
            organizacaoId: ctx.organizacao.id,
            unidadeId: pedido.unidadeId,
            pedidoId,
            itemDePedidoId: l.itemDePedidoId,
            tipo: "SALDO_ENCERRADO" as const,
            detalhe: `${l.nome}: ${quantidadeBr(falta, l.unidade)} não vieram. ${texto}`,
            quantidade: paraDecimal(falta, CASAS.milesimos),
            impacto: paraDecimal(
              -totalFracionado(falta, l.precoEmbalagem, l.fator),
              CASAS.centavos,
            ),
            criadoPorId: ctx.usuario.id,
          };
        }),
      });
    }
    await tx.pedido.update({
      where: { id: pedidoId },
      data: {
        status: "CONCLUIDO",
        concluidoEm: new Date(),
        versao: { increment: 1 },
      },
    });
    await registrar(tx, ctx, {
      entidade: "Pedido",
      entidadeId: pedidoId,
      acao: "ALTEROU",
      unidadeId: pedido.unidadeId,
      depois: {
        status: "CONCLUIDO",
        saldoEncerrado: true,
        motivo: texto,
        linhas: pendentes.length,
      },
    });
  });
}

// ---------------------------------------------------------------- DEVOLUÇÃO

export type DadosDaDevolucao = {
  recebimentoId: string;
  chave: string;
  motivo: string;
  linhas: { itemDeRecebimentoId: string; quantidade: string }[];
};

/**
 * Devolver o que JÁ ENTROU. É um recebimento do tipo DEVOLUÇÃO — a entrada
 * original não é apagada nem editada. O orquestrador baixa o estoque (movimento
 * DEVOLUCAO, do Estoque) na mesma transação.
 */
export async function registrarDevolucaoNaTransacao(
  tx: Tx,
  ctx: ContextoSessao,
  dados: DadosDaDevolucao,
): Promise<{
  jaExistia: boolean;
  devolucaoId: string;
  unidadeId: string;
  localId: string | null;
  itens: { insumoId: string; quantidade: string; custoUnitario: string }[];
}> {
  exigirReceber(ctx);
  const loja = lojaAtiva(ctx);
  const motivo = dados.motivo.trim();
  if (!motivo)
    throw new Error("Diga por que a mercadoria está sendo devolvida.");
  if (!/^[0-9a-f-]{36}$/i.test(dados.chave))
    throw new Error("Recarregue a tela e tente de novo.");

  const origem = await tx.recebimento.findFirst({
    where: {
      id: dados.recebimentoId,
      organizacaoId: ctx.organizacao.id,
      unidadeId: loja.id,
      tipo: "ENTRADA",
    },
    include: {
      itens: {
        include: {
          itemDePedido: { select: { insumoNome: true, unidadeEstoque: true } },
        },
      },
    },
  });
  if (!origem) throw new Error("Recebimento não encontrado nesta loja.");

  const pedido = await travarPedido(tx, origem.pedidoId);
  if (!pedido) throw new Error("Pedido não encontrado.");

  const existente = await tx.recebimento.findUnique({
    where: { chave: dados.chave },
  });
  if (existente) {
    return {
      jaExistia: true,
      devolucaoId: existente.id,
      unidadeId: existente.unidadeId,
      localId: existente.localDestinoId,
      itens: [],
    };
  }

  const movimentados = await tx.itemDeRecebimento.findMany({
    where: { recebimento: { pedidoId: origem.pedidoId } },
    select: {
      itemDePedidoId: true,
      insumoId: true,
      quantidadeBoa: true,
      recebimento: { select: { tipo: true } },
    },
  });

  const linhas: {
    item: (typeof origem.itens)[number];
    quantidade: Milesimos;
    valor: Centavos;
  }[] = [];
  for (const l of dados.linhas) {
    const item = origem.itens.find((i) => i.id === l.itemDeRecebimentoId);
    if (!item) throw new Error("Linha não pertence a este recebimento.");
    let q: Milesimos | null;
    try {
      q = milesimosDigitados(l.quantidade);
    } catch (erro) {
      if (erro instanceof NumeroInvalido) throw new Error(erro.message);
      throw erro;
    }
    if (q === null || q <= 0n)
      throw new Error("Quantidade da devolução precisa ser maior que zero.");

    const mesmo = (m: (typeof movimentados)[number]) =>
      m.itemDePedidoId === item.itemDePedidoId && m.insumoId === item.insumoId;
    const entrou = movimentados
      .filter((m) => mesmo(m) && m.recebimento.tipo === "ENTRADA")
      .reduce((s, m) => s + milesimosDoBanco(m.quantidadeBoa), 0n);
    const voltou = movimentados
      .filter((m) => mesmo(m) && m.recebimento.tipo === "DEVOLUCAO")
      .reduce((s, m) => s + milesimosDoBanco(m.quantidadeBoa), 0n);
    if (voltou + q > entrou) {
      throw new Error("Não dá para devolver mais do que entrou.");
    }
    const micros = doBanco(item.valorUnitario, CASAS.micros);
    linhas.push({
      item,
      quantidade: q,
      valor: dividirArredondando(q * micros, 10_000_000n),
    });
  }
  if (linhas.length === 0) throw new Error("Escolha o que volta.");

  const numero =
    (await tx.recebimento.count({
      where: { pedidoId: origem.pedidoId, tipo: "DEVOLUCAO" },
    })) + 1;
  const total = linhas.reduce((s, l) => s + l.valor, 0n);

  const devolucao = await tx.recebimento.create({
    data: {
      organizacaoId: ctx.organizacao.id,
      unidadeId: origem.unidadeId,
      pedidoId: origem.pedidoId,
      tipo: "DEVOLUCAO",
      numero,
      chave: dados.chave,
      recebidoPorId: ctx.usuario.id,
      recebidaEm: new Date(),
      localDestinoId: origem.localDestinoId,
      notaEntradaId: origem.notaEntradaId,
      valorConferido: paraDecimal(total, CASAS.centavos),
      motivo: motivo.slice(0, 300),
      itens: {
        create: linhas.map((l) => {
          const fator = fatorDoBanco(l.item.fatorConversao);
          return {
            itemDePedidoId: l.item.itemDePedidoId,
            insumoId: l.item.insumoId,
            embalagensBoas: paraDecimal(
              dividirArredondando(l.quantidade * 10_000n, fator),
              CASAS.milesimos,
            ),
            quantidadeBoa: paraDecimal(l.quantidade, CASAS.milesimos),
            fatorConversao: l.item.fatorConversao,
            valorUnitario: l.item.valorUnitario,
            valorTotal: paraDecimal(l.valor, CASAS.centavos),
          };
        }),
      },
    },
    select: { id: true },
  });

  await tx.divergenciaDeCompra.createMany({
    data: linhas.map((l) => ({
      organizacaoId: ctx.organizacao.id,
      unidadeId: origem.unidadeId,
      pedidoId: origem.pedidoId,
      recebimentoId: devolucao.id,
      itemDePedidoId: l.item.itemDePedidoId,
      notaEntradaId: origem.notaEntradaId,
      tipo: "DEVOLUCAO" as const,
      detalhe: `${l.item.itemDePedido.insumoNome}: ${quantidadeBr(l.quantidade, l.item.itemDePedido.unidadeEstoque)} devolvidos depois da entrada — ${motivo}. Ajuste a conta com o fornecedor.`,
      quantidade: paraDecimal(l.quantidade, CASAS.milesimos),
      impacto: paraDecimal(-l.valor, CASAS.centavos),
      criadoPorId: ctx.usuario.id,
    })),
  });

  await registrar(tx, ctx, {
    entidade: "Recebimento",
    entidadeId: devolucao.id,
    acao: "CRIOU",
    unidadeId: origem.unidadeId,
    depois: { devolucaoDe: origem.id, valor: total, motivo },
  });

  return {
    jaExistia: false,
    devolucaoId: devolucao.id,
    unidadeId: origem.unidadeId,
    localId: origem.localDestinoId,
    itens: linhas.map((l) => ({
      insumoId: l.item.insumoId,
      quantidade: paraDecimal(l.quantidade, CASAS.milesimos),
      custoUnitario: paraDecimal(
        dividirArredondando(doBanco(l.item.valorUnitario, CASAS.micros), 100n),
        4,
      ),
    })),
  };
}
