import type { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  CASAS,
  NumeroInvalido,
  milesimosDigitados,
  milesimosDoBanco,
  paraDecimal,
  type Milesimos,
} from "../schemas/aritmetica";
import { sugerirCompra, type Sugestao } from "../schemas/sugestao";

import { registrar } from "./auditoria";

/**
 * A REQUISIÇÃO DA LOJA.
 *
 * O que UMA loja precisa numa rodada, na unidade de ESTOQUE. A loja vê só a
 * sua: a requisição é sempre procurada pela loja ATIVA do contexto, e um id de
 * outra loja simplesmente não é encontrado.
 *
 * Duas travas contra corrida, e as duas estão no banco:
 *
 *   EDITAR DEPOIS DE ENVIAR — toda gravação sobe a versão da requisição com
 *   uma escrita condicional ao status (RASCUNHO ou DEVOLVIDA). Se o envio
 *   ganhou a corrida, a edição afeta zero linhas e é recusada.
 *
 *   ENVIAR DURANTE A CONSOLIDAÇÃO — a gravação trava a rodada para leitura
 *   (`FOR SHARE`); a consolidação a trava para escrita (`FOR UPDATE`). Uma
 *   espera a outra, e nenhuma quantidade fica enviada-mas-não-somada.
 */

export class RequisicaoMudou extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RequisicaoMudou";
  }
}

const EDITAVEIS = ["RASCUNHO", "DEVOLVIDA"] as const;

function lojaAtiva(ctx: ContextoSessao) {
  if (!ctx.unidadeAtiva) throw new ExigeUnidade();
  return ctx.unidadeAtiva;
}

function exigir(ctx: ContextoSessao, chave: string, acao: string) {
  if (!pode(ctx, chave)) throw new SemPermissao(acao);
}

type Cliente = Prisma.TransactionClient | typeof db;

async function daLoja(ctx: ContextoSessao, requisicaoId: string, cliente: Cliente) {
  const loja = lojaAtiva(ctx);
  const requisicao = await cliente.requisicao.findFirst({
    where: {
      id: requisicaoId,
      organizacaoId: ctx.organizacao.id,
      unidadeId: loja.id,
    },
    select: { id: true, rodadaId: true, status: true, versao: true, unidadeId: true },
  });
  if (!requisicao) throw new Error("Requisição não encontrada nesta loja.");
  return requisicao;
}

async function travarRodada(tx: Prisma.TransactionClient, rodadaId: string) {
  const [rodada] = await tx.$queryRaw<{ estado: string }[]>`
    SELECT "estado" FROM "rodada_de_compra" WHERE "id" = ${rodadaId} FOR SHARE`;
  if (!rodada) throw new Error("Rodada não encontrada.");
  return rodada.estado;
}

// ------------------------------------------------------------------ LEITURA

export type RequisicaoCompleta = NonNullable<
  Awaited<ReturnType<typeof requisicaoDaLoja>>
>;

export async function requisicaoDaLoja(ctx: ContextoSessao, rodadaId: string) {
  exigir(ctx, "compras.ver", "ver compras");
  const loja = lojaAtiva(ctx);

  const requisicao = await db.requisicao.findFirst({
    where: { rodadaId, unidadeId: loja.id, organizacaoId: ctx.organizacao.id },
    include: {
      rodada: {
        select: {
          id: true,
          numero: true,
          descricao: true,
          estado: true,
          prazoRequisicao: true,
        },
      },
      itens: {
        orderBy: { criadoEm: "asc" },
        include: {
          insumo: {
            select: {
              nome: true,
              unidadeMedida: true,
              unidadeRotulo: true,
              categoria: true,
            },
          },
        },
      },
    },
  });
  if (!requisicao) return null;

  return {
    id: requisicao.id,
    status: requisicao.status,
    versao: requisicao.versao,
    loja: loja.nome,
    motivoDevolucao: requisicao.motivoDevolucao,
    enviadaEm: requisicao.enviadaEm,
    rodada: requisicao.rodada,
    editavel:
      (EDITAVEIS as readonly string[]).includes(requisicao.status) &&
      ["RASCUNHO", "COLETANDO"].includes(requisicao.rodada.estado),
    itens: requisicao.itens.map((i) => ({
      id: i.id,
      insumoId: i.insumoId,
      nome: i.insumo.nome,
      unidade: i.insumo.unidadeMedida,
      rotulo: i.insumo.unidadeRotulo,
      categoria: i.categoria ?? i.insumo.categoria,
      quantidade: i.quantidade.toString(),
      embalagemPreferida: i.embalagemPreferida,
      fatorConhecido: i.fatorConhecido?.toString() ?? null,
      observacao: i.observacao,
      sugestaoQuantidade: i.sugestaoQuantidade?.toString() ?? null,
      sugestaoFormula: i.sugestaoFormula,
      alertas: i.alertas,
    })),
  };
}

