import type { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { CASAS, milesimosDoBanco, paraDecimal } from "../schemas/aritmetica";
import {
  ROTULO_DO_ESTADO,
  transicaoPermitida,
  type EstadoDaRodada,
} from "../schemas/rodada";

import { registrar, ultimaMudanca } from "./auditoria";
import {
  encerrarCotacaoNaTransacao,
  prepararSolicitacoesNaTransacao,
  reabrirCotacaoNaTransacao,
} from "./solicitacoes";

/**
 * AS RODADAS DE COMPRA.
 *
 * Pertencem à ORGANIZAÇÃO — é aqui que a matriz consolida as lojas. Toda
 * mudança de estado é uma escrita CONDICIONAL à versão que a pessoa tinha na
 * tela: dois cliques ao mesmo tempo viram uma transição e uma recusa, nunca
 * duas transições.
 *
 * A transição trava a linha da rodada (`FOR UPDATE`). A loja que envia a
 * requisição trava a mesma linha para leitura (`FOR SHARE`) — então a
 * consolidação nunca acontece "no meio" de um envio: ou o envio entra antes
 * e é somado, ou chega depois e é recusado com uma frase.
 */

export class RodadaMudou extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RodadaMudou";
  }
}

const hora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function exigir(ctx: ContextoSessao, chave: string, acao: string) {
  if (!pode(ctx, chave)) throw new SemPermissao(acao);
}

export type DadosDaRodada = {
  descricao: string;
  unidadeIds: string[];
  prazoRequisicao: Date | null;
  prazoCotacao: Date | null;
  entregaDe: Date | null;
  entregaAte: Date | null;
  responsavelId: string | null;
  observacao: string | null;
};

export async function criarRodada(
  ctx: ContextoSessao,
  dados: DadosDaRodada,
): Promise<{ id: string; numero: number }> {
  exigir(ctx, "compras.rodadas", "criar rodadas de compra");

  const visiveis = new Set(ctx.unidadesVisiveis.map((u) => u.id));
  const lojas = [...new Set(dados.unidadeIds)];
  if (lojas.length === 0) {
    throw new Error("Escolha ao menos uma loja para participar da rodada.");
  }
  if (lojas.some((id) => !visiveis.has(id))) {
    throw new SemPermissao("incluir uma loja que você não enxerga");
  }
  if (
    dados.prazoRequisicao &&
    dados.prazoCotacao &&
    dados.prazoCotacao <= dados.prazoRequisicao
  ) {
    throw new Error(
      "O prazo da cotação precisa vir depois do prazo das requisições.",
    );
  }
  if (
    dados.entregaDe &&
    dados.entregaAte &&
    dados.entregaAte < dados.entregaDe
  ) {
    throw new Error("A janela de entrega termina antes de começar.");
  }

  return db.$transaction(async (tx) => {
    const rodada = await tx.rodadaDeCompra.create({
      data: {
        organizacaoId: ctx.organizacao.id,
        descricao: dados.descricao,
        prazoRequisicao: dados.prazoRequisicao,
        prazoCotacao: dados.prazoCotacao,
        entregaDe: dados.entregaDe,
        entregaAte: dados.entregaAte,
        responsavelId: dados.responsavelId ?? ctx.usuario.id,
        observacao: dados.observacao,
        criadoPorId: ctx.usuario.id,
      },
      select: { id: true, numero: true },
    });

    await tx.requisicao.createMany({
      data: lojas.map((unidadeId) => ({
        organizacaoId: ctx.organizacao.id,
        rodadaId: rodada.id,
        unidadeId,
        criadoPorId: ctx.usuario.id,
      })),
    });

    await registrar(tx, ctx, {
      entidade: "RodadaDeCompra",
      entidadeId: rodada.id,
      acao: "CRIOU",
      depois: { descricao: dados.descricao, lojas },
    });

    return rodada;
  });
}

/** As lojas que o contexto enxerga — é o recorte de TODA leitura da rodada. */
function lojasDoContexto(ctx: ContextoSessao, unidadeId?: string) {
  const visiveis = ctx.unidadesVisiveis.map((u) => u.id);
  if (unidadeId) {
    if (!visiveis.includes(unidadeId)) {
      throw new SemPermissao("ver compras de outra loja");
    }
    return [unidadeId];
  }
  return ctx.unidadeAtiva ? [ctx.unidadeAtiva.id] : visiveis;
}

export type ResumoDaRodada = Awaited<ReturnType<typeof listarRodadas>>[number];

