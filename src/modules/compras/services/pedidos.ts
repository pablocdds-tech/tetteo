import type { Prisma, StatusPedido } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { sigla, type Unidade } from "@/lib/unidades";
import { db } from "@/server/db";

import { alcadaQueAprova, limiteDaPessoa, type Alcada } from "../schemas/alcada";
import {
  CASAS,
  NumeroInvalido,
  centavosDoBanco,
  digitado,
  fatorDoBanco,
  milesimosDoBanco,
  numeroBrDe,
  paraDecimal,
  quantidadeBr,
  quantidadeDeEmbalagens,
  reais,
  totalFracionado,
  totalPorEmbalagens,
  type Centavos,
} from "../schemas/aritmetica";
import { descreverEmbalagem } from "../schemas/embalagem";
import {
  referenciaDoPedido,
  textoDoAdendo,
  textoDoPedido,
  type LinhaDaMensagem,
} from "../schemas/mensagens";
import {
  REGRA_DE_ARREDONDAMENTO,
  conferirTotal,
  montarPedido,
  type EntradaDaLinha,
} from "../schemas/pedido";

import { registrar, ultimaMudanca } from "./auditoria";
import { dadosDaComparacao } from "./comparacao";
import { enfileirar, mensagensDaReferencia } from "./fila";

/**
 * OS PEDIDOS DE COMPRA.
 *
 * Nascem das escolhas, um por LOJA × FORNECEDOR, aguardando aprovação, com o
 * snapshot inteiro: nome e telefone do fornecedor, endereço da loja,
 * embalagem, fator, preço, frete. Mudar o cadastro depois não reescreve um
 * pedido que já saiu.
 *
 * APROVAR é uma transação só: trava o pedido, confere a VERSÃO que a pessoa
 * tinha na tela, confere a ALÇADA no servidor, confere o total contra as
 * linhas, grava a aprovação e põe a mensagem na fila. Duas aprovações ao
 * mesmo tempo: uma passa, a outra recebe quem aprovou e quando.
 *
 * Aprovar NÃO envia. Quem envia é o relógio (services/fila.ts).
 */

type Tx = Prisma.TransactionClient;

export class AcimaDaAlcada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "AcimaDaAlcada";
  }
}

export class PedidoMudou extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PedidoMudou";
  }
}

const ATIVOS = ["RASCUNHO", "AGUARDANDO_APROVACAO", "APROVADO", "CONCLUIDO"] as const;

const ROTULO_DO_STATUS: Record<string, string> = {
  RASCUNHO: "rascunho",
  AGUARDANDO_APROVACAO: "aguardando aprovação",
  APROVADO: "aprovado",
  RECUSADO: "recusado",
  CANCELADO: "cancelado",
  CONCLUIDO: "concluído",
};

const hora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const dia = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function exigir(ctx: ContextoSessao, chave: string, acao: string) {
  if (!pode(ctx, chave)) throw new SemPermissao(acao);
}

function lojasVisiveis(ctx: ContextoSessao) {
  return ctx.unidadeAtiva ? [ctx.unidadeAtiva.id] : ctx.unidadesVisiveis.map((u) => u.id);
}

function janela(de: Date | null, ate: Date | null): string | null {
  if (!de && !ate) return null;
  if (de && ate) return `${dia.format(de)} a ${dia.format(ate)}`;
  return dia.format((de ?? ate)!);
}

function endereco(u: {
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
}): string | null {
  return [u.endereco, u.bairro, u.cidade].filter(Boolean).join(", ") || null;
}

// ------------------------------------------------------------------- GERAR

