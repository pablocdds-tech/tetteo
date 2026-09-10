import { db } from "@/server/db";

import type { RespostaBruta } from "../schemas/proposta";
import {
  enviarRequisicao,
  requisicaoDaLoja,
  salvarItem,
} from "../services/requisicoes";
import { criarRodada, moverRodada } from "../services/rodadas";

import type { Cenario } from "./cenario";

/**
 * ATALHOS DE FLUXO para os testes com banco: levar uma rodada fictícia até o
 * ponto que cada teste precisa, sempre pelos MESMOS serviços que as telas
 * usam — nada de gravar direto no banco o que um serviço deveria gravar.
 */

const DIA = 86_400_000;

export async function pedirNaLoja(
  c: Cenario,
  quem: { id: string },
  loja: { id: string },
  rodadaId: string,
  itens: [string, string][],
  enviar = true,
) {
  const ctx = await c.ctx(quem, loja);
  const req = (await requisicaoDaLoja(ctx, rodadaId))!;
  for (const [insumoId, quantidade] of itens) {
    await salvarItem(ctx, req.id, {
      insumoId,
      quantidade,
      embalagemPreferida: null,
      observacao: null,
    });
  }
  if (enviar) {
    const atual = (await requisicaoDaLoja(ctx, rodadaId))!;
    await enviarRequisicao(ctx, req.id, atual.versao);
  }
  return ctx;
}

/**
 * Uma rodada EM COTAÇÃO: A e B vendem molho; A também vende mussarela; ninguém
 * vende óleo. O Centro pede molho e mussarela; o Sul pede molho e óleo.
 */
export async function rodadaEmCotacao(
  c: Cenario,
  pedidos: {
    centro?: [string, string][];
    sul?: [string, string][];
  } = {},
) {
  await db.fornecedorInsumo.createMany({
    data: [
      { fornecedorId: c.fornecedores.a.id, insumoId: c.insumos.molho.id, nomeEmbalagem: "Caixa" },
      { fornecedorId: c.fornecedores.b.id, insumoId: c.insumos.molho.id, nomeEmbalagem: "Caixa" },
      { fornecedorId: c.fornecedores.a.id, insumoId: c.insumos.mussarela.id, nomeEmbalagem: "Peça" },
    ].map((p) => ({ ...p, organizacaoId: c.org.id })),
    skipDuplicates: true,
  });

  const comprador = await c.ctx(c.comprador, null);
  const agora = Date.now();
  const { id } = await criarRodada(comprador, {
    descricao: "Semana de teste",
    unidadeIds: [c.centro.id, c.sul.id],
    prazoRequisicao: new Date(agora + DIA),
    prazoCotacao: new Date(agora + 2 * DIA),
    entregaDe: new Date(agora + 3 * DIA),
    entregaAte: new Date(agora + 4 * DIA),
    responsavelId: null,
    observacao: null,
  });
  await moverRodada(comprador, id, { versao: 1, para: "COLETANDO" });

  await pedirNaLoja(c, c.gerenteCentro, c.centro, id, pedidos.centro ?? [
    [c.insumos.molho.id, "20"],
    [c.insumos.mussarela.id, "10"],
  ]);
  await pedirNaLoja(c, c.gerenteSul, c.sul, id, pedidos.sul ?? [
    [c.insumos.molho.id, "5"],
    [c.insumos.oleo.id, "6"],
  ]);

  await moverRodada(comprador, id, { versao: 2, para: "COTANDO" });

  const solicitacoes = await db.solicitacaoDeCotacao.findMany({
    where: { rodadaId: id },
    include: {
      itens: { include: { itemDaRodada: { include: { insumo: true } } } },
    },
  });

  const sol = (fornecedorId: string) => {
    const s = solicitacoes.find((x) => x.fornecedorId === fornecedorId);
    if (!s) throw new Error("O fornecedor não recebeu solicitação nesta rodada.");
    return {
      id: s.id,
      item: (nome: string) => {
        const i = s.itens.find((x) => x.itemDaRodada.insumo.nome === nome);
        if (!i) throw new Error(`${nome} não está na solicitação.`);
        return i.id;
      },
    };
  };

  return { id, comprador, sol };
}

type ItemDaResposta = {
  id: string;
  situacao?: "COTADO" | "INDISPONIVEL" | "SEM_RESPOSTA";
  preco?: string;
  pecas?: string;
  conteudo?: string;
  unidadeConteudo?: "" | "KG" | "G" | "L" | "ML" | "UN";
  fracionavel?: boolean;
  nomeEmbalagem?: string;
  disponivel?: string;
};

export function respostaBruta(
  itens: ItemDaResposta[],
  cabecalho: Partial<Omit<RespostaBruta, "itens">> = {},
): RespostaBruta {
  return {
    frete: "",
    pedidoMinimo: "",
    prazoEntregaDias: "",
    validaAte: "",
    observacao: "",
    ...cabecalho,
    itens: itens.map((i) => ({
      itemDaSolicitacaoId: i.id,
      situacao: i.situacao ?? "COTADO",
      nomeEmbalagem: i.nomeEmbalagem ?? "Caixa",
      pecas: i.pecas ?? "1",
      conteudo: i.conteudo ?? "",
      unidadeConteudo: i.unidadeConteudo ?? "",
      fracionavel: i.fracionavel ?? false,
      precoEmbalagem: i.preco ?? "",
      disponivel: i.disponivel ?? "",
      observacao: "",
    })),
  };
}