export async function listarRodadas(
  ctx: ContextoSessao,
  filtro: { unidadeId?: string; estado?: EstadoDaRodada } = {},
) {
  exigir(ctx, "compras.ver", "ver compras");
  const lojas = lojasDoContexto(ctx, filtro.unidadeId);

  const rodadas = await db.rodadaDeCompra.findMany({
    where: {
      organizacaoId: ctx.organizacao.id,
      ...(filtro.estado ? { estado: filtro.estado } : {}),
      requisicoes: { some: { unidadeId: { in: lojas } } },
    },
    include: {
      requisicoes: {
        where: { unidadeId: { in: lojas } },
        select: {
          unidadeId: true,
          status: true,
          _count: { select: { itens: true } },
        },
      },
      solicitacoes: { select: { status: true } },
      pedidos: {
        where: { unidadeId: { in: lojas } },
        select: { status: true },
      },
      _count: { select: { itens: true } },
    },
    orderBy: { numero: "desc" },
    take: 60,
  });

  const nomes = await nomesDeLojas(
    rodadas.flatMap((r) => r.requisicoes.map((q) => q.unidadeId)),
  );
  const agora = new Date();

  return rodadas.map((r) => {
    const prazo =
      r.estado === "COLETANDO"
        ? r.prazoRequisicao
        : r.estado === "COTANDO"
          ? r.prazoCotacao
          : null;
    return {
      id: r.id,
      numero: r.numero,
      descricao: r.descricao,
      estado: r.estado,
      versao: r.versao,
      prazoRequisicao: r.prazoRequisicao,
      prazoCotacao: r.prazoCotacao,
      entregaDe: r.entregaDe,
      entregaAte: r.entregaAte,
      criadoEm: r.criadoEm,
      lojas: r.requisicoes.map((q) => ({
        unidadeId: q.unidadeId,
        nome: nomes.get(q.unidadeId) ?? "Loja",
        status: q.status,
        itens: q._count.itens,
      })),
      itens: r._count.itens,
      solicitacoes: r.solicitacoes.length,
      respondidas: r.solicitacoes.filter((s) =>
        ["RESPONDIDA", "ENCERRADA"].includes(s.status),
      ).length,
      pedidos: r.pedidos.length,
      aguardandoAprovacao: r.pedidos.filter(
        (p) => p.status === "AGUARDANDO_APROVACAO",
      ).length,
      prazoVencido: prazo !== null && prazo < agora,
    };
  });
}

async function nomesDeLojas(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const unidades = await db.unidade.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, nome: true },
  });
  return new Map(unidades.map((u) => [u.id, u.nome]));
}

export type RodadaCompleta = NonNullable<
  Awaited<ReturnType<typeof obterRodada>>
>;

export async function obterRodada(ctx: ContextoSessao, id: string) {
  exigir(ctx, "compras.ver", "ver compras");
  const lojas = lojasDoContexto(ctx);

  const rodada = await db.rodadaDeCompra.findFirst({
    where: {
      id,
      organizacaoId: ctx.organizacao.id,
      requisicoes: { some: { unidadeId: { in: lojas } } },
    },
    include: {
      requisicoes: {
        where: { unidadeId: { in: lojas } },
        include: { _count: { select: { itens: true } } },
      },
      itens: {
        orderBy: { ordem: "asc" },
        include: {
          insumo: {
            select: {
              nome: true,
              unidadeMedida: true,
              unidadeRotulo: true,
              categoria: true,
            },
          },
          fornecedorFixo: { select: { id: true, nome: true } },
        },
      },
    },
  });
  if (!rodada) return null;

  const nomes = await nomesDeLojas(rodada.requisicoes.map((q) => q.unidadeId));
  const responsavel = rodada.responsavelId
    ? await db.usuario.findUnique({
        where: { id: rodada.responsavelId },
        select: { nome: true },
      })
    : null;

  // A origem de cada quantidade consolidada: as linhas das requisições
  // ENVIADAS desta rodada, por loja.
  const origens = await db.itemDeRequisicao.findMany({
    where: {
      requisicao: { rodadaId: id, status: "ENVIADA" },
      unidadeId: { in: lojas },
    },
    select: { insumoId: true, unidadeId: true, quantidade: true },
  });

  return {
    id: rodada.id,
    numero: rodada.numero,
    descricao: rodada.descricao,
    estado: rodada.estado,
    versao: rodada.versao,
    prazoRequisicao: rodada.prazoRequisicao,
    prazoCotacao: rodada.prazoCotacao,
    entregaDe: rodada.entregaDe,
    entregaAte: rodada.entregaAte,
    observacao: rodada.observacao,
    motivoUltimaReabertura: rodada.motivoUltimaReabertura,
    responsavel: responsavel?.nome ?? null,
    criadoEm: rodada.criadoEm,
    consolidadaEm: rodada.consolidadaEm,
    requisicoes: rodada.requisicoes.map((q) => ({
      id: q.id,
      unidadeId: q.unidadeId,
      loja: nomes.get(q.unidadeId) ?? "Loja",
      status: q.status,
      itens: q._count.itens,
      enviadaEm: q.enviadaEm,
      motivoDevolucao: q.motivoDevolucao,
    })),
    itens: rodada.itens.map((i) => ({
      id: i.id,
      insumoId: i.insumoId,
      nome: i.insumo.nome,
      categoria: i.insumo.categoria,
      unidade: i.insumo.unidadeMedida,
      rotulo: i.insumo.unidadeRotulo,
      quantidadeTotal: i.quantidadeTotal.toString(),
      modo: i.modo,
      fornecedorFixo: i.fornecedorFixo,
      excecaoMotivo: i.excecaoMotivo,
      porLoja: origens
        .filter((o) => o.insumoId === i.insumoId)
        .map((o) => ({
          unidadeId: o.unidadeId,
          loja: nomes.get(o.unidadeId) ?? "Loja",
          quantidade: o.quantidade.toString(),
        })),
    })),
  };
}