export async function gerarPedidos(
  ctx: ContextoSessao,
  rodadaId: string,
  opcoes: { ignorar?: string[] } = {},
): Promise<string[]> {
  exigir(ctx, "compras.pedir", "gerar pedidos");
  const ignorar = new Set(opcoes.ignorar ?? []);

  return db.$transaction(
    async (tx) => {
      const [travada] = await tx.$queryRaw<{ estado: string; organizacaoId: string }[]>`
        SELECT "estado"::text AS "estado", "organizacaoId" FROM "rodada_de_compra"
        WHERE "id" = ${rodadaId} FOR UPDATE`;
      if (!travada || travada.organizacaoId !== ctx.organizacao.id) {
        throw new Error("Rodada não encontrada.");
      }
      if (travada.estado !== "REVISAO") {
        throw new Error("Os pedidos são gerados com a rodada em revisão (cotação encerrada).");
      }
      const jaGerados = await tx.pedido.count({
        where: { rodadaId, tipo: "PEDIDO", status: { in: [...ATIVOS] } },
      });
      if (jaGerados > 0) {
        throw new Error(
          "Os pedidos desta rodada já foram gerados. Para acrescentar itens, faça um adendo.",
        );
      }

      const dados = (await dadosDaComparacao(tx, ctx.organizacao.id, rodadaId))!;
      const escolhas = await tx.escolhaDeItem.findMany({ where: { rodadaId } });
      const escolhaDe = new Map(escolhas.map((e) => [e.itemDaRodadaId, e]));

      const faltando = dados.itens
        .filter((i) => i.modo === "COTAVEL" && !escolhaDe.has(i.id) && !ignorar.has(i.id))
        .map((i) => i.nome);
      if (faltando.length > 0) {
        throw new Error(
          `Falta escolher o fornecedor de: ${faltando.join(", ")}. Escolha, ou marque para não comprar nesta rodada.`,
        );
      }

      type Grupo = {
        unidadeId: string;
        fornecedorId: string;
        frete: Centavos | null;
        entradas: EntradaDaLinha[];
      };
      const grupos = new Map<string, Grupo>();
      const grupoDe = (unidadeId: string, fornecedorId: string, frete: Centavos | null) => {
        const chave = `${unidadeId}|${fornecedorId}`;
        const g = grupos.get(chave) ?? { unidadeId, fornecedorId, frete, entradas: [] };
        grupos.set(chave, g);
        return g;
      };

      const ofertas = await tx.itemDeProposta.findMany({
        where: {
          id: {
            in: escolhas
              .filter((e) => !ignorar.has(e.itemDaRodadaId) && e.itemDePropostaId)
              .map((e) => e.itemDePropostaId!),
          },
        },
        include: {
          versao: {
            select: {
              numero: true,
              frete: true,
              solicitacao: {
                select: { fornecedorId: true, fornecedor: { select: { nome: true } } },
              },
            },
          },
        },
      });

      for (const item of dados.itens) {
        if (item.modo !== "COTAVEL" || ignorar.has(item.id)) continue;
        const escolha = escolhaDe.get(item.id)!;
        const o = ofertas.find((x) => x.id === escolha.itemDePropostaId);
        if (
          !o ||
          o.situacao !== "COTADO" ||
          !o.fator ||
          o.precoEmbalagem === null ||
          o.versao.solicitacao.fornecedorId !== escolha.fornecedorId
        ) {
          throw new Error(
            `${item.nome}: a proposta escolhida não tem preço e conversão válidos. Escolha de novo.`,
          );
        }
        const frete = o.versao.frete === null ? null : centavosDoBanco(o.versao.frete);
        for (const loja of item.requisicoes) {
          const quantidade = item.porLoja.find((p) => p.unidadeId === loja.unidadeId)!.quantidade;
          grupoDe(loja.unidadeId, escolha.fornecedorId, frete).entradas.push({
            insumoId: item.insumoId,
            nome: item.nome,
            unidade: item.unidade,
            necessario: quantidade,
            nomeEmbalagem: o.nomeEmbalagem,
            pecas: o.pecas,
            conteudo: o.conteudo === null ? null : fatorDoBanco(o.conteudo),
            unidadeConteudo: o.unidadeConteudo,
            fracionavel: o.fracionavel,
            fator: fatorDoBanco(o.fator),
            precoEmbalagem: centavosDoBanco(o.precoEmbalagem),
            origemPreco: `Proposta v${o.versao.numero} · ${o.versao.solicitacao.fornecedor.nome}`,
            itemDePropostaId: o.id,
            itemDeRequisicaoId: loja.itemDeRequisicaoId,
          });
        }
      }

      const semPreco: string[] = [];
      for (const d of dados.direcionados) {
        if (ignorar.has(d.item.id)) continue;
        if (!d.preco) {
          semPreco.push(d.item.nome);
          continue;
        }
        const preco = d.preco;
        for (const loja of d.item.requisicoes) {
          const quantidade = d.item.porLoja.find((p) => p.unidadeId === loja.unidadeId)!.quantidade;
          grupoDe(loja.unidadeId, preco.fornecedorId, preco.frete).entradas.push({
            insumoId: d.item.insumoId,
            nome: d.item.nome,
            unidade: d.item.unidade,
            necessario: quantidade,
            nomeEmbalagem: preco.nomeEmbalagem,
            pecas: preco.pecas,
            conteudo: preco.conteudo,
            unidadeConteudo: preco.unidadeConteudo,
            fracionavel: preco.fracionavel,
            fator: preco.fator,
            precoEmbalagem: preco.precoEmbalagem,
            origemPreco: `${preco.origem} · ${preco.fornecedor}`,
            itemDePropostaId: preco.itemDePropostaId,
            itemDeRequisicaoId: loja.itemDeRequisicaoId,
          });
        }
      }
      if (semPreco.length > 0) {
        throw new Error(
          `Sem preço para: ${semPreco.join(", ")}. O fornecedor fixo não confirmou e não há preço de referência — cadastre a referência, ou marque para não comprar.`,
        );
      }
      if (grupos.size === 0) throw new Error("Nada a pedir nesta rodada.");

      const fornecedores = await tx.fornecedor.findMany({
        where: { id: { in: [...new Set([...grupos.values()].map((g) => g.fornecedorId))] } },
      });
      const unidades = await tx.unidade.findMany({
        where: { id: { in: [...new Set([...grupos.values()].map((g) => g.unidadeId))] } },
      });

      const criados: string[] = [];
      for (const g of grupos.values()) {
        const f = fornecedores.find((x) => x.id === g.fornecedorId)!;
        const u = unidades.find((x) => x.id === g.unidadeId)!;
        const p = montarPedido(g.entradas, g.frete ?? 0n);

        const pedido = await tx.pedido.create({
          data: {
            organizacaoId: ctx.organizacao.id,
            unidadeId: g.unidadeId,
            fornecedorId: g.fornecedorId,
            rodadaId,
            status: "AGUARDANDO_APROVACAO",
            fornecedorNome: f.nome,
            fornecedorDocumento: f.documento,
            destinoTelefone: f.autorizadoMensagens ? f.telefonePedidos : null,
            unidadeNome: u.nome,
            enderecoEntrega: endereco(u),
            condicaoPagamento: f.condicaoPagamento,
            entregaDe: dados.rodada.entregaDe,
            entregaAte: dados.rodada.entregaAte,
            previsaoEntrega: dados.rodada.entregaDe,
            subtotal: paraDecimal(p.subtotal, CASAS.centavos),
            frete: paraDecimal(p.frete, CASAS.centavos),
            total: paraDecimal(p.total, CASAS.centavos),
            regraArredondamento: REGRA_DE_ARREDONDAMENTO,
            observacao:
              g.frete === null
                ? "Frete não informado pelo fornecedor — confirme antes da entrega."
                : null,
            criadoPorId: ctx.usuario.id,
            itens: {
              create: p.linhas.map((l, ordem) => ({
                insumoId: l.insumoId,
                insumoNome: l.nome,
                unidadeEstoque: l.unidade,
                nomeEmbalagem: l.nomeEmbalagem,
                pecas: l.pecas,
                conteudo: l.conteudo === null ? null : paraDecimal(l.conteudo, CASAS.dezMilesimos),
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
                itemDeRequisicaoId: l.itemDeRequisicaoId,
                ordem,
              })),
            },
          },
          select: { id: true, numero: true },
        });

        await registrar(tx, ctx, {
          entidade: "Pedido",
          entidadeId: pedido.id,
          acao: "CRIOU",
          unidadeId: g.unidadeId,
          depois: {
            numero: pedido.numero,
            fornecedor: f.nome,
            total: p.total,
            linhas: p.linhas.length,
          },
        });
        criados.push(pedido.id);
      }

      await registrar(tx, ctx, {
        entidade: "RodadaDeCompra",
        entidadeId: rodadaId,
        acao: "ALTEROU",
        depois: { pedidosGerados: criados.length, naoComprados: [...ignorar] },
      });

      return criados;
    },
    { timeout: 30_000 },
  );
}