type EntradaCalculada = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  rotulo: string | null;
  minimo: Milesimos | null;
  disponivel: Milesimos | null;
  emPedidoAberto: Milesimos;
  ultimaAtualizacao: Date | null;
  embalagens: { nome: string; fator: string; padrao: boolean }[];
};

/**
 * Os números de que a sugestão precisa, lidos do Estoque e de Compras.
 *
 * Ler tabela de outro App é permitido (o Financeiro já lê `nota_entrada`);
 * escrever, nunca. O saldo é a mesma soma que a Despensa mostra, e o mínimo é
 * o mesmo campo — dois lugares do sistema não podem responder números
 * diferentes para a mesma pergunta.
 */
async function entradasDaSugestao(
  organizacaoId: string,
  unidadeId: string,
  insumoIds?: string[],
): Promise<EntradaCalculada[]> {
  const filtro = insumoIds ? { id: { in: insumoIds } } : {};
  const [insumos, posicoes, abertos] = await Promise.all([
    db.insumo.findMany({
      where: { organizacaoId, excluidoEm: null, ativo: true, ...filtro },
      select: {
        id: true,
        nome: true,
        categoria: true,
        unidadeMedida: true,
        unidadeRotulo: true,
        estoqueMinimo: true,
        embalagens: {
          where: { ativo: true },
          select: { nome: true, fator: true, padrao: true },
          orderBy: [{ padrao: "desc" }, { nome: "asc" }],
        },
      },
      orderBy: { nome: "asc" },
    }),
    db.posicaoEstoque.findMany({
      where: {
        unidadeId,
        ...(insumoIds ? { insumoId: { in: insumoIds } } : {}),
      },
      select: { insumoId: true, quantidade: true, atualizadoEm: true },
    }),
    db.itemDePedido.findMany({
      where: {
        pedido: { unidadeId, status: "APROVADO" },
        ...(insumoIds ? { insumoId: { in: insumoIds } } : {}),
      },
      select: {
        insumoId: true,
        quantidade: true,
        quantidadeCancelada: true,
        itensRecebidos: {
          where: { recebimento: { tipo: "ENTRADA" } },
          select: { quantidadeBoa: true },
        },
      },
    }),
  ]);

  const saldo = new Map<string, { total: Milesimos; quando: Date }>();
  for (const p of posicoes) {
    const atual = saldo.get(p.insumoId);
    saldo.set(p.insumoId, {
      total: (atual?.total ?? 0n) + milesimosDoBanco(p.quantidade),
      quando:
        atual && atual.quando > p.atualizadoEm ? atual.quando : p.atualizadoEm,
    });
  }

  const emPedido = new Map<string, Milesimos>();
  for (const linha of abertos) {
    const pedido =
      milesimosDoBanco(linha.quantidade) -
      milesimosDoBanco(linha.quantidadeCancelada);
    const recebido = linha.itensRecebidos.reduce(
      (s, r) => s + milesimosDoBanco(r.quantidadeBoa),
      0n,
    );
    const falta = pedido - recebido;
    if (falta > 0n) {
      emPedido.set(linha.insumoId, (emPedido.get(linha.insumoId) ?? 0n) + falta);
    }
  }

  return insumos.map((i) => {
    const minimo = milesimosDoBanco(i.estoqueMinimo);
    const s = saldo.get(i.id);
    return {
      insumoId: i.id,
      nome: i.nome,
      categoria: i.categoria,
      unidade: i.unidadeMedida,
      rotulo: i.unidadeRotulo,
      // Mínimo zero é "não cadastrado", como na Despensa.
      minimo: minimo > 0n ? minimo : null,
      disponivel: s ? s.total : null,
      emPedidoAberto: emPedido.get(i.id) ?? 0n,
      ultimaAtualizacao: s?.quando ?? null,
      embalagens: i.embalagens.map((e) => ({
        nome: e.nome,
        fator: e.fator.toString(),
        padrao: e.padrao,
      })),
    };
  });
}