/**
 * Muda o estado da rodada.
 *
 * `versao` é a que a pessoa tinha na tela. Se a rodada mudou desde então, a
 * escrita afeta zero linhas e a pessoa recebe quem mudou e quando — nunca uma
 * sobrescrita silenciosa.
 */
export async function moverRodada(
  ctx: ContextoSessao,
  id: string,
  dados: { versao: number; para: EstadoDaRodada; motivo?: string | null },
): Promise<void> {
  exigir(ctx, "compras.rodadas", "mudar o estado da rodada");
  const motivo = dados.motivo?.trim() || null;

  await db.$transaction(
    async (tx) => {
      const [travada] = await tx.$queryRaw<
        { estado: EstadoDaRodada; versao: number; organizacaoId: string }[]
      >`SELECT "estado", "versao", "organizacaoId" FROM "rodada_de_compra"
        WHERE "id" = ${id} FOR UPDATE`;
      if (!travada || travada.organizacaoId !== ctx.organizacao.id) {
        throw new Error("Rodada não encontrada.");
      }

      if (travada.versao !== dados.versao) {
        const ultima = await ultimaMudanca("RodadaDeCompra", id);
        throw new RodadaMudou(
          `A rodada mudou enquanto você olhava: agora está em "${ROTULO_DO_ESTADO[travada.estado]}"` +
            (ultima
              ? ` (${ultima.quem ?? "pelo relógio"}, ${hora.format(ultima.quando)})`
              : "") +
            ". Recarregue para ver como ficou.",
        );
      }

      const transicao = transicaoPermitida(travada.estado, dados.para);
      if (!transicao.ok) throw new Error(transicao.mensagem);
      if (transicao.exigeMotivo && !motivo) {
        throw new Error(
          dados.para === "CANCELADA"
            ? "Diga por que a rodada está sendo cancelada — fica registrado."
            : "Reabrir exige um motivo. Ele fica gravado na rodada e no histórico.",
        );
      }

      const agora = new Date();
      const efeitos: Record<string, unknown> = {};

      if (travada.estado === "RASCUNHO" && dados.para === "COLETANDO") {
        const lojas = await tx.requisicao.count({ where: { rodadaId: id } });
        if (lojas === 0) throw new Error("A rodada não tem nenhuma loja.");
      }

      if (travada.estado === "COLETANDO" && dados.para === "COTANDO") {
        Object.assign(efeitos, await consolidar(tx, id, ctx.organizacao.id));
      }

      if (travada.estado === "COTANDO" && dados.para === "REVISAO") {
        await encerrarCotacaoNaTransacao(tx, id);
      }

      if (travada.estado === "REVISAO" && dados.para === "COTANDO") {
        await reabrirCotacaoNaTransacao(tx, id);
      }

      if (dados.para === "APROVADA") {
        const pendentes = await tx.pedido.count({
          where: {
            rodadaId: id,
            status: { in: ["RASCUNHO", "AGUARDANDO_APROVACAO"] },
          },
        });
        const total = await tx.pedido.count({ where: { rodadaId: id } });
        if (total === 0) {
          throw new Error(
            "A rodada ainda não tem pedidos. Gere os pedidos a partir da comparação.",
          );
        }
        if (pendentes > 0) {
          throw new Error(
            `${pendentes} ${pendentes === 1 ? "pedido ainda aguarda" : "pedidos ainda aguardam"} aprovação.`,
          );
        }
      }

      if (dados.para === "FECHADA") {
        const abertas = await tx.mensagemAoFornecedor.count({
          where: {
            referenciaTipo: "Pedido",
            referenciaId: {
              in: (
                await tx.pedido.findMany({
                  where: { rodadaId: id },
                  select: { id: true },
                })
              ).map((p) => p.id),
            },
            estado: {
              in: ["BLOQUEADA", "NA_FILA", "ENVIANDO", "INCERTA", "FALHOU"],
            },
          },
        });
        if (abertas > 0) {
          throw new Error(
            `${abertas} ${abertas === 1 ? "mensagem de pedido ainda não foi resolvida" : "mensagens de pedido ainda não foram resolvidas"} no painel de envios. Feche a rodada depois de resolvê-las.`,
          );
        }
      }

      const escrita = await tx.rodadaDeCompra.updateMany({
        where: { id, versao: dados.versao, estado: travada.estado },
        data: {
          estado: dados.para,
          versao: { increment: 1 },
          ...(transicao.reabertura ? { motivoUltimaReabertura: motivo } : {}),
          ...(dados.para === "COTANDO" && travada.estado === "COLETANDO"
            ? { consolidadaEm: agora }
            : {}),
          ...(dados.para === "REVISAO" && travada.estado === "COTANDO"
            ? { cotacaoEncerradaEm: agora }
            : {}),
          ...(dados.para === "FECHADA" ? { fechadaEm: agora } : {}),
          ...(dados.para === "CANCELADA" ? { canceladaEm: agora } : {}),
        },
      });
      // Com a linha travada isto não deveria acontecer; se acontecer, a
      // transação inteira volta em vez de gravar meio estado.
      if (escrita.count !== 1) {
        throw new RodadaMudou(
          "A rodada mudou enquanto você olhava. Recarregue.",
        );
      }

      await registrar(tx, ctx, {
        entidade: "RodadaDeCompra",
        entidadeId: id,
        acao: "ALTEROU",
        antes: { estado: travada.estado, versao: travada.versao },
        depois: {
          estado: dados.para,
          versao: travada.versao + 1,
          ...(motivo ? { motivo } : {}),
          ...efeitos,
        },
      });
    },
    { timeout: 20_000 },
  );
}