// --------------------------------------------------------- O TEXTO QUE SAI

type PedidoParaTexto = Prisma.PedidoGetPayload<{
  include: { itens: true; pedidoOrigem: { select: { numero: true } } };
}>;

function linhasDaMensagem(pedido: PedidoParaTexto): LinhaDaMensagem[] {
  return pedido.itens
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => {
      const unidade = i.unidadeEstoque as Unidade;
      const comprado = milesimosDoBanco(i.quantidade);
      const nomeEmb = i.nomeEmbalagem ?? "embalagem";
      const descricao = descreverEmbalagem(
        {
          pecas: i.pecas,
          conteudo: i.conteudo === null ? null : fatorDoBanco(i.conteudo),
          unidadeConteudo: i.unidadeConteudo,
          fracionavel: i.fracionavel,
        },
        unidade,
      );
      return {
        nome: i.insumoNome,
        quanto: i.fracionavel
          ? `${quantidadeBr(comprado, unidade)} a granel`
          : `${numeroBrDe(milesimosDoBanco(i.embalagens), CASAS.milesimos)} × ${nomeEmb} (${descricao})`,
        quantidade: quantidadeBr(comprado, unidade),
        preco: i.fracionavel
          ? `${reais(centavosDoBanco(i.precoEmbalagem))} o ${sigla(unidade)}`
          : `${reais(centavosDoBanco(i.precoEmbalagem))} a ${nomeEmb.toLowerCase()}`,
        total: reais(centavosDoBanco(i.total)),
      };
    });
}