function calcular(e: EntradaCalculada, agora: Date): Sugestao {
  return sugerirCompra({
    minimo: e.minimo,
    disponivel: e.disponivel,
    emPedidoAberto: e.emPedidoAberto,
    ultimaAtualizacao: e.ultimaAtualizacao,
    agora,
    unidade: e.rotulo ?? e.unidade,
  });
}

export type LinhaSugerida = Awaited<ReturnType<typeof sugestoesDaLoja>>[number];

/** Todos os insumos, com a sugestão de cada um para ESTA loja. */
export async function sugestoesDaLoja(ctx: ContextoSessao) {
  exigir(ctx, "compras.ver", "ver compras");
  const loja = lojaAtiva(ctx);
  const agora = new Date();

  const entradas = await entradasDaSugestao(ctx.organizacao.id, loja.id);
  return entradas.map((e) => {
    const s = calcular(e, agora);
    return {
      insumoId: e.insumoId,
      nome: e.nome,
      categoria: e.categoria,
      unidade: e.unidade,
      rotulo: e.rotulo,
      minimo: e.minimo === null ? null : paraDecimal(e.minimo, CASAS.milesimos),
      disponivel:
        e.disponivel === null ? null : paraDecimal(e.disponivel, CASAS.milesimos),
      emPedidoAberto: paraDecimal(e.emPedidoAberto, CASAS.milesimos),
      sugestao: {
        quantidade:
          s.quantidade === null ? null : paraDecimal(s.quantidade, CASAS.milesimos),
        formula: s.formula,
        alertas: s.alertas,
      },
      embalagens: e.embalagens,
    };
  });
}

// ------------------------------------------------------------------- ESCRITA

function lerQuantidade(texto: string): Milesimos {
  let q: Milesimos | null;
  try {
    q = milesimosDigitados(texto);
  } catch (erro) {
    if (erro instanceof NumeroInvalido) throw new Error(erro.message);
    throw erro;
  }
  // Vazio não é zero, e zero não é compra: um item sem quantidade é uma
  // decisão que ainda não foi tomada.
  if (q === null || q <= 0n) {
    throw new Error("Informe uma quantidade maior que zero, na unidade de estoque.");
  }
  return q;
}