/**
 * A CONSOLIDAÇÃO: as requisições ENVIADAS viram a lista da rodada.
 *
 * Requisição em rascunho fica de fora — e a auditoria diz quais lojas não
 * enviaram. Item de fornecedor fixo vira DIRECIONADO. Depois, na mesma
 * transação, nascem as solicitações de cotação.
 */
async function consolidar(
  tx: Prisma.TransactionClient,
  rodadaId: string,
  organizacaoId: string,
) {
  const requisicoes = await tx.requisicao.findMany({
    where: { rodadaId },
    select: {
      unidadeId: true,
      status: true,
      itens: {
        select: {
          insumoId: true,
          quantidade: true,
          insumo: { select: { nome: true, categoria: true } },
        },
      },
    },
  });

  const enviadas = requisicoes.filter((r) => r.status === "ENVIADA");
  const soma = new Map<
    string,
    { total: bigint; nome: string; categoria: string | null }
  >();
  for (const r of enviadas) {
    for (const item of r.itens) {
      const atual = soma.get(item.insumoId);
      // Quantidade com 3 casas: somada em milésimos, sem ponto flutuante.
      const q = milesimosDoBanco(item.quantidade);
      soma.set(item.insumoId, {
        total: (atual?.total ?? 0n) + q,
        nome: item.insumo.nome,
        categoria: item.insumo.categoria,
      });
    }
  }

  if (soma.size === 0) {
    throw new Error(
      "Nenhuma loja enviou requisição com itens. Espere os envios, ou cancele a rodada.",
    );
  }

  const fixos = await tx.fornecedorInsumo.findMany({
    where: {
      organizacaoId,
      fixo: true,
      ativo: true,
      insumoId: { in: [...soma.keys()] },
      fornecedor: { ativo: true, excluidoEm: null },
    },
    select: { insumoId: true, fornecedorId: true },
  });
  const fixoDe = new Map(fixos.map((f) => [f.insumoId, f.fornecedorId]));

  const ordenados = [...soma.entries()].sort(
    ([, a], [, b]) =>
      (a.categoria ?? "~").localeCompare(b.categoria ?? "~", "pt-BR") ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );

  await tx.itemDaRodada.createMany({
    data: ordenados.map(([insumoId, { total }], ordem) => ({
      rodadaId,
      insumoId,
      quantidadeTotal: paraDecimal(total, CASAS.milesimos),
      modo: fixoDe.has(insumoId)
        ? ("DIRECIONADO" as const)
        : ("COTAVEL" as const),
      fornecedorFixoId: fixoDe.get(insumoId) ?? null,
      ordem,
    })),
  });

  const rodada = await tx.rodadaDeCompra.findUniqueOrThrow({
    where: { id: rodadaId },
    select: { id: true, organizacaoId: true, prazoCotacao: true },
  });
  const solicitacoes = await prepararSolicitacoesNaTransacao(tx, rodada);

  return {
    itens: soma.size,
    lojasQueEnviaram: enviadas.map((r) => r.unidadeId),
    lojasSemEnvio: requisicoes
      .filter((r) => r.status !== "ENVIADA")
      .map((r) => r.unidadeId),
    solicitacoes,
  };
}