export function textoParaFornecedor(
  pedido: PedidoParaTexto,
  organizacao: string,
  contato: string | null,
): string {
  const numeroRaiz = pedido.pedidoOrigem?.numero ?? pedido.numero;
  const referencia = referenciaDoPedido(numeroRaiz, pedido.sequencia);
  const cabecalho = {
    referencia,
    organizacao,
    fornecedor: pedido.fornecedorNome,
    contato,
    loja: pedido.unidadeNome,
    endereco: pedido.enderecoEntrega,
    entrega: janela(pedido.entregaDe, pedido.entregaAte),
    condicaoPagamento: pedido.condicaoPagamento,
  };
  const itens = linhasDaMensagem(pedido);
  if (pedido.tipo === "ADENDO") {
    return textoDoAdendo({
      ...cabecalho,
      pedidoOriginal: referenciaDoPedido(numeroRaiz, 1),
      itens,
      total: reais(centavosDoBanco(pedido.total)),
    });
  }
  return textoDoPedido({
    ...cabecalho,
    itens,
    subtotal: reais(centavosDoBanco(pedido.subtotal)),
    frete: reais(centavosDoBanco(pedido.frete)),
    total: reais(centavosDoBanco(pedido.total)),
    observacao: pedido.observacao,
  });
}

// ----------------------------------------------------------------- APROVAR

async function travarPedido(tx: Tx, ctx: ContextoSessao, pedidoId: string) {
  const [linha] = await tx.$queryRaw<
    {
      id: string;
      organizacaoId: string;
      unidadeId: string;
      status: string;
      versao: number;
    }[]
  >`SELECT "id", "organizacaoId", "unidadeId", "status"::text AS "status", "versao"
    FROM "pedido" WHERE "id" = ${pedidoId} FOR UPDATE`;
  if (
    !linha ||
    linha.organizacaoId !== ctx.organizacao.id ||
    !ctx.unidadesVisiveis.some((u) => u.id === linha.unidadeId)
  ) {
    throw new Error("Pedido não encontrado.");
  }
  return linha;
}

async function recusarSeMudou(
  linha: { status: string; versao: number },
  pedidoId: string,
  versao: number,
) {
  if (linha.status !== "AGUARDANDO_APROVACAO") {
    const ultima = await ultimaMudanca("Pedido", pedidoId);
    throw new PedidoMudou(
      `Este pedido já está ${ROTULO_DO_STATUS[linha.status] ?? linha.status}` +
        (ultima ? ` (${ultima.quem ?? "sistema"}, ${hora.format(ultima.quando)})` : "") +
        ".",
    );
  }
  if (linha.versao !== versao) {
    throw new PedidoMudou(
      "O pedido mudou enquanto você olhava — alguém ajustou um item. Recarregue e confira antes de decidir.",
    );
  }
}

/** Quando o último pedido pendente da rodada é decidido, ela vai para envio. */
async function avancarRodadaSeTudoDecidido(tx: Tx, ctx: ContextoSessao, rodadaId: string) {
  const [rodada] = await tx.$queryRaw<{ estado: string; versao: number }[]>`
    SELECT "estado"::text AS "estado", "versao" FROM "rodada_de_compra"
    WHERE "id" = ${rodadaId} FOR UPDATE`;
  if (!rodada || rodada.estado !== "REVISAO") return;

  const pendentes = await tx.pedido.count({
    where: { rodadaId, status: { in: ["RASCUNHO", "AGUARDANDO_APROVACAO"] } },
  });
  if (pendentes > 0) return;
  const aprovados = await tx.pedido.count({
    where: { rodadaId, status: { in: ["APROVADO", "CONCLUIDO"] } },
  });
  if (aprovados === 0) return;

  await tx.rodadaDeCompra.update({
    where: { id: rodadaId },
    data: { estado: "DESPACHANDO", versao: { increment: 2 } },
  });
  await registrar(tx, ctx, {
    entidade: "RodadaDeCompra",
    entidadeId: rodadaId,
    acao: "ALTEROU",
    antes: { estado: "REVISAO", versao: rodada.versao },
    depois: {
      estado: "DESPACHANDO",
      versao: rodada.versao + 2,
      caminho: "REVISAO → APROVADA → DESPACHANDO",
      motivo: "Último pedido pendente decidido; as mensagens aprovadas estão na fila.",
    },
  });
}

