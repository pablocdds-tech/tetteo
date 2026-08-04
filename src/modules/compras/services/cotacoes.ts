import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  compararPropostas,
  precoUnitario,
  type Comparacao,
  type PropostaParaComparar,
} from "../schemas/comparacao";

/**
 * AS COTAÇÕES.
 *
 * A comparação mora em `schemas/comparacao`, pura e testada. Aqui só busca,
 * grava e traduz Decimal em número.
 *
 * A cotação FECHADA não muda. Ela é a prova de por quanto cada um ofereceu
 * naquele dia, e é dessa prova que sai o histórico de preço do módulo — se
 * puder ser reescrita, o histórico não vale nada.
 */

/** Preço é local. A rede não recebe caminhão. */
export function exigirUnidade(contexto: ContextoSessao) {
  if (!contexto.unidadeAtiva) throw new ExigeUnidade();
  return contexto.unidadeAtiva;
}

export async function listarCotacoes(contexto: ContextoSessao) {
  if (!pode(contexto, "compras.ver")) throw new SemPermissao("ver compras");
  const unidade = exigirUnidade(contexto);

  const cotacoes = await db.cotacao.findMany({
    where: { unidadeId: unidade.id, canceladaEm: null },
    include: {
      _count: { select: { itens: true, propostas: true, pedidos: true } },
      propostas: { select: { status: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 50,
  });

  return cotacoes.map((c) => ({
    id: c.id,
    descricao: c.descricao,
    status: c.status,
    validaAte: c.validaAte,
    criadoEm: c.criadoEm,
    itens: c._count.itens,
    fornecedores: c._count.propostas,
    respondidas: c.propostas.filter((p) => p.status === "RESPONDIDA").length,
    pedidos: c._count.pedidos,
  }));
}

export async function criarCotacao(
  contexto: ContextoSessao,
  dados: {
    descricao: string;
    validaAte: Date | null;
    observacao: string | null;
  },
) {
  if (!pode(contexto, "compras.cotar")) {
    throw new SemPermissao("criar cotações");
  }
  const unidade = exigirUnidade(contexto);

  return db.cotacao.create({
    data: {
      unidadeId: unidade.id,
      descricao: dados.descricao,
      validaAte: dados.validaAte,
      observacao: dados.observacao,
      criadoPorId: contexto.usuario.id,
    },
  });
}

async function exigirCotacao(
  contexto: ContextoSessao,
  id: string,
  precisaEstarAberta = true,
) {
  const unidade = exigirUnidade(contexto);
  const cotacao = await db.cotacao.findFirst({
    where: { id, unidadeId: unidade.id },
    select: { id: true, status: true },
  });
  if (!cotacao) throw new Error("Cotação não encontrada.");
  if (precisaEstarAberta && cotacao.status !== "ABERTA") {
    throw new Error(
      "Esta cotação já foi fechada. Os preços viraram histórico e não mudam mais.",
    );
  }
  return cotacao;
}

export async function obterCotacao(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "compras.ver")) throw new SemPermissao("ver compras");
  const unidade = exigirUnidade(contexto);

  const cotacao = await db.cotacao.findFirst({
    where: { id, unidadeId: unidade.id },
    include: {
      itens: {
        orderBy: { ordem: "asc" },
        include: {
          insumo: {
            select: {
              id: true,
              nome: true,
              unidadeMedida: true,
              unidadeRotulo: true,
              custoMedio: true,
            },
          },
        },
      },
      propostas: {
        include: {
          fornecedor: { select: { id: true, nome: true, telefone: true } },
          precos: true,
        },
        orderBy: { criadoEm: "asc" },
      },
      pedidos: { select: { id: true, fornecedorId: true } },
    },
  });

  if (!cotacao) return null;

  const itens = cotacao.itens.map((i) => ({
    id: i.id,
    insumoId: i.insumoId,
    nome: i.insumo.nome,
    quantidade: Number(i.quantidade),
    unidade: i.insumo.unidadeRotulo ?? i.insumo.unidadeMedida,
    custoMedio: Number(i.insumo.custoMedio),
    observacao: i.observacao,
  }));

  const paraComparar: PropostaParaComparar[] = cotacao.propostas.map((p) => ({
    fornecedorId: p.fornecedorId,
    fornecedorNome: p.fornecedor.nome,
    status: p.status,
    frete: Number(p.frete),
    pedidoMinimo: p.pedidoMinimo === null ? null : Number(p.pedidoMinimo),
    precos: p.precos.map((x) => ({
      itemId: x.itemId,
      precoUnitario: Number(x.precoUnitario),
      embalagem: x.embalagem,
      naoAtende: x.naoAtende,
    })),
  }));

  const comparacao: Comparacao = compararPropostas(itens, paraComparar);

  return {
    id: cotacao.id,
    descricao: cotacao.descricao,
    status: cotacao.status,
    validaAte: cotacao.validaAte,
    observacao: cotacao.observacao,
    criadoEm: cotacao.criadoEm,
    itens,
    propostas: cotacao.propostas.map((p) => ({
      id: p.id,
      fornecedorId: p.fornecedorId,
      fornecedor: p.fornecedor.nome,
      telefone: p.fornecedor.telefone,
      status: p.status,
      frete: Number(p.frete),
      pedidoMinimo: p.pedidoMinimo === null ? null : Number(p.pedidoMinimo),
      observacao: p.observacao,
      respondidaEm: p.respondidaEm,
      precos: p.precos.map((x) => ({
        itemId: x.itemId,
        embalagem: x.embalagem,
        fatorConversao: Number(x.fatorConversao),
        precoEmbalagem: Number(x.precoEmbalagem),
        precoUnitario: Number(x.precoUnitario),
        naoAtende: x.naoAtende,
      })),
    })),
    pedidosGerados: cotacao.pedidos,
    comparacao,
  };
}

export type CotacaoCompleta = NonNullable<
  Awaited<ReturnType<typeof obterCotacao>>
>;

export async function adicionarItem(
  contexto: ContextoSessao,
  cotacaoId: string,
  dados: { insumoId: string; quantidade: number; observacao: string | null },
) {
  if (!pode(contexto, "compras.cotar")) throw new SemPermissao("cotar");
  await exigirCotacao(contexto, cotacaoId);

  const insumo = await db.insumo.count({
    where: {
      id: dados.insumoId,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
  });
  if (!insumo) throw new Error("Insumo não encontrado.");

  const ultimo = await db.itemDeCotacao.findFirst({
    where: { cotacaoId },
    orderBy: { ordem: "desc" },
    select: { ordem: true },
  });

  return db.itemDeCotacao.create({
    data: {
      cotacaoId,
      insumoId: dados.insumoId,
      quantidade: dados.quantidade,
      observacao: dados.observacao,
      ordem: (ultimo?.ordem ?? -1) + 1,
    },
  });
}

export async function removerItem(
  contexto: ContextoSessao,
  cotacaoId: string,
  itemId: string,
) {
  if (!pode(contexto, "compras.cotar")) throw new SemPermissao("cotar");
  await exigirCotacao(contexto, cotacaoId);
  await db.itemDeCotacao.deleteMany({ where: { id: itemId, cotacaoId } });
}

export async function adicionarProposta(
  contexto: ContextoSessao,
  cotacaoId: string,
  fornecedorId: string,
) {
  if (!pode(contexto, "compras.cotar")) throw new SemPermissao("cotar");
  await exigirCotacao(contexto, cotacaoId);

  const existe = await db.fornecedor.count({
    where: {
      id: fornecedorId,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
  });
  if (!existe) throw new Error("Fornecedor não encontrado.");

  return db.propostaDeCotacao.create({ data: { cotacaoId, fornecedorId } });
}

export async function removerProposta(
  contexto: ContextoSessao,
  cotacaoId: string,
  propostaId: string,
) {
  if (!pode(contexto, "compras.cotar")) throw new SemPermissao("cotar");
  await exigirCotacao(contexto, cotacaoId);
  await db.propostaDeCotacao.deleteMany({
    where: { id: propostaId, cotacaoId },
  });
}

export type PrecoRecebido = {
  itemId: string;
  embalagem: string | null;
  fatorConversao: number;
  precoEmbalagem: number;
  naoAtende: boolean;
};

/**
 * Grava a resposta inteira de um fornecedor.
 *
 * O preço unitário é calculado AQUI e guardado. Recalcular na leitura faria a
 * cotação de julho mudar se alguém corrigisse o fator da embalagem em agosto —
 * e a cotação de julho é prova, não estimativa.
 */
export async function lancarProposta(
  contexto: ContextoSessao,
  cotacaoId: string,
  propostaId: string,
  cabecalho: { frete: number; pedidoMinimo: number; observacao: string | null },
  precos: PrecoRecebido[],
) {
  if (!pode(contexto, "compras.cotar")) throw new SemPermissao("cotar");
  await exigirCotacao(contexto, cotacaoId);

  const proposta = await db.propostaDeCotacao.findFirst({
    where: { id: propostaId, cotacaoId },
    select: { id: true },
  });
  if (!proposta) throw new Error("Proposta não encontrada.");

  const itensValidos = new Set(
    (
      await db.itemDeCotacao.findMany({
        where: { cotacaoId },
        select: { id: true },
      })
    ).map((i) => i.id),
  );

  const linhas = precos
    .filter((p) => itensValidos.has(p.itemId))
    .filter((p) => p.naoAtende || p.precoEmbalagem > 0)
    .map((p) => ({
      propostaId,
      itemId: p.itemId,
      embalagem: p.embalagem,
      fatorConversao: p.naoAtende ? 1 : p.fatorConversao,
      precoEmbalagem: p.naoAtende ? 0 : p.precoEmbalagem,
      precoUnitario: p.naoAtende
        ? 0
        : (precoUnitario(p.precoEmbalagem, p.fatorConversao) ?? 0),
      naoAtende: p.naoAtende,
    }));

  // Apaga e regrava: a resposta do fornecedor é um bloco só. Atualizar linha a
  // linha deixaria preço velho de um item que ele tirou da lista.
  await db.$transaction([
    db.precoProposto.deleteMany({ where: { propostaId } }),
    db.precoProposto.createMany({ data: linhas }),
    db.propostaDeCotacao.update({
      where: { id: propostaId },
      data: {
        frete: cabecalho.frete,
        pedidoMinimo:
          cabecalho.pedidoMinimo > 0 ? cabecalho.pedidoMinimo : null,
        observacao: cabecalho.observacao,
        status: linhas.length > 0 ? "RESPONDIDA" : "AGUARDANDO",
        respondidaEm: linhas.length > 0 ? new Date() : null,
      },
    }),
  ]);

  return linhas.length;
}

export async function recusarProposta(
  contexto: ContextoSessao,
  cotacaoId: string,
  propostaId: string,
) {
  if (!pode(contexto, "compras.cotar")) throw new SemPermissao("cotar");
  await exigirCotacao(contexto, cotacaoId);

  await db.propostaDeCotacao.updateMany({
    where: { id: propostaId, cotacaoId },
    data: { status: "RECUSADA" },
  });
}

/**
 * Fecha a cotação e emite os pedidos.
 *
 * Recebe a escolha de quem compra — item por item, qual fornecedor —, e não a
 * decide sozinha. O sistema aponta o mais barato; a escolha final é de quem
 * conhece o fornecedor. O mais barato às vezes é o que entrega atrasado, e
 * essa informação não está em nenhuma coluna.
 *
 * Um pedido por fornecedor escolhido, em RASCUNHO: nada é enviado sem alguém
 * olhar de novo.
 */
export async function fecharCotacao(
  contexto: ContextoSessao,
  cotacaoId: string,
  escolhas: Map<string, string>,
) {
  if (!pode(contexto, "compras.pedir")) {
    throw new SemPermissao("emitir pedidos");
  }
  const unidade = exigirUnidade(contexto);
  await exigirCotacao(contexto, cotacaoId);

  if (escolhas.size === 0) {
    throw new Error(
      "Escolha ao menos um item antes de fechar. Fechar sem escolha só apagaria a cotação da tela.",
    );
  }

  const cotacao = await obterCotacao(contexto, cotacaoId);
  if (!cotacao) throw new Error("Cotação não encontrada.");

  const porFornecedor = new Map<
    string,
    { itemId: string; insumoId: string; quantidade: number }[]
  >();

  for (const [itemId, fornecedorId] of escolhas) {
    const item = cotacao.itens.find((i) => i.id === itemId);
    if (!item) continue;
    const atual = porFornecedor.get(fornecedorId) ?? [];
    atual.push({
      itemId,
      insumoId: item.insumoId,
      quantidade: item.quantidade,
    });
    porFornecedor.set(fornecedorId, atual);
  }

  const criados: string[] = [];

  for (const [fornecedorId, itens] of porFornecedor) {
    const proposta = cotacao.propostas.find(
      (p) => p.fornecedorId === fornecedorId,
    );
    if (!proposta) continue;

    const linhas = itens
      .map((i) => {
        const preco = proposta.precos.find((p) => p.itemId === i.itemId);
        if (!preco || preco.naoAtende) return null;
        return {
          insumoId: i.insumoId,
          quantidade: i.quantidade,
          embalagem: preco.embalagem,
          fatorConversao: preco.fatorConversao,
          precoUnitario: preco.precoUnitario,
          total: Math.round(preco.precoUnitario * i.quantidade * 100) / 100,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    if (linhas.length === 0) continue;

    const total =
      Math.round(
        (linhas.reduce((s, l) => s + l.total, 0) + proposta.frete) * 100,
      ) / 100;

    const pedido = await db.pedido.create({
      data: {
        unidadeId: unidade.id,
        fornecedorId,
        cotacaoId,
        frete: proposta.frete,
        total,
        criadoPorId: contexto.usuario.id,
        itens: { createMany: { data: linhas } },
      },
    });
    criados.push(pedido.id);
  }

  if (criados.length === 0) {
    throw new Error(
      "Nenhum item escolhido tinha preço válido. Confira as propostas antes de fechar.",
    );
  }

  await db.cotacao.update({
    where: { id: cotacaoId },
    data: { status: "FECHADA", fechadaEm: new Date() },
  });

  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: unidade.id,
      usuarioId: contexto.usuario.id,
      entidade: "Cotacao",
      entidadeId: cotacaoId,
      acao: "ALTEROU",
      valoresAntes: { status: "ABERTA" },
      valoresDepois: { status: "FECHADA", pedidos: criados.length },
    },
  });

  return criados;
}

export async function cancelarCotacao(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "compras.cotar")) throw new SemPermissao("cotar");
  await exigirCotacao(contexto, id, false);

  await db.cotacao.update({
    where: { id },
    data: { status: "CANCELADA", canceladaEm: new Date() },
  });
}

/** Os insumos que podem entrar numa cotação. */
export async function insumosDisponiveis(contexto: ContextoSessao) {
  if (!pode(contexto, "compras.ver")) throw new SemPermissao("ver compras");

  return db.insumo.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
      ativo: true,
    },
    select: {
      id: true,
      nome: true,
      unidadeMedida: true,
      unidadeRotulo: true,
    },
    orderBy: { nome: "asc" },
  });
}
