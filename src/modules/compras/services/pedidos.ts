import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { sigla } from "@/lib/unidades";
import { db } from "@/server/db";

import { exigirUnidade } from "./cotacoes";

/**
 * OS PEDIDOS.
 *
 * O ciclo é curto de propósito: RASCUNHO → ENVIADO → RECEBIDO.
 *
 * "Recebido" aqui significa **o caminhão chegou**, e não "a mercadoria entrou
 * no estoque". Quem dá entrada é o Estoque, com a nota na mão, conferindo o
 * que veio contra o que foi pedido. São dois momentos e frequentemente dois
 * números — o caminhão vem com menos, ou com outra marca — e é exatamente essa
 * divergência que precisa ficar visível.
 *
 * Por isso o pedido NÃO cria nota de entrada sozinho. Criar dobraria o
 * lançamento no dia em que a entrega viesse diferente, e um estoque com
 * mercadoria que nunca chegou é pior do que um estoque desatualizado.
 */

export async function listarPedidos(
  contexto: ContextoSessao,
  filtro?: { status?: "RASCUNHO" | "ENVIADO" | "RECEBIDO" | "CANCELADO" },
) {
  if (!pode(contexto, "compras.ver")) throw new SemPermissao("ver compras");
  const unidade = exigirUnidade(contexto);

  const pedidos = await db.pedido.findMany({
    where: {
      unidadeId: unidade.id,
      ...(filtro?.status ? { status: filtro.status } : {}),
    },
    include: {
      fornecedor: { select: { id: true, nome: true, telefone: true } },
      _count: { select: { itens: true } },
    },
    orderBy: [{ status: "asc" }, { criadoEm: "desc" }],
    take: 80,
  });

  return pedidos.map((p) => ({
    id: p.id,
    fornecedor: p.fornecedor.nome,
    fornecedorId: p.fornecedor.id,
    telefone: p.fornecedor.telefone,
    status: p.status,
    itens: p._count.itens,
    total: Number(p.total),
    previsaoEntrega: p.previsaoEntrega,
    criadoEm: p.criadoEm,
    enviadoEm: p.enviadoEm,
    recebidoEm: p.recebidoEm,
  }));
}

export async function obterPedido(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "compras.ver")) throw new SemPermissao("ver compras");
  const unidade = exigirUnidade(contexto);

  const pedido = await db.pedido.findFirst({
    where: { id, unidadeId: unidade.id },
    include: {
      fornecedor: true,
      cotacao: { select: { id: true, descricao: true } },
      itens: {
        include: {
          insumo: {
            select: { nome: true, unidadeMedida: true, unidadeRotulo: true },
          },
        },
      },
    },
  });

  if (!pedido) return null;

  return {
    id: pedido.id,
    status: pedido.status,
    fornecedor: pedido.fornecedor,
    cotacao: pedido.cotacao,
    frete: Number(pedido.frete),
    total: Number(pedido.total),
    previsaoEntrega: pedido.previsaoEntrega,
    observacao: pedido.observacao,
    criadoEm: pedido.criadoEm,
    enviadoEm: pedido.enviadoEm,
    recebidoEm: pedido.recebidoEm,
    itens: pedido.itens.map((i) => ({
      id: i.id,
      nome: i.insumo.nome,
      unidade: i.insumo.unidadeRotulo ?? i.insumo.unidadeMedida,
      quantidade: Number(i.quantidade),
      embalagem: i.embalagem,
      fatorConversao: Number(i.fatorConversao),
      precoUnitario: Number(i.precoUnitario),
      total: Number(i.total),
    })),
  };
}

/**
 * Muda o estado do pedido.
 *
 * As transições são de mão única: um pedido enviado não volta a rascunho,
 * porque o fornecedor já recebeu a lista. Quem errou cancela e refaz — que
 * deixa rastro, ao contrário de editar um pedido que já saiu.
 */
export async function moverPedido(
  contexto: ContextoSessao,
  id: string,
  destino: "ENVIADO" | "RECEBIDO" | "CANCELADO",
) {
  if (!pode(contexto, "compras.pedir")) {
    throw new SemPermissao("mexer em pedidos");
  }
  const unidade = exigirUnidade(contexto);

  const pedido = await db.pedido.findFirst({
    where: { id, unidadeId: unidade.id },
    select: { id: true, status: true },
  });
  if (!pedido) throw new Error("Pedido não encontrado.");

  const permitido: Record<string, string[]> = {
    RASCUNHO: ["ENVIADO", "CANCELADO"],
    ENVIADO: ["RECEBIDO", "CANCELADO"],
    RECEBIDO: [],
    CANCELADO: [],
  };

  if (!permitido[pedido.status].includes(destino)) {
    throw new Error(
      `Um pedido ${pedido.status.toLowerCase()} não pode ir para ${destino.toLowerCase()}.`,
    );
  }

  const agora = new Date();
  await db.pedido.update({
    where: { id },
    data: {
      status: destino,
      enviadoEm: destino === "ENVIADO" ? agora : undefined,
      recebidoEm: destino === "RECEBIDO" ? agora : undefined,
      canceladoEm: destino === "CANCELADO" ? agora : undefined,
    },
  });

  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: unidade.id,
      usuarioId: contexto.usuario.id,
      entidade: "Pedido",
      entidadeId: id,
      acao: "ALTEROU",
      valoresAntes: { status: pedido.status },
      valoresDepois: { status: destino },
    },
  });
}

export async function definirPrevisao(
  contexto: ContextoSessao,
  id: string,
  previsao: Date | null,
) {
  if (!pode(contexto, "compras.pedir")) {
    throw new SemPermissao("mexer em pedidos");
  }
  const unidade = exigirUnidade(contexto);

  await db.pedido.updateMany({
    where: { id, unidadeId: unidade.id },
    data: { previsaoEntrega: previsao },
  });
}

/**
 * O pedido em texto, pronto para colar no WhatsApp.
 *
 * É assim que o pedido chega ao fornecedor de verdade numa pizzaria — não por
 * EDI, não por e-mail formatado. Gerar o texto certo aqui evita a digitação
 * manual que é onde a quantidade errada entra.
 */
export function pedidoEmTexto(pedido: {
  fornecedor: { nome: string };
  itens: { nome: string; quantidade: number; unidade: string }[];
  previsaoEntrega: Date | null;
}) {
  const linhas = [
    `*Pedido — ${pedido.fornecedor.nome}*`,
    "",
    ...pedido.itens.map(
      // `sigla` e não o código cru: o fornecedor lê "40 kg", não "40 KG".
      (i) =>
        `• ${i.nome}: ${i.quantidade.toLocaleString("pt-BR")} ${sigla(i.unidade)}`,
    ),
  ];

  if (pedido.previsaoEntrega) {
    linhas.push(
      "",
      `Entrega combinada: ${pedido.previsaoEntrega.toLocaleDateString("pt-BR")}`,
    );
  }

  return linhas.join("\n");
}