export async function aprovarPedido(
  ctx: ContextoSessao,
  pedidoId: string,
  versao: number,
): Promise<{ mensagemId: string; estadoDaMensagem: string; motivoBloqueio: string | null }> {
  exigir(ctx, "compras.aprovar", "aprovar pedidos");

  return db.$transaction(
    async (tx) => {
      const linha = await travarPedido(tx, ctx, pedidoId);
      await recusarSeMudou(linha, pedidoId, versao);

      const pedido = await tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        include: { itens: true, pedidoOrigem: { select: { numero: true } } },
      });
      const total = centavosDoBanco(pedido.total);

      // A ALÇADA, conferida aqui — no servidor, dentro da transação.
      const acessos = await tx.acesso.findMany({
        where: {
          usuarioId: ctx.usuario.id,
          organizacaoId: ctx.organizacao.id,
          status: "ATIVO",
          excluidoEm: null,
          OR: [{ unidadeId: null }, { unidadeId: pedido.unidadeId }],
        },
        select: { papelId: true },
      });
      const papeis = acessos.map((a) => a.papelId);
      const alcadas: Alcada[] = (
        await tx.alcadaDeCompra.findMany({
          where: { organizacaoId: ctx.organizacao.id, chaveVigente: { not: null } },
        })
      ).map((a) => ({
        id: a.id,
        papelId: a.papelId,
        limite: a.limite === null ? null : centavosDoBanco(a.limite),
        versao: a.versao,
      }));

      const alcada = alcadaQueAprova(alcadas, papeis, total);
      const temAlcadaPropria = alcadas.some((a) => papeis.includes(a.papelId));
      // Diretor sem nenhuma alçada cadastrada para o papel dele aprova sem
      // limite — o sistema nunca fica sem aprovador. Com alçada cadastrada,
      // vale a alçada, mesmo para o Diretor.
      const implicita = !alcada && ctx.ehDiretor && !temAlcadaPropria;
      if (!alcada && !implicita) {
        const limite = limiteDaPessoa(alcadas, papeis);
        throw new AcimaDaAlcada(
          limite === undefined
            ? "Seu papel não tem alçada de aprovação cadastrada. O pedido continua aguardando."
            : `Este pedido de ${reais(total)} passa da sua alçada (${reais(limite ?? 0n)}). Ele continua aguardando quem tem alçada maior.`,
        );
      }

      if (
        !conferirTotal(
          pedido.itens.map((i) => ({ total: centavosDoBanco(i.total) })),
          centavosDoBanco(pedido.frete),
          total,
        )
      ) {
        throw new Error(
          "O total do pedido não bate com a soma das linhas. Nada foi aprovado — avise o suporte.",
        );
      }

      const fornecedor = await tx.fornecedor.findUniqueOrThrow({
        where: { id: pedido.fornecedorId },
        select: { contato: true, telefonePedidos: true, autorizadoMensagens: true },
      });
      const agora = new Date();

      const escrita = await tx.pedido.updateMany({
        where: { id: pedidoId, versao, status: "AGUARDANDO_APROVACAO" },
        data: {
          status: "APROVADO",
          versao: { increment: 1 },
          aprovadoEm: agora,
          aprovadoPorId: ctx.usuario.id,
          // O destino congelado é o do momento da APROVAÇÃO.
          destinoTelefone: fornecedor.autorizadoMensagens ? fornecedor.telefonePedidos : null,
        },
      });
      if (escrita.count !== 1) throw new PedidoMudou("O pedido mudou enquanto você olhava.");

      await tx.aprovacaoDeCompra.create({
        data: {
          organizacaoId: ctx.organizacao.id,
          unidadeId: pedido.unidadeId,
          pedidoId,
          aprovadorId: ctx.usuario.id,
          alcadaId: alcada?.id ?? null,
          alcadaVersao: alcada?.versao ?? null,
          valor: pedido.total,
          decisao: "APROVADO",
          motivo: implicita ? "Diretor sem alçada cadastrada: aprova sem limite." : null,
        },
      });

      const organizacao = await tx.organizacao.findUniqueOrThrow({
        where: { id: ctx.organizacao.id },
        select: { nome: true },
      });
      const mensagem = await enfileirar(tx, {
        organizacaoId: ctx.organizacao.id,
        unidadeId: pedido.unidadeId,
        fornecedorId: pedido.fornecedorId,
        tipo: pedido.tipo === "ADENDO" ? "ADENDO" : "PEDIDO",
        referenciaTipo: "Pedido",
        referenciaId: pedido.id,
        sequencia: pedido.sequencia,
        corpo: textoParaFornecedor(pedido, organizacao.nome, fornecedor.contato),
        chave: `pedido:${pedido.id}:${pedido.sequencia}`,
        criadoPorId: ctx.usuario.id,
      });

      await registrar(tx, ctx, {
        entidade: "Pedido",
        entidadeId: pedidoId,
        acao: "ALTEROU",
        unidadeId: pedido.unidadeId,
        antes: { status: "AGUARDANDO_APROVACAO", versao },
        depois: {
          status: "APROVADO",
          alcada: alcada ? `${alcada.id} v${alcada.versao}` : "implícita (Diretor)",
          valor: total,
          mensagem: mensagem.estado,
        },
      });

      if (pedido.rodadaId) await avancarRodadaSeTudoDecidido(tx, ctx, pedido.rodadaId);

      return {
        mensagemId: mensagem.id,
        estadoDaMensagem: mensagem.estado,
        motivoBloqueio: mensagem.motivoBloqueio,
      };
    },
    { timeout: 20_000 },
  );
}