export async function salvarItem(
  ctx: ContextoSessao,
  requisicaoId: string,
  dados: {
    insumoId: string;
    quantidade: string;
    embalagemPreferida: string | null;
    observacao: string | null;
  },
): Promise<void> {
  exigir(ctx, "compras.requisitar", "preparar a requisição da loja");
  const loja = lojaAtiva(ctx);
  const quantidade = lerQuantidade(dados.quantidade);

  // A sugestão é recalculada AQUI. O que veio da tela não é gravado como se
  // fosse do sistema — só o número que a pessoa escolheu.
  const [entrada] = await entradasDaSugestao(ctx.organizacao.id, loja.id, [
    dados.insumoId,
  ]);
  if (!entrada) throw new Error("Insumo não encontrado ou desativado.");
  const sugestao = calcular(entrada, new Date());

  const embalagem = dados.embalagemPreferida
    ? entrada.embalagens.find((e) => e.nome === dados.embalagemPreferida)
    : undefined;

  const observacao = dados.observacao?.trim().slice(0, 300) || null;

  await db.$transaction(async (tx) => {
    const requisicao = await daLoja(ctx, requisicaoId, tx);
    const estado = await travarRodada(tx, requisicao.rodadaId);
    if (!["RASCUNHO", "COLETANDO"].includes(estado)) {
      throw new Error(
        "A coleta desta rodada já terminou e a lista foi consolidada. Para acrescentar, peça um adendo a quem cuida das compras.",
      );
    }

    const versao = await tx.requisicao.updateMany({
      where: { id: requisicao.id, status: { in: [...EDITAVEIS] } },
      data: { versao: { increment: 1 } },
    });
    if (versao.count !== 1) {
      throw new RequisicaoMudou(
        "Esta requisição já foi enviada e não aceita mudanças.",
      );
    }

    const campos = {
      quantidade: paraDecimal(quantidade, CASAS.milesimos),
      embalagemPreferida: embalagem?.nome ?? null,
      fatorConhecido: embalagem?.fator ?? null,
      categoria: entrada.categoria,
      observacao,
      sugestaoQuantidade:
        sugestao.quantidade === null
          ? null
          : paraDecimal(sugestao.quantidade, CASAS.milesimos),
      sugestaoFormula: sugestao.formula,
      alertas: sugestao.alertas,
    };

    await tx.itemDeRequisicao.upsert({
      where: {
        requisicaoId_insumoId: {
          requisicaoId: requisicao.id,
          insumoId: dados.insumoId,
        },
      },
      create: {
        requisicaoId: requisicao.id,
        unidadeId: requisicao.unidadeId,
        insumoId: dados.insumoId,
        criadoPorId: ctx.usuario.id,
        ...campos,
      },
      update: campos,
    });
  });
}

export async function removerItem(
  ctx: ContextoSessao,
  requisicaoId: string,
  itemId: string,
): Promise<void> {
  exigir(ctx, "compras.requisitar", "preparar a requisição da loja");

  await db.$transaction(async (tx) => {
    const requisicao = await daLoja(ctx, requisicaoId, tx);
    const estado = await travarRodada(tx, requisicao.rodadaId);
    if (!["RASCUNHO", "COLETANDO"].includes(estado)) {
      throw new Error("A coleta desta rodada já terminou.");
    }
    const versao = await tx.requisicao.updateMany({
      where: { id: requisicao.id, status: { in: [...EDITAVEIS] } },
      data: { versao: { increment: 1 } },
    });
    if (versao.count !== 1) {
      throw new RequisicaoMudou("Esta requisição já foi enviada e não aceita mudanças.");
    }
    await tx.itemDeRequisicao.deleteMany({
      where: { id: itemId, requisicaoId: requisicao.id },
    });
  });
}

/** Enviar requisição: a loja termina a lista dela. */
export async function enviarRequisicao(
  ctx: ContextoSessao,
  requisicaoId: string,
  versao: number,
): Promise<void> {
  exigir(ctx, "compras.requisitar", "enviar a requisição da loja");

  await db.$transaction(async (tx) => {
    const requisicao = await daLoja(ctx, requisicaoId, tx);
    const estado = await travarRodada(tx, requisicao.rodadaId);
    if (estado === "RASCUNHO") {
      throw new Error(
        "A rodada ainda está em rascunho. A lista fica salva; envie quando o comprador abrir a coleta.",
      );
    }
    if (estado !== "COLETANDO") {
      throw new Error(
        "A coleta desta rodada já terminou e a lista foi consolidada sem esta requisição. Fale com quem cuida das compras.",
      );
    }

    const itens = await tx.itemDeRequisicao.count({
      where: { requisicaoId: requisicao.id },
    });
    if (itens === 0) {
      throw new Error("A requisição está vazia. Acrescente ao menos um item.");
    }

    const escrita = await tx.requisicao.updateMany({
      where: { id: requisicao.id, versao, status: { in: [...EDITAVEIS] } },
      data: {
        status: "ENVIADA",
        versao: { increment: 1 },
        enviadaEm: new Date(),
        enviadaPorId: ctx.usuario.id,
      },
    });
    if (escrita.count !== 1) {
      throw new RequisicaoMudou(
        "A requisição mudou enquanto você olhava — alguém acrescentou item ou já enviou. Recarregue e confira antes de enviar.",
      );
    }

    await registrar(tx, ctx, {
      entidade: "Requisicao",
      entidadeId: requisicao.id,
      acao: "ALTEROU",
      unidadeId: requisicao.unidadeId,
      antes: { status: requisicao.status },
      depois: { status: "ENVIADA", itens },
    });
  });
}

