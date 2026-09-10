import { db } from "@/server/db";

import type { RespostaBruta } from "../schemas/proposta";
import { aplicarSugestao } from "../services/comparacao";
import { aprovarPedido, gerarPedidos } from "../services/pedidos";
import { registrarPeloComprador } from "../services/propostas";
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

/**
 * Os dois pedidos da rodada padrão, APROVADOS pelo Diretor:
 *   Centro · Distribuidora A — 2 caixas de molho (12 × 900 g, R$ 95,40) e
 *            10 peças de mussarela de 1 kg (R$ 32), frete R$ 25 → R$ 535,80
 *   Sul    · Distribuidora A — 1 caixa de molho, frete R$ 25 → R$ 120,40
 */
export async function pedidosAprovados(c: Cenario) {
  const r = await rodadaEmCotacao(c);
  const a = r.sol(c.fornecedores.a.id);
  const b = r.sol(c.fornecedores.b.id);
  await registrarPeloComprador(
    r.comprador,
    a.id,
    respostaBruta(
      [
        { id: a.item("Molho de tomate"), pecas: "12", conteudo: "900", unidadeConteudo: "G", preco: "95,40" },
        { id: a.item("Mussarela"), nomeEmbalagem: "Peça", pecas: "1", conteudo: "1", unidadeConteudo: "KG", preco: "32" },
      ],
      { frete: "25" },
    ),
    { origem: "COMPRADOR_DIGITOU" },
  );
  await registrarPeloComprador(
    r.comprador,
    b.id,
    respostaBruta(
      [{ id: b.item("Molho de tomate"), pecas: "1", conteudo: "10", unidadeConteudo: "KG", preco: "300" }],
      { frete: "0" },
    ),
    { origem: "COMPRADOR_DIGITOU" },
  );
  await moverRodada(r.comprador, r.id, { versao: 3, para: "REVISAO" });
  await aplicarSugestao(r.comprador, r.id);
  const oleo = await db.itemDaRodada.findFirstOrThrow({
    where: { rodadaId: r.id, insumoId: c.insumos.oleo.id },
  });
  await gerarPedidos(r.comprador, r.id, { ignorar: [oleo.id] });

  const diretor = await c.ctx(c.diretor, null);
  for (const p of await db.pedido.findMany({ select: { id: true } })) {
    await aprovarPedido(diretor, p.id, 1);
  }
  const pedidos = await db.pedido.findMany({ include: { itens: true } });
  return {
    rodadaId: r.id,
    comprador: r.comprador,
    diretor,
    centro: pedidos.find((p) => p.unidadeId === c.centro.id)!,
    sul: pedidos.find((p) => p.unidadeId === c.sul.id)!,
  };
}