export async function recusarPedido(
  ctx: ContextoSessao,
  pedidoId: string,
  versao: number,
  motivo: string,
): Promise<void> {
  exigir(ctx, "compras.aprovar", "recusar pedidos");
  const texto = motivo.trim();
  if (!texto) throw new Error("Diga por que o pedido foi recusado — quem comprou precisa saber.");

  await db.$transaction(async (tx) => {
    const linha = await travarPedido(tx, ctx, pedidoId);
    await recusarSeMudou(linha, pedidoId, versao);
    const pedido = await tx.pedido.findUniqueOrThrow({
      where: { id: pedidoId },
      select: { unidadeId: true, total: true, rodadaId: true },
    });
    await tx.pedido.update({
      where: { id: pedidoId },
      data: {
        status: "RECUSADO",
        versao: { increment: 1 },
        recusadoEm: new Date(),
        motivoRecusa: texto.slice(0, 300),
      },
    });
    await tx.aprovacaoDeCompra.create({
      data: {
        organizacaoId: ctx.organizacao.id,
        unidadeId: pedido.unidadeId,
        pedidoId,
        aprovadorId: ctx.usuario.id,
        valor: pedido.total,
        decisao: "RECUSADO",
        motivo: texto.slice(0, 300),
      },
    });
    await registrar(tx, ctx, {
      entidade: "Pedido",
      entidadeId: pedidoId,
      acao: "ALTEROU",
      unidadeId: pedido.unidadeId,
      antes: { status: "AGUARDANDO_APROVACAO" },
      depois: { status: "RECUSADO", motivo: texto },
    });
    if (pedido.rodadaId) await avancarRodadaSeTudoDecidido(tx, ctx, pedido.rodadaId);
  });
}

/**
 * Ajuste ANTES da aprovação: muda as embalagens de uma linha e sobe a versão
 * — quem estava para aprovar a versão anterior recebe "o pedido mudou".
 * Depois de aprovado, pedido não se edita: acrescentar é adendo, diminuir é
 * alteração.
 */
export async function ajustarItemPendente(
  ctx: ContextoSessao,
  pedidoId: string,
  itemId: string,
  embalagensTexto: string,
): Promise<void> {
  exigir(ctx, "compras.pedir", "ajustar pedidos");

  await db.$transaction(async (tx) => {
    const linha = await travarPedido(tx, ctx, pedidoId);
    if (linha.status !== "AGUARDANDO_APROVACAO") {
      throw new Error(
        "Pedido aprovado não se edita. Para acrescentar, faça um adendo; para diminuir, uma alteração — as duas vão ao fornecedor e ficam registradas.",
      );
    }
    const item = await tx.itemDePedido.findFirst({ where: { id: itemId, pedidoId } });
    if (!item) throw new Error("Item não encontrado neste pedido.");

    let valor: bigint | null;
    try {
      valor = digitado(embalagensTexto, item.fracionavel ? CASAS.milesimos : 0);
    } catch (erro) {
      if (erro instanceof NumeroInvalido) {
        throw new Error(
          item.fracionavel ? erro.message : "Informe um número inteiro de embalagens.",
        );
      }
      throw erro;
    }
    if (valor === null || valor <= 0n) {
      throw new Error("Para tirar o item, recuse o pedido ou gere de novo sem ele.");
    }

    const fator = fatorDoBanco(item.fatorConversao);
    const preco = centavosDoBanco(item.precoEmbalagem);
    const comprado = item.fracionavel ? valor : quantidadeDeEmbalagens(valor, fator);
    const total = item.fracionavel
      ? totalFracionado(valor, preco, fator)
      : totalPorEmbalagens(valor, preco);

    await tx.itemDePedido.update({
      where: { id: itemId },
      data: {
        embalagens: item.fracionavel
          ? paraDecimal(valor, CASAS.milesimos)
          : paraDecimal(valor * 1000n, CASAS.milesimos),
        quantidade: paraDecimal(comprado, CASAS.milesimos),
        adicional: paraDecimal(comprado - milesimosDoBanco(item.quantidadeNecessaria), CASAS.milesimos),
        total: paraDecimal(total, CASAS.centavos),
      },
    });

    const itens = await tx.itemDePedido.findMany({ where: { pedidoId }, select: { total: true } });
    const pedido = await tx.pedido.findUniqueOrThrow({ where: { id: pedidoId }, select: { frete: true } });
    const subtotal = itens.reduce((s, i) => s + centavosDoBanco(i.total), 0n);
    await tx.pedido.update({
      where: { id: pedidoId },
      data: {
        subtotal: paraDecimal(subtotal, CASAS.centavos),
        total: paraDecimal(subtotal + centavosDoBanco(pedido.frete), CASAS.centavos),
        versao: { increment: 1 },
      },
    });
    await registrar(tx, ctx, {
      entidade: "Pedido",
      entidadeId: pedidoId,
      acao: "ALTEROU",
      unidadeId: linha.unidadeId,
      antes: { item: item.insumoNome, embalagens: item.embalagens.toString() },
      depois: { item: item.insumoNome, embalagens: embalagensTexto },
    });
  });
}

