import type { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import type { Unidade } from "@/lib/unidades";
import { db } from "@/server/db";

import {
  CASAS,
  milesimosDoBanco,
  paraDecimal,
  precoPorUnidade,
  quantidadeBr,
} from "../schemas/aritmetica";
import { fatorDaEmbalagem } from "../schemas/embalagem";
import {
  MENSAGEM_DO_LINK,
  podeVer,
  situacaoDoLink,
  type SituacaoDoLink,
} from "../schemas/link";
import { validarResposta, type RespostaValidada } from "../schemas/proposta";

import { registrar } from "./auditoria";
import { hashDoCodigo, pareceCodigo } from "./cripto-do-link";

/**
 * AS PROPOSTAS — o que o fornecedor respondeu, em VERSÕES.
 *
 * Duas portas, uma regra:
 *
 *   PELO LINK       o fornecedor, sem login. A solicitação é achada pelo hash
 *                   do código e TRAVADA (`FOR UPDATE`) durante o envio — dois
 *                   envios ao mesmo tempo viram versões 2 e 3, nunca duas 2.
 *                   Envio com defeito conta tentativa inválida; dez seguidas
 *                   bloqueiam o link.
 *
 *   PELO COMPRADOR  o que chegou pelo WhatsApp, digitado. Depois de encerrada
 *                   a cotação, só como NEGOCIAÇÃO, com motivo.
 *
 * Nada é sobrescrito. A comparação usa a última versão; as anteriores ficam.
 */

type Tx = Prisma.TransactionClient;

const INVALIDO =
  "Este link não é válido. Confira se ele foi copiado inteiro, ou peça outro a quem enviou.";

const dataBr = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

type ItemProprio = { id: string; base: Unidade };

async function gravarVersao(
  tx: Tx,
  s: { id: string; versaoAtual: number },
  resposta: RespostaValidada,
  proprios: Map<string, ItemProprio>,
  meta: {
    origem: "FORNECEDOR_LINK" | "COMPRADOR_DIGITOU" | "NEGOCIACAO";
    registradaPorId: string | null;
    motivo: string | null;
  },
): Promise<number> {
  const numero = s.versaoAtual + 1;

  const versao = await tx.versaoDeProposta.create({
    data: {
      solicitacaoId: s.id,
      numero,
      origem: meta.origem,
      registradaPorId: meta.registradaPorId,
      motivo: meta.motivo,
      frete: resposta.frete === null ? null : paraDecimal(resposta.frete, CASAS.centavos),
      pedidoMinimo:
        resposta.pedidoMinimo === null
          ? null
          : paraDecimal(resposta.pedidoMinimo, CASAS.centavos),
      prazoEntregaDias: resposta.prazoEntregaDias,
      validaAte: resposta.validaAte,
      observacao: resposta.observacao,
    },
    select: { id: true },
  });

  await tx.itemDeProposta.createMany({
    data: resposta.ofertas.map((o) => {
      const base = proprios.get(o.itemDaSolicitacaoId)!.base;
      if (o.situacao === "INDISPONIVEL") {
        return {
          versaoId: versao.id,
          itemDaSolicitacaoId: o.itemDaSolicitacaoId,
          situacao: "INDISPONIVEL" as const,
          observacao: o.observacao,
        };
      }
      // O fator é calculado AQUI, no servidor, pela dimensão do insumo. Fator
      // desconhecido ou incompatível é gravado como tal — com o motivo — e
      // bloqueia a comparação automática do item.
      const fator = fatorDaEmbalagem(base, {
        pecas: o.pecas,
        conteudo: o.conteudo,
        unidadeConteudo: o.unidadeConteudo,
        fracionavel: o.fracionavel,
      });
      const preco = o.precoEmbalagem!;
      return {
        versaoId: versao.id,
        itemDaSolicitacaoId: o.itemDaSolicitacaoId,
        situacao: "COTADO" as const,
        nomeEmbalagem: o.nomeEmbalagem,
        pecas: o.pecas,
        conteudo: o.conteudo === null ? null : paraDecimal(o.conteudo, CASAS.dezMilesimos),
        unidadeConteudo: o.unidadeConteudo,
        fracionavel: o.fracionavel,
        fator: fator.ok ? paraDecimal(fator.fator, CASAS.dezMilesimos) : null,
        fatorMotivo: fator.ok ? null : fator.mensagem,
        precoEmbalagem: paraDecimal(preco, CASAS.centavos),
        precoUnitario: fator.ok
          ? paraDecimal(precoPorUnidade(preco, fator.fator), CASAS.micros)
          : null,
        precoZeroAutorizado: preco === 0n,
        precoZeroMotivo: preco === 0n ? meta.motivo : null,
        precoZeroPorId: preco === 0n ? meta.registradaPorId : null,
        disponivel: o.disponivel === null ? null : paraDecimal(o.disponivel, CASAS.milesimos),
        observacao: o.observacao,
      };
    }),
  });

  await tx.solicitacaoDeCotacao.update({
    where: { id: s.id },
    data: { versaoAtual: numero },
  });

  return numero;
}

async function itensProprios(tx: Tx, solicitacaoId: string) {
  const itens = await tx.itemDaSolicitacao.findMany({
    where: { solicitacaoId },
    select: {
      id: true,
      itemDaRodada: { select: { insumo: { select: { unidadeMedida: true } } } },
    },
  });
  return new Map<string, ItemProprio>(
    itens.map((i) => [i.id, { id: i.id, base: i.itemDaRodada.insumo.unidadeMedida }]),
  );
}

// ------------------------------------------------------------- PELO LINK

export type ResultadoDoLink =
  | { ok: true; versao: number }
  | { ok: false; mensagem: string; erros?: Record<string, string> };

export async function registrarPeloLink(
  codigo: string,
  bruto: unknown,
  agora = new Date(),
): Promise<ResultadoDoLink> {
  if (!pareceCodigo(codigo)) return { ok: false, mensagem: INVALIDO };
  const hash = hashDoCodigo(codigo);

  return db.$transaction(
    async (tx): Promise<ResultadoDoLink> => {
      const [linha] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "solicitacao_de_cotacao" WHERE "tokenHash" = ${hash} FOR UPDATE`;
      if (!linha) return { ok: false, mensagem: INVALIDO };

      const s = await tx.solicitacaoDeCotacao.findUniqueOrThrow({
        where: { id: linha.id },
        include: { rodada: { select: { estado: true, organizacaoId: true } } },
      });

      const situacao = situacaoDoLink(
        {
          expiraEm: s.tokenExpiraEm,
          revogadoEm: s.tokenRevogadoEm,
          tentativasInvalidas: s.tentativasInvalidas,
          versoes: s.versaoAtual,
          ultimoEnvioEm: s.ultimoEnvioEm,
          rodadaEmCotacao: s.rodada.estado === "COTANDO",
        },
        agora,
      );
      if (situacao !== "valido") {
        return { ok: false, mensagem: MENSAGEM_DO_LINK[situacao] };
      }

      const invalida = async (
        mensagem: string,
        erros?: Record<string, string>,
      ): Promise<ResultadoDoLink> => {
        await tx.solicitacaoDeCotacao.update({
          where: { id: s.id },
          data: { tentativasInvalidas: { increment: 1 } },
        });
        return { ok: false, mensagem, erros };
      };

      const validacao = validarResposta(bruto, { permitirZero: false });
      if (!validacao.ok) {
        return invalida("Há campos para corrigir antes de enviar.", validacao.erros);
      }

      const proprios = await itensProprios(tx, s.id);
      if (validacao.resposta.ofertas.some((o) => !proprios.has(o.itemDaSolicitacaoId))) {
        return invalida("A resposta trouxe um item que não foi pedido à sua empresa.");
      }
      if (validacao.resposta.ofertas.length === 0) {
        return {
          ok: false,
          mensagem: "Nada para enviar: informe o preço de ao menos um item, ou marque os que não tem.",
        };
      }

      const numero = await gravarVersao(tx, s, validacao.resposta, proprios, {
        origem: "FORNECEDOR_LINK",
        registradaPorId: null,
        motivo: null,
      });

      await tx.solicitacaoDeCotacao.update({
        where: { id: s.id },
        data: { status: "RESPONDIDA", ultimoEnvioEm: agora, tentativasInvalidas: 0 },
      });

      await registrar(tx, null, {
        organizacaoId: s.rodada.organizacaoId,
        entidade: "SolicitacaoDeCotacao",
        entidadeId: s.id,
        acao: "ALTEROU",
        depois: {
          versao: numero,
          origem: "FORNECEDOR_LINK",
          ofertas: validacao.resposta.ofertas.length,
        },
      });

      return { ok: true, versao: numero };
    },
    { timeout: 20_000 },
  );
}

// ---------------------------------------------------------- PELO COMPRADOR

export async function registrarPeloComprador(
  ctx: ContextoSessao,
  solicitacaoId: string,
  bruto: unknown,
  opcoes: {
    origem: "COMPRADOR_DIGITOU" | "NEGOCIACAO";
    motivo?: string | null;
    autorizarZero?: boolean;
  },
): Promise<{ ok: true; versao: number } | { ok: false; erros: Record<string, string> }> {
  if (!pode(ctx, "compras.cotar")) throw new SemPermissao("lançar propostas");
  const motivo = opcoes.motivo?.trim().slice(0, 300) || null;

  return db.$transaction(
    async (tx) => {
      const [linha] = await tx.$queryRaw<{ id: string; organizacaoId: string }[]>`
        SELECT "id", "organizacaoId" FROM "solicitacao_de_cotacao"
        WHERE "id" = ${solicitacaoId} FOR UPDATE`;
      if (!linha || linha.organizacaoId !== ctx.organizacao.id) {
        throw new Error("Solicitação não encontrada.");
      }
      const s = await tx.solicitacaoDeCotacao.findUniqueOrThrow({
        where: { id: solicitacaoId },
        include: { rodada: { select: { estado: true } } },
      });

      const estado = s.rodada.estado;
      if (estado === "COTANDO") {
        if (opcoes.origem === "NEGOCIACAO" && !motivo) {
          throw new Error("Negociação exige o motivo.");
        }
      } else if (estado === "REVISAO") {
        if (opcoes.origem !== "NEGOCIACAO" || !motivo) {
          throw new Error(
            "A cotação já foi encerrada. Proposta nova agora só como negociação registrada, com o motivo — ou reabrindo a rodada.",
          );
        }
      } else {
        throw new Error("Esta rodada não aceita propostas agora.");
      }

      const validacao = validarResposta(bruto, {
        permitirZero: opcoes.autorizarZero === true,
      });
      if (!validacao.ok) return { ok: false as const, erros: validacao.erros };

      const temZero = validacao.resposta.ofertas.some((o) => o.precoEmbalagem === 0n);
      if (temZero && !motivo) {
        return {
          ok: false as const,
          erros: {
            geral:
              "Preço zero é condição especial: escreva o motivo (ex.: bonificação combinada com o vendedor).",
          },
        };
      }

      const proprios = await itensProprios(tx, s.id);
      if (validacao.resposta.ofertas.some((o) => !proprios.has(o.itemDaSolicitacaoId))) {
        throw new Error("A resposta trouxe item de outra solicitação.");
      }

      const numero = await gravarVersao(tx, s, validacao.resposta, proprios, {
        origem: opcoes.origem,
        registradaPorId: ctx.usuario.id,
        motivo,
      });

      await tx.solicitacaoDeCotacao.update({
        where: { id: s.id },
        data: {
          status:
            estado === "COTANDO"
              ? "RESPONDIDA"
              : s.status === "ENCERRADA_SEM_RESPOSTA"
                ? "ENCERRADA"
                : s.status,
        },
      });

      await registrar(tx, ctx, {
        entidade: "SolicitacaoDeCotacao",
        entidadeId: s.id,
        acao: "ALTEROU",
        depois: { versao: numero, origem: opcoes.origem, motivo, precoZero: temZero },
      });

      return { ok: true as const, versao: numero };
    },
    { timeout: 20_000 },
  );
}

/** As versões de uma solicitação, da mais nova para a mais antiga. */
export async function versoesDaSolicitacao(ctx: ContextoSessao, solicitacaoId: string) {
  if (!pode(ctx, "compras.ver")) throw new SemPermissao("ver compras");
  const s = await db.solicitacaoDeCotacao.findFirst({
    where: { id: solicitacaoId, organizacaoId: ctx.organizacao.id },
    include: {
      fornecedor: { select: { nome: true } },
      itens: {
        include: {
          itemDaRodada: {
            select: {
              quantidadeTotal: true,
              insumo: { select: { nome: true, unidadeMedida: true } },
            },
          },
        },
      },
      versoes: { orderBy: { numero: "desc" }, include: { itens: true } },
    },
  });
  return s;
}

// ------------------------------------------------------ O QUE O LINK MOSTRA

export type VistaDoFornecedor = {
  organizacao: string;
  fornecedor: string;
  rodada: string;
  prazo: string | null;
  entrega: string | null;
  podeEnviar: boolean;
  aviso: string | null;
  lojas: { nome: string; endereco: string | null }[];
  itens: {
    itemDaSolicitacaoId: string;
    nome: string;
    unidade: string;
    quantidade: string;
    porLoja: { loja: string; quantidade: string }[];
    direcionado: boolean;
  }[];
  ultimaVersao: {
    numero: number;
    recebidaEm: string;
    frete: string | null;
    pedidoMinimo: string | null;
    prazoEntregaDias: number | null;
    observacao: string | null;
    ofertas: {
      itemDaSolicitacaoId: string;
      situacao: "COTADO" | "INDISPONIVEL";
      nomeEmbalagem: string | null;
      pecas: number;
      conteudo: string | null;
      unidadeConteudo: string | null;
      fracionavel: boolean;
      precoEmbalagem: string | null;
      disponivel: string | null;
      observacao: string | null;
    }[];
  } | null;
};

/**
 * O que a página pública mostra. SÓ o que é do fornecedor: os itens dele, as
 * quantidades, as lojas que recebem esses itens, e a última resposta DELE.
 * Nenhum preço de concorrente, nenhum preço de referência, nenhuma outra loja.
 */
export async function dadosDoLink(
  codigo: string,
  agora = new Date(),
): Promise<
  | { ok: true; vista: VistaDoFornecedor }
  | { ok: false; situacao: SituacaoDoLink | "invalido"; mensagem: string }
> {
  if (!pareceCodigo(codigo)) {
    return { ok: false, situacao: "invalido", mensagem: INVALIDO };
  }
  const s = await db.solicitacaoDeCotacao.findUnique({
    where: { tokenHash: hashDoCodigo(codigo) },
    include: {
      rodada: {
        select: {
          id: true,
          estado: true,
          numero: true,
          descricao: true,
          entregaDe: true,
          entregaAte: true,
          organizacaoId: true,
        },
      },
      fornecedor: { select: { nome: true } },
      itens: {
        include: {
          itemDaRodada: {
            select: {
              insumoId: true,
              quantidadeTotal: true,
              ordem: true,
              insumo: { select: { nome: true, unidadeMedida: true, unidadeRotulo: true } },
            },
          },
        },
      },
    },
  });
  if (!s) return { ok: false, situacao: "invalido", mensagem: INVALIDO };

  const situacao = situacaoDoLink(
    {
      expiraEm: s.tokenExpiraEm,
      revogadoEm: s.tokenRevogadoEm,
      tentativasInvalidas: s.tentativasInvalidas,
      versoes: s.versaoAtual,
      ultimoEnvioEm: s.ultimoEnvioEm,
      rodadaEmCotacao: s.rodada.estado === "COTANDO",
    },
    agora,
  );
  if (!podeVer(situacao)) {
    return { ok: false, situacao, mensagem: MENSAGEM_DO_LINK[situacao] };
  }

  // As lojas que recebem os itens DESTE fornecedor — e só elas.
  const insumos = s.itens.map((i) => i.itemDaRodada.insumoId);
  const origens = await db.itemDeRequisicao.findMany({
    where: {
      insumoId: { in: insumos },
      requisicao: { rodadaId: s.rodada.id, status: "ENVIADA" },
    },
    select: { insumoId: true, unidadeId: true, quantidade: true },
  });
  const unidades = await db.unidade.findMany({
    where: { id: { in: [...new Set(origens.map((o) => o.unidadeId))] } },
    select: { id: true, nome: true, endereco: true, bairro: true, cidade: true },
  });
  const nomeDa = new Map(unidades.map((u) => [u.id, u.nome]));

  const [organizacao, ultima] = await Promise.all([
    db.organizacao.findUniqueOrThrow({
      where: { id: s.rodada.organizacaoId },
      select: { nome: true },
    }),
    s.versaoAtual > 0
      ? db.versaoDeProposta.findUnique({
          where: { solicitacaoId_numero: { solicitacaoId: s.id, numero: s.versaoAtual } },
          include: { itens: true },
        })
      : null,
  ]);

  const janela =
    s.rodada.entregaDe && s.rodada.entregaAte
      ? `${dataBr.format(s.rodada.entregaDe).slice(0, 5)} a ${dataBr.format(s.rodada.entregaAte).slice(0, 5)}`
      : null;

  return {
    ok: true,
    vista: {
      organizacao: organizacao.nome,
      fornecedor: s.fornecedor.nome,
      rodada: `Rodada ${s.rodada.numero} — ${s.rodada.descricao}`,
      prazo: s.tokenExpiraEm ? dataBr.format(s.tokenExpiraEm) : null,
      entrega: janela,
      podeEnviar: situacao === "valido",
      aviso: situacao === "valido" ? null : MENSAGEM_DO_LINK[situacao],
      lojas: unidades.map((u) => ({
        nome: u.nome,
        endereco: [u.endereco, u.bairro, u.cidade].filter(Boolean).join(", ") || null,
      })),
      itens: s.itens
        .sort((a, b) => a.itemDaRodada.ordem - b.itemDaRodada.ordem)
        .map((i) => {
          const unidade = i.itemDaRodada.insumo.unidadeRotulo ?? i.itemDaRodada.insumo.unidadeMedida;
          return {
            itemDaSolicitacaoId: i.id,
            nome: i.itemDaRodada.insumo.nome,
            unidade: i.itemDaRodada.insumo.unidadeMedida,
            quantidade: quantidadeBr(milesimosDoBanco(i.itemDaRodada.quantidadeTotal), unidade),
            porLoja: origens
              .filter((o) => o.insumoId === i.itemDaRodada.insumoId)
              .map((o) => ({
                loja: nomeDa.get(o.unidadeId) ?? "Loja",
                quantidade: quantidadeBr(milesimosDoBanco(o.quantidade), unidade),
              })),
            direcionado: i.direcionado,
          };
        }),
      ultimaVersao: ultima
        ? {
            numero: ultima.numero,
            recebidaEm: dataBr.format(ultima.recebidaEm),
            frete: ultima.frete?.toString() ?? null,
            pedidoMinimo: ultima.pedidoMinimo?.toString() ?? null,
            prazoEntregaDias: ultima.prazoEntregaDias,
            observacao: ultima.observacao,
            ofertas: ultima.itens.map((o) => ({
              itemDaSolicitacaoId: o.itemDaSolicitacaoId,
              situacao: o.situacao,
              nomeEmbalagem: o.nomeEmbalagem,
              pecas: o.pecas,
              conteudo: o.conteudo?.toString() ?? null,
              unidadeConteudo: o.unidadeConteudo,
              fracionavel: o.fracionavel,
              precoEmbalagem: o.precoEmbalagem?.toString() ?? null,
              disponivel: o.disponivel?.toString() ?? null,
              observacao: o.observacao,
            })),
          }
        : null,
    },
  };
}