/** O comprador devolve a requisição para a loja corrigir. */
export async function devolverRequisicao(
  ctx: ContextoSessao,
  requisicaoId: string,
  motivo: string,
): Promise<void> {
  exigir(ctx, "compras.rodadas", "devolver requisições");
  const texto = motivo.trim();
  if (!texto) throw new Error("Diga à loja o que corrigir — o motivo vai junto.");

  await db.$transaction(async (tx) => {
    const requisicao = await tx.requisicao.findFirst({
      where: {
        id: requisicaoId,
        organizacaoId: ctx.organizacao.id,
        unidadeId: { in: ctx.unidadesVisiveis.map((u) => u.id) },
      },
      select: { id: true, rodadaId: true, unidadeId: true },
    });
    if (!requisicao) throw new Error("Requisição não encontrada.");
    const estado = await travarRodada(tx, requisicao.rodadaId);
    if (estado !== "COLETANDO") {
      throw new Error("Só dá para devolver enquanto a rodada coleta requisições.");
    }
    const escrita = await tx.requisicao.updateMany({
      where: { id: requisicao.id, status: "ENVIADA" },
      data: {
        status: "DEVOLVIDA",
        versao: { increment: 1 },
        devolvidaEm: new Date(),
        devolvidaPorId: ctx.usuario.id,
        motivoDevolucao: texto.slice(0, 300),
      },
    });
    if (escrita.count !== 1) {
      throw new Error("Esta requisição não está enviada — não há o que devolver.");
    }
    await registrar(tx, ctx, {
      entidade: "Requisicao",
      entidadeId: requisicao.id,
      acao: "ALTEROU",
      unidadeId: requisicao.unidadeId,
      antes: { status: "ENVIADA" },
      depois: { status: "DEVOLVIDA", motivo: texto },
    });
  });
}

/**
 * A lista da Despensa entra na requisição da loja, na rodada aberta mais
 * recente. Todas as quantidades são validadas ANTES de gravar a primeira —
 * uma lista com um item ruim não entra pela metade.
 */
export async function adicionarDaDespensa(
  ctx: ContextoSessao,
  itens: { insumoId: string; quantidade: string; origem: string | null }[],
): Promise<{ rodadaId: string; requisicaoId: string; gravados: number }> {
  exigir(ctx, "compras.requisitar", "levar a lista para a requisição");
  const loja = lojaAtiva(ctx);

  for (const item of itens) lerQuantidade(item.quantidade);

  const requisicao = await db.requisicao.findFirst({
    where: {
      organizacaoId: ctx.organizacao.id,
      unidadeId: loja.id,
      status: { in: [...EDITAVEIS] },
      rodada: { estado: { in: ["RASCUNHO", "COLETANDO"] } },
    },
    orderBy: { rodada: { numero: "desc" } },
    select: { id: true, rodadaId: true },
  });
  if (!requisicao) {
    throw new Error(
      "Nenhuma rodada de compra está aberta para esta loja. Peça a quem cuida das compras para abrir uma.",
    );
  }

  for (const item of itens) {
    await salvarItem(ctx, requisicao.id, {
      insumoId: item.insumoId,
      quantidade: item.quantidade,
      embalagemPreferida: null,
      observacao: item.origem ? `Da Despensa: ${item.origem}` : "Da Despensa",
    });
  }

  return {
    rodadaId: requisicao.rodadaId,
    requisicaoId: requisicao.id,
    gravados: itens.length,
  };
}