export async function cancelarPedidoPendente(
  ctx: ContextoSessao,
  pedidoId: string,
  motivo: string,
): Promise<void> {
  exigir(ctx, "compras.pedir", "cancelar pedidos");
  const texto = motivo.trim();
  if (!texto) throw new Error("Diga o motivo do cancelamento.");
  await db.$transaction(async (tx) => {
    const linha = await travarPedido(tx, ctx, pedidoId);
    if (!["RASCUNHO", "AGUARDANDO_APROVACAO"].includes(linha.status)) {
      throw new Error(
        "Pedido aprovado se cancela com uma alteração de cancelamento, que vai ao fornecedor.",
      );
    }
    await tx.pedido.update({
      where: { id: pedidoId },
      data: {
        status: "CANCELADO",
        canceladoEm: new Date(),
        motivoCancelamento: texto.slice(0, 300),
        versao: { increment: 1 },
      },
    });
    await registrar(tx, ctx, {
      entidade: "Pedido",
      entidadeId: pedidoId,
      acao: "ALTEROU",
      unidadeId: linha.unidadeId,
      antes: { status: linha.status },
      depois: { status: "CANCELADO", motivo: texto },
    });
  });
}

/** O que o fornecedor DISSE — separado de "a mensagem chegou". */
export async function registrarConfirmacao(
  ctx: ContextoSessao,
  pedidoId: string,
  dados: {
    confirmacao: "CONFIRMADO" | "CONFIRMADO_COM_RESSALVA" | "RECUSADO";
    texto: string;
  },
): Promise<void> {
  exigir(ctx, "compras.pedir", "registrar a confirmação do fornecedor");
  const texto = dados.texto.trim();
  if (!texto) {
    throw new Error("Copie ou resuma o que o fornecedor respondeu — é a prova da confirmação.");
  }
  const pedido = await db.pedido.findFirst({
    where: {
      id: pedidoId,
      organizacaoId: ctx.organizacao.id,
      unidadeId: { in: ctx.unidadesVisiveis.map((u) => u.id) },
    },
    select: { status: true, unidadeId: true, confirmacao: true },
  });
  if (!pedido) throw new Error("Pedido não encontrado.");
  if (!["APROVADO", "CONCLUIDO"].includes(pedido.status)) {
    throw new Error("Só se registra confirmação de pedido aprovado.");
  }
  await db.pedido.update({
    where: { id: pedidoId },
    data: {
      confirmacao: dados.confirmacao,
      confirmacaoTexto: texto.slice(0, 500),
      confirmadoEm: new Date(),
      confirmacaoRegistradaPorId: ctx.usuario.id,
    },
  });
  await registrar(db, ctx, {
    entidade: "Pedido",
    entidadeId: pedidoId,
    acao: "ALTEROU",
    unidadeId: pedido.unidadeId,
    antes: { confirmacao: pedido.confirmacao },
    depois: { confirmacao: dados.confirmacao, texto },
  });
}

// ---------------------------------------------------------------- LEITURA

export type FiltroDePedidos = {
  unidadeId?: string;
  rodadaId?: string;
  status?: string;
};

export async function listarPedidos(ctx: ContextoSessao, filtro: FiltroDePedidos = {}) {
  exigir(ctx, "compras.ver", "ver compras");
  const lojas = lojasVisiveis(ctx);
  if (filtro.unidadeId && !ctx.unidadesVisiveis.some((u) => u.id === filtro.unidadeId)) {
    throw new SemPermissao("ver pedidos de outra loja");
  }

  const pedidos = await db.pedido.findMany({
    where: {
      organizacaoId: ctx.organizacao.id,
      unidadeId: filtro.unidadeId ? filtro.unidadeId : { in: lojas },
      ...(filtro.rodadaId ? { rodadaId: filtro.rodadaId } : {}),
      ...(filtro.status ? { status: filtro.status as StatusPedido } : {}),
    },
    include: {
      _count: { select: { itens: true } },
      pedidoOrigem: { select: { numero: true } },
      rodada: { select: { numero: true } },
    },
    orderBy: [{ criadoEm: "desc" }],
    take: 100,
  });

  const mensagens = await db.mensagemAoFornecedor.findMany({
    where: { referenciaTipo: "Pedido", referenciaId: { in: pedidos.map((p) => p.id) } },
    orderBy: { enfileiradaEm: "desc" },
    select: {
      referenciaId: true,
      estado: true,
      simulada: true,
      enviadaAMaoEm: true,
      motivoBloqueio: true,
    },
  });

  return pedidos.map((p) => {
    const envio = mensagens.find((m) => m.referenciaId === p.id) ?? null;
    return {
      id: p.id,
      referencia: referenciaDoPedido(p.pedidoOrigem?.numero ?? p.numero, p.sequencia),
      tipo: p.tipo,
      rodada: p.rodada?.numero ?? null,
      unidadeId: p.unidadeId,
      loja: p.unidadeNome,
      fornecedor: p.fornecedorNome,
      status: p.status,
      versao: p.versao,
      itens: p._count.itens,
      total: p.total.toString(),
      entregaDe: p.entregaDe,
      entregaAte: p.entregaAte,
      confirmacao: p.confirmacao,
      situacaoRecebimento: p.situacaoRecebimento,
      criadoEm: p.criadoEm,
      aprovadoEm: p.aprovadoEm,
      envio,
    };
  });
}

