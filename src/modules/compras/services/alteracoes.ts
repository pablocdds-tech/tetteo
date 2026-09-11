import type { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import type { Unidade } from "@/lib/unidades";
import { db } from "@/server/db";

import {
  CASAS,
  NumeroInvalido,
  centavosDoBanco,
  digitado,
  fatorDoBanco,
  milesimosDigitados,
  milesimosDoBanco,
  numeroBrDe,
  paraDecimal,
  quantidadeBr,
  quantidadeDeEmbalagens,
  type Milesimos,
} from "../schemas/aritmetica";
import { referenciaDoPedido, textoDaAlteracao } from "../schemas/mensagens";
import {
  REGRA_DE_ARREDONDAMENTO,
  montarPedido,
  type EntradaDaLinha,
} from "../schemas/pedido";

import { registrar } from "./auditoria";
import { enfileirar } from "./fila";

/**
 * DEPOIS DE ENVIADO: adendo e alteração.
 *
 *   ADENDO     itens NOVOS depois do primeiro envio. Um pedido filho, ligado
 *              ao original, com a próxima sequência e SÓ o delta aprovado. Não
 *              se reenvia tudo como se fosse novo.
 *
 *   ALTERAÇÃO  DIMINUIR ou CANCELAR o que já foi enviado. Nunca aumenta —
 *              aumentar é adendo. Vai ao fornecedor como mensagem própria, e a
 *              concordância dele é registrada.
 *
 * As duas pegam a sequência do contador do pedido ORIGINAL, travado: dois
 * adendos ao mesmo tempo viram 2 e 3, nunca dois 2.
 */

type Tx = Prisma.TransactionClient;

function exigir(ctx: ContextoSessao, chave: string, acao: string) {
  if (!pode(ctx, chave)) throw new SemPermissao(acao);
}

async function travar(tx: Tx, pedidoId: string) {
  const [linha] = await tx.$queryRaw<
    {
      id: string;
      organizacaoId: string;
      unidadeId: string;
      status: string;
      pedidoOrigemId: string | null;
      ultimaSequencia: number;
    }[]
  >`SELECT "id", "organizacaoId", "unidadeId", "status"::text AS "status",
           "pedidoOrigemId", "ultimaSequencia"
    FROM "pedido" WHERE "id" = ${pedidoId} FOR UPDATE`;
  return linha ?? null;
}

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

// ------------------------------------------------------------------- ADENDO

export async function criarAdendo(
  ctx: ContextoSessao,
  pedidoOrigemId: string,
  itens: { insumoId: string; necessario: string }[],
  motivo: string,
): Promise<string> {
  exigir(ctx, "compras.pedir", "fazer adendos");
  const texto = motivo.trim();
  if (!texto) throw new Error("Diga por que o adendo é necessário.");
  if (itens.length === 0)
    throw new Error("O adendo precisa de ao menos um item.");

  const quantidades = new Map<string, Milesimos>();
  for (const i of itens) {
    let q: Milesimos | null;
    try {
      q = milesimosDigitados(i.necessario);
    } catch (erro) {
      if (erro instanceof NumeroInvalido) throw new Error(erro.message);
      throw erro;
    }
    if (q === null || q <= 0n)
      throw new Error("Quantidade do adendo precisa ser maior que zero.");
    if (quantidades.has(i.insumoId))
      throw new Error("Insumo repetido no adendo.");
    quantidades.set(i.insumoId, q);
  }

  return db.$transaction(
    async (tx) => {
      const origem = await travar(tx, pedidoOrigemId);
      if (
        !origem ||
        origem.organizacaoId !== ctx.organizacao.id ||
        !ctx.unidadesVisiveis.some((u) => u.id === origem.unidadeId)
      ) {
        throw new Error("Pedido não encontrado.");
      }
      if (origem.pedidoOrigemId) {
        throw new Error(
          "Faça o adendo no pedido original, não em outro adendo.",
        );
      }
      if (origem.status !== "APROVADO") {
        throw new Error(
          "Adendo só vale para pedido aprovado e ainda em aberto.",
        );
      }

      const pedido = await tx.pedido.findUniqueOrThrow({
        where: { id: pedidoOrigemId },
        include: {
          itens: true,
          rodada: { select: { id: true, estado: true } },
        },
      });
      if (pedido.rodada?.estado === "FECHADA") {
        throw new Error(
          "A rodada deste pedido está fechada. Reabra-a com o motivo antes do adendo — nada muda sem registro.",
        );
      }

      const insumos = await tx.insumo.findMany({
        where: {
          id: { in: [...quantidades.keys()] },
          organizacaoId: ctx.organizacao.id,
        },
        select: { id: true, nome: true, unidadeMedida: true },
      });

      const entradas: EntradaDaLinha[] = [];
      for (const [insumoId, necessario] of quantidades) {
        const insumo = insumos.find((i) => i.id === insumoId);
        if (!insumo) throw new Error("Insumo não encontrado.");

        // 1º: o mesmo preço do pedido original, se o insumo estava nele.
        const noOriginal = pedido.itens.find((i) => i.insumoId === insumoId);
        if (noOriginal) {
          entradas.push({
            insumoId,
            nome: insumo.nome,
            unidade: insumo.unidadeMedida,
            necessario,
            nomeEmbalagem: noOriginal.nomeEmbalagem,
            pecas: noOriginal.pecas,
            conteudo:
              noOriginal.conteudo === null
                ? null
                : fatorDoBanco(noOriginal.conteudo),
            unidadeConteudo: noOriginal.unidadeConteudo,
            fracionavel: noOriginal.fracionavel,
            fator: fatorDoBanco(noOriginal.fatorConversao),
            precoEmbalagem: centavosDoBanco(noOriginal.precoEmbalagem),
            origemPreco: `Mesmo preço do ${referenciaDoPedido(pedido.numero, 1)}`,
            itemDePropostaId: noOriginal.itemDePropostaId,
            itemDeRequisicaoId: null,
          });
          continue;
        }

        // 2º: a última proposta DESTE fornecedor na rodada, para este insumo.
        const oferta = pedido.rodadaId
          ? await tx.itemDeProposta.findFirst({
              where: {
                situacao: "COTADO",
                fator: { not: null },
                precoEmbalagem: { not: null },
                itemDaSolicitacao: {
                  itemDaRodada: { insumoId, rodadaId: pedido.rodadaId },
                  solicitacao: { fornecedorId: pedido.fornecedorId },
                },
              },
              orderBy: { versao: { numero: "desc" } },
              include: { versao: { select: { numero: true } } },
            })
          : null;
        if (oferta) {
          entradas.push({
            insumoId,
            nome: insumo.nome,
            unidade: insumo.unidadeMedida,
            necessario,
            nomeEmbalagem: oferta.nomeEmbalagem,
            pecas: oferta.pecas,
            conteudo:
              oferta.conteudo === null ? null : fatorDoBanco(oferta.conteudo),
            unidadeConteudo: oferta.unidadeConteudo,
            fracionavel: oferta.fracionavel,
            fator: fatorDoBanco(oferta.fator!),
            precoEmbalagem: centavosDoBanco(oferta.precoEmbalagem!),
            origemPreco: `Proposta v${oferta.versao.numero} · ${pedido.fornecedorNome}`,
            itemDePropostaId: oferta.id,
            itemDeRequisicaoId: null,
          });
          continue;
        }

        // 3º: o preço de referência do cadastro do fornecedor.
        const referencia = await tx.fornecedorInsumo.findFirst({
          where: {
            fornecedorId: pedido.fornecedorId,
            insumoId,
            ativo: true,
            fator: { not: null },
            precoReferencia: { not: null },
          },
        });
        if (!referencia) {
          throw new Error(
            `${insumo.nome}: não há preço deste fornecedor. Peça a cotação antes do adendo.`,
          );
        }
        entradas.push({
          insumoId,
          nome: insumo.nome,
          unidade: insumo.unidadeMedida,
          necessario,
          nomeEmbalagem: referencia.nomeEmbalagem,
          pecas: referencia.pecas,
          conteudo:
            referencia.conteudo === null
              ? null
              : fatorDoBanco(referencia.conteudo),
          unidadeConteudo: referencia.unidadeConteudo,
          fracionavel: referencia.fracionavel,
          fator: fatorDoBanco(referencia.fator!),
          precoEmbalagem: centavosDoBanco(referencia.precoReferencia!),
          origemPreco: `Preço de referência${referencia.precoReferenciaEm ? ` de ${dataCurta.format(referencia.precoReferenciaEm)}` : ""}`,
          itemDePropostaId: null,
          itemDeRequisicaoId: null,
        });
      }

      const sequencia = origem.ultimaSequencia + 1;
      await tx.pedido.update({
        where: { id: pedidoOrigemId },
        data: { ultimaSequencia: sequencia },
      });

      // O frete do adendo é zero por padrão: ele costuma ir junto da entrega
      // do pedido original. A observação diz isso ao fornecedor.
      const p = montarPedido(entradas, 0n);
      const adendo = await tx.pedido.create({
        data: {
          organizacaoId: pedido.organizacaoId,
          unidadeId: pedido.unidadeId,
          fornecedorId: pedido.fornecedorId,
          rodadaId: pedido.rodadaId,
          tipo: "ADENDO",
          pedidoOrigemId,
          sequencia,
          ultimaSequencia: sequencia,
          status: "AGUARDANDO_APROVACAO",
          fornecedorNome: pedido.fornecedorNome,
          fornecedorDocumento: pedido.fornecedorDocumento,
          destinoTelefone: pedido.destinoTelefone,
          unidadeNome: pedido.unidadeNome,
          enderecoEntrega: pedido.enderecoEntrega,
          condicaoPagamento: pedido.condicaoPagamento,
          entregaDe: pedido.entregaDe,
          entregaAte: pedido.entregaAte,
          previsaoEntrega: pedido.previsaoEntrega,
          subtotal: paraDecimal(p.subtotal, CASAS.centavos),
          frete: "0",
          total: paraDecimal(p.total, CASAS.centavos),
          regraArredondamento: REGRA_DE_ARREDONDAMENTO,
          observacao: `Adendo: ${texto.slice(0, 250)}`,
          criadoPorId: ctx.usuario.id,
          itens: {
            create: p.linhas.map((l, ordem) => ({
              insumoId: l.insumoId,
              insumoNome: l.nome,
              unidadeEstoque: l.unidade as Unidade,
              nomeEmbalagem: l.nomeEmbalagem,
              pecas: l.pecas,
              conteudo:
                l.conteudo === null
                  ? null
                  : paraDecimal(l.conteudo, CASAS.dezMilesimos),
              unidadeConteudo: l.unidadeConteudo,
              fracionavel: l.fracionavel,
              fatorConversao: paraDecimal(l.fator, CASAS.dezMilesimos),
              embalagens: paraDecimal(l.embalagensMil, CASAS.milesimos),
              quantidadeNecessaria: paraDecimal(l.necessario, CASAS.milesimos),
              quantidade: paraDecimal(l.comprado, CASAS.milesimos),
              adicional: paraDecimal(l.adicional, CASAS.milesimos),
              precoEmbalagem: paraDecimal(l.precoEmbalagem, CASAS.centavos),
              precoUnitario: paraDecimal(l.precoPorUnidade, CASAS.micros),
              total: paraDecimal(l.total, CASAS.centavos),
              origemPreco: l.origemPreco,
              itemDePropostaId: l.itemDePropostaId,
              ordem,
            })),
          },
        },
        select: { id: true },
      });

      await registrar(tx, ctx, {
        entidade: "Pedido",
        entidadeId: adendo.id,
        acao: "CRIOU",
        unidadeId: pedido.unidadeId,
        depois: {
          adendoDe: pedidoOrigemId,
          sequencia,
          itens: p.linhas.map((l) => l.nome),
          total: p.total,
          motivo: texto,
        },
      });

      return adendo.id;
    },
    { timeout: 20_000 },
  );
}

// ---------------------------------------------------------------- ALTERAÇÃO

export async function criarAlteracao(
  ctx: ContextoSessao,
  pedidoId: string,
  dados: {
    tipo: "ALTERACAO" | "CANCELAMENTO";
    linhas: { itemDePedidoId: string; embalagensDepois: string }[];
    motivo: string;
  },
): Promise<string> {
  exigir(ctx, "compras.pedir", "alterar pedidos");
  const motivo = dados.motivo.trim();
  if (!motivo)
    throw new Error("Diga o motivo — ele vai junto para o fornecedor.");

  return db.$transaction(
    async (tx) => {
      const linha = await travar(tx, pedidoId);
      if (
        !linha ||
        linha.organizacaoId !== ctx.organizacao.id ||
        !ctx.unidadesVisiveis.some((u) => u.id === linha.unidadeId)
      ) {
        throw new Error("Pedido não encontrado.");
      }
      if (linha.status !== "APROVADO") {
        throw new Error(
          linha.status === "AGUARDANDO_APROVACAO"
            ? "Pedido ainda não aprovado: ajuste direto, sem alteração."
            : "Este pedido não está em aberto para alterar.",
        );
      }
      // A sequência vem do ORIGINAL — travado depois do próprio pedido, sempre
      // nesta ordem, para duas alterações nunca se esperarem em cruz.
      const raiz = linha.pedidoOrigemId
        ? await travar(tx, linha.pedidoOrigemId)
        : linha;

      const pedido = await tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        include: {
          itens: {
            include: {
              itensRecebidos: {
                where: { recebimento: { tipo: "ENTRADA" } },
                select: { quantidadeBoa: true, quantidadeAvariada: true },
              },
            },
          },
          pedidoOrigem: { select: { numero: true } },
        },
      });

      const recebidoDe = (i: (typeof pedido.itens)[number]) =>
        i.itensRecebidos.reduce(
          (s, r) =>
            s +
            milesimosDoBanco(r.quantidadeBoa) +
            milesimosDoBanco(r.quantidadeAvariada),
          0n,
        );

      const alvos =
        dados.tipo === "CANCELAMENTO"
          ? pedido.itens.map((i) => ({ item: i, depoisTexto: "0" }))
          : dados.linhas.map((l) => {
              const item = pedido.itens.find((i) => i.id === l.itemDePedidoId);
              if (!item) throw new Error("Item não pertence a este pedido.");
              return { item, depoisTexto: l.embalagensDepois };
            });
      if (alvos.length === 0) throw new Error("Escolha o que muda.");

      const mudancas: {
        item: (typeof pedido.itens)[number];
        embAntes: Milesimos;
        embDepois: Milesimos;
        qtdAntes: Milesimos;
        qtdDepois: Milesimos;
      }[] = [];

      for (const { item, depoisTexto } of alvos) {
        const fator = fatorDoBanco(item.fatorConversao);
        const qtdAntes =
          milesimosDoBanco(item.quantidade) -
          milesimosDoBanco(item.quantidadeCancelada);
        const embAntes = item.fracionavel
          ? qtdAntes
          : (qtdAntes * 10_000n) / fator;

        let depois: bigint | null;
        try {
          depois = digitado(
            depoisTexto,
            item.fracionavel ? CASAS.milesimos : 0,
          );
        } catch (erro) {
          if (erro instanceof NumeroInvalido)
            throw new Error(`${item.insumoNome}: ${erro.message}`);
          throw erro;
        }
        if (depois === null)
          throw new Error(`${item.insumoNome}: informe a nova quantidade.`);
        const embDepois = item.fracionavel ? depois : depois * 1000n;
        const qtdDepois = item.fracionavel
          ? depois
          : quantidadeDeEmbalagens(depois, fator);

        if (qtdDepois >= qtdAntes) {
          throw new Error(
            `${item.insumoNome}: aumentar ou manter não é alteração. Para acrescentar, faça um adendo.`,
          );
        }
        const recebido = recebidoDe(item);
        if (qtdDepois < recebido) {
          throw new Error(
            `${item.insumoNome}: já foram recebidos ${quantidadeBr(recebido, item.unidadeEstoque)} — não dá para pedir menos que isso.`,
          );
        }
        mudancas.push({ item, embAntes, embDepois, qtdAntes, qtdDepois });
      }

      const sequencia = raiz!.ultimaSequencia + 1;
      await tx.pedido.update({
        where: { id: raiz!.id },
        data: { ultimaSequencia: sequencia },
      });

      const alteracao = await tx.alteracaoDePedido.create({
        data: {
          organizacaoId: ctx.organizacao.id,
          unidadeId: linha.unidadeId,
          pedidoId,
          tipo: dados.tipo,
          sequencia,
          motivo: motivo.slice(0, 300),
          criadoPorId: ctx.usuario.id,
          itens: {
            create: mudancas.map((m) => ({
              itemDePedidoId: m.item.id,
              embalagensAntes: paraDecimal(m.embAntes, CASAS.milesimos),
              embalagensDepois: paraDecimal(m.embDepois, CASAS.milesimos),
              quantidadeAntes: paraDecimal(m.qtdAntes, CASAS.milesimos),
              quantidadeDepois: paraDecimal(m.qtdDepois, CASAS.milesimos),
            })),
          },
        },
        select: { id: true },
      });

      for (const m of mudancas) {
        await tx.itemDePedido.update({
          where: { id: m.item.id },
          data: {
            quantidadeCancelada: paraDecimal(
              milesimosDoBanco(m.item.quantidade) - m.qtdDepois,
              CASAS.milesimos,
            ),
          },
        });
      }

      const cancelouTudo =
        mudancas.length === pedido.itens.length &&
        mudancas.every((m) => m.qtdDepois === 0n);
      if (dados.tipo === "CANCELAMENTO" || cancelouTudo) {
        await tx.pedido.update({
          where: { id: pedidoId },
          data: {
            status: "CANCELADO",
            canceladoEm: new Date(),
            motivoCancelamento: motivo.slice(0, 300),
            versao: { increment: 1 },
          },
        });
      } else {
        await tx.pedido.update({
          where: { id: pedidoId },
          data: { versao: { increment: 1 } },
        });
      }

      const organizacao = await tx.organizacao.findUniqueOrThrow({
        where: { id: ctx.organizacao.id },
        select: { nome: true },
      });
      const numeroRaiz = pedido.pedidoOrigem?.numero ?? pedido.numero;
      const emb = (i: (typeof pedido.itens)[number], valor: Milesimos) =>
        i.fracionavel
          ? quantidadeBr(valor, i.unidadeEstoque)
          : `${numeroBrDe(valor, CASAS.milesimos)} ${(i.nomeEmbalagem ?? "embalagem").toLowerCase()}`;

      await enfileirar(tx, {
        organizacaoId: ctx.organizacao.id,
        unidadeId: linha.unidadeId,
        fornecedorId: pedido.fornecedorId,
        tipo: dados.tipo === "CANCELAMENTO" ? "CANCELAMENTO" : "ALTERACAO",
        referenciaTipo: "AlteracaoDePedido",
        referenciaId: alteracao.id,
        sequencia,
        corpo: textoDaAlteracao({
          referencia: referenciaDoPedido(numeroRaiz, sequencia),
          pedidoOriginal: referenciaDoPedido(numeroRaiz, pedido.sequencia),
          organizacao: organizacao.nome,
          fornecedor: pedido.fornecedorNome,
          cancelamento: dados.tipo === "CANCELAMENTO",
          mudancas: mudancas.map((m) => ({
            nome: m.item.insumoNome,
            antes: emb(m.item, m.embAntes),
            depois: emb(m.item, m.embDepois),
          })),
          motivo,
        }),
        chave: `alteracao:${alteracao.id}`,
        criadoPorId: ctx.usuario.id,
      });

      await registrar(tx, ctx, {
        entidade: "Pedido",
        entidadeId: pedidoId,
        acao: "ALTEROU",
        unidadeId: linha.unidadeId,
        depois: {
          alteracao: alteracao.id,
          tipo: dados.tipo,
          sequencia,
          motivo,
          linhas: mudancas.map((m) => ({
            item: m.item.insumoNome,
            antes: m.qtdAntes,
            depois: m.qtdDepois,
          })),
        },
      });

      return alteracao.id;
    },
    { timeout: 20_000 },
  );
}

export async function registrarConcordancia(
  ctx: ContextoSessao,
  alteracaoId: string,
  resposta: "ACEITA" | "RECUSADA",
  texto: string,
): Promise<void> {
  exigir(ctx, "compras.pedir", "registrar a resposta do fornecedor");
  const conteudo = texto.trim();
  if (!conteudo)
    throw new Error("Copie ou resuma o que o fornecedor respondeu.");
  const r = await db.alteracaoDePedido.updateMany({
    where: {
      id: alteracaoId,
      organizacaoId: ctx.organizacao.id,
      concordancia: "PENDENTE",
    },
    data: {
      concordancia: resposta,
      concordanciaTexto: conteudo.slice(0, 500),
      concordanciaEm: new Date(),
      concordanciaPorId: ctx.usuario.id,
    },
  });
  if (r.count !== 1)
    throw new Error("Esta alteração não está aguardando resposta.");
  await registrar(db, ctx, {
    entidade: "AlteracaoDePedido",
    entidadeId: alteracaoId,
    acao: "ALTEROU",
    depois: { concordancia: resposta, texto: conteudo },
  });
}