export type PedidoCompleto = NonNullable<Awaited<ReturnType<typeof obterPedido>>>;

export async function obterPedido(ctx: ContextoSessao, pedidoId: string) {
  exigir(ctx, "compras.ver", "ver compras");
  const pedido = await db.pedido.findFirst({
    where: {
      id: pedidoId,
      organizacaoId: ctx.organizacao.id,
      unidadeId: { in: lojasVisiveis(ctx) },
    },
    include: {
      itens: {
        orderBy: { ordem: "asc" },
        include: {
          itensRecebidos: {
            select: {
              quantidadeBoa: true,
              quantidadeAvariada: true,
              quantidadeRecusada: true,
              recebimento: { select: { tipo: true } },
            },
          },
        },
      },
      aprovacoes: { orderBy: { criadoEm: "asc" } },
      pedidoOrigem: { select: { id: true, numero: true } },
      adendos: {
        select: { id: true, numero: true, sequencia: true, status: true, total: true },
        orderBy: { sequencia: "asc" },
      },
      alteracoes: { include: { itens: true }, orderBy: { sequencia: "asc" } },
      recebimentos: {
        orderBy: { registradoEm: "asc" },
        include: { itens: true },
      },
      divergencias: { orderBy: { criadoEm: "asc" } },
      rodada: { select: { id: true, numero: true, descricao: true } },
    },
  });
  if (!pedido) return null;

  const pessoas = await db.usuario.findMany({
    where: {
      id: {
        in: [
          pedido.aprovadoPorId,
          pedido.criadoPorId,
          pedido.confirmacaoRegistradaPorId,
          pedido.enviadoManualmentePorId,
          ...pedido.aprovacoes.map((a) => a.aprovadorId),
          ...pedido.recebimentos.map((r) => r.recebidoPorId),
        ].filter((x): x is string => !!x),
      },
    },
    select: { id: true, nome: true },
  });
  const nome = (id: string | null) => pessoas.find((p) => p.id === id)?.nome ?? null;

  const mensagens = await mensagensDaReferencia("Pedido", pedido.id);
  const numeroRaiz = pedido.pedidoOrigem?.numero ?? pedido.numero;

  return {
    ...pedido,
    referencia: referenciaDoPedido(numeroRaiz, pedido.sequencia),
    aprovadoPor: nome(pedido.aprovadoPorId),
    criadoPor: nome(pedido.criadoPorId),
    confirmacaoRegistradaPor: nome(pedido.confirmacaoRegistradaPorId),
    enviadoManualmentePor: nome(pedido.enviadoManualmentePorId),
    aprovacoesComNome: pedido.aprovacoes.map((a) => ({ ...a, aprovador: nome(a.aprovadorId) })),
    recebimentosComNome: pedido.recebimentos.map((r) => ({ ...r, recebidoPor: nome(r.recebidoPorId) })),
    mensagens,
  };
}

/** A fila de aprovação de quem olha, com o limite da pessoa ao lado. */
export async function pendentesDeAprovacao(ctx: ContextoSessao) {
  exigir(ctx, "compras.ver", "ver compras");
  const pedidos = await listarPedidos(ctx, { status: "AGUARDANDO_APROVACAO" });

  const acessos = await db.acesso.findMany({
    where: {
      usuarioId: ctx.usuario.id,
      organizacaoId: ctx.organizacao.id,
      status: "ATIVO",
      excluidoEm: null,
    },
    select: { papelId: true, unidadeId: true },
  });
  const alcadas: Alcada[] = (
    await db.alcadaDeCompra.findMany({
      where: { organizacaoId: ctx.organizacao.id, chaveVigente: { not: null } },
    })
  ).map((a) => ({
    id: a.id,
    papelId: a.papelId,
    limite: a.limite === null ? null : centavosDoBanco(a.limite),
    versao: a.versao,
  }));

  const podeAprovar = pode(ctx, "compras.aprovar");
  return pedidos.map((p) => {
    const papeis = acessos
      .filter((a) => a.unidadeId === null || a.unidadeId === p.unidadeId)
      .map((a) => a.papelId);
    const total = centavosDoBanco(p.total);
    const alcada = alcadaQueAprova(alcadas, papeis, total);
    const implicita =
      !alcada && ctx.ehDiretor && !alcadas.some((a) => papeis.includes(a.papelId));
    return {
      ...p,
      possoAprovar: podeAprovar && (!!alcada || implicita),
      meuLimite: limiteDaPessoa(alcadas, papeis),
    };
  });
}
