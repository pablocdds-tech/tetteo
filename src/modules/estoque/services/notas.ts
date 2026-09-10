import { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { DadosItem, DadosNota } from "../schemas/nota";

/**
 * AS NOTAS DE ENTRADA.
 *
 * O ciclo tem duas fases, e a separação é o que torna a digitação segura:
 *
 *   RASCUNHO  aceita item, correção e exclusão à vontade. Não mexe em nada.
 *   LANÇADA   somou ao saldo e entrou no custo médio. Virou história.
 *
 * Digitar uma nota de vinte itens leva minutos e é interrompido no meio. Se
 * cada item já mexesse no estoque, uma nota pela metade deixaria o saldo
 * mentindo até alguém terminar.
 *
 * ---------------------------------------------------------------------------
 * A NOTA É A ÚNICA PORTA DE ENTRADA (10/09/2026).
 *
 * O recebimento de um pedido de Compras também entra por aqui: a conferência
 * cria a nota JÁ LANÇADA, ligada ao recebimento (`recebimentoId`, único), na
 * MESMA transação da conferência — por isso as funções de recebimento abaixo
 * recebem o cliente da transação de quem chama. Nota lançada à mão antes da
 * conferência é VINCULADA ao recebimento, sem nova entrada. É o que impede a
 * mesma mercadoria de entrar duas vezes no saldo, no custo e no CMV.
 * ---------------------------------------------------------------------------
 */

type Tx = Prisma.TransactionClient;

function exigirUnidade(contexto: ContextoSessao) {
  if (!contexto.unidadeAtiva) throw new ExigeUnidade();
  return contexto.unidadeAtiva;
}

/** Encontra o fornecedor pelo nome, ou cria — o cadastro não pode travar a nota. */
async function acharOuCriarFornecedor(
  contexto: ContextoSessao,
  nome: string,
): Promise<string> {
  const organizacaoId = contexto.organizacao.id;

  const existente = await db.fornecedor.findFirst({
    where: { organizacaoId, nome: { equals: nome, mode: "insensitive" } },
    select: { id: true },
  });
  if (existente) return existente.id;

  const criado = await db.fornecedor.create({
    data: { organizacaoId, nome, criadoPorId: contexto.usuario.id },
    select: { id: true },
  });
  return criado.id;
}

export async function listarFornecedores(contexto: ContextoSessao) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");

  return db.fornecedor.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
      ativo: true,
    },
    select: { id: true, nome: true, documento: true },
    orderBy: { nome: "asc" },
  });
}

export async function listarNotas(contexto: ContextoSessao) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  const notas = await db.notaEntrada.findMany({
    where: { unidadeId: unidade.id, canceladaEm: null },
    orderBy: [{ recebidaEm: "desc" }, { criadoEm: "desc" }],
    include: {
      fornecedor: { select: { nome: true } },
      _count: { select: { itens: true } },
    },
    take: 100,
  });

  return notas.map((n) => ({ ...n, totalItens: n._count.itens }));
}

export async function obterNota(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  return db.notaEntrada.findFirst({
    where: { id, unidadeId: unidade.id },
    include: {
      fornecedor: { select: { id: true, nome: true } },
      localDestino: { select: { id: true, nome: true } },
      itens: {
        include: {
          insumo: {
            select: {
              id: true,
              nome: true,
              unidadeMedida: true,
              unidadeRotulo: true,
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
}

export async function criarNota(contexto: ContextoSessao, dados: DadosNota) {
  if (!pode(contexto, "estoque.lancar")) {
    throw new SemPermissao("lançar notas de entrada");
  }
  const unidade = exigirUnidade(contexto);

  const fornecedorId = await acharOuCriarFornecedor(contexto, dados.fornecedor);

  const nota = await db.notaEntrada.create({
    data: {
      unidadeId: unidade.id,
      fornecedorId,
      numero: dados.numero || null,
      serie: dados.serie || null,
      recebidaEm: dados.recebidaEm,
      localDestinoId: dados.localDestinoId,
      observacao: dados.observacao || null,
      registradaPorId: contexto.usuario.id,
    },
  });

  await registrarAuditoria(contexto, "CRIOU", nota.id, null, {
    fornecedor: dados.fornecedor,
    numero: dados.numero ?? null,
    recebidaEm: dados.recebidaEm.toISOString(),
  });

  return nota;
}

export async function adicionarItem(
  contexto: ContextoSessao,
  notaId: string,
  dados: DadosItem,
) {
  if (!pode(contexto, "estoque.lancar")) {
    throw new SemPermissao("lançar notas de entrada");
  }
  const unidade = exigirUnidade(contexto);

  const nota = await db.notaEntrada.findFirst({
    where: { id: notaId, unidadeId: unidade.id },
    select: { id: true, status: true },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.status !== "RASCUNHO") {
    throw new Error("Esta nota já foi lançada e não aceita novos itens.");
  }

  const fator = dados.fatorConversao || 1;
  // A quantidade que vale para tudo: já convertida para a unidade base.
  const quantidade = dados.quantidadeNota * fator;
  const valorUnitario = dados.valorTotal / quantidade;

  let embalagemId: string | null = null;
  if (dados.salvarEmbalagem && dados.embalagemNome && fator !== 1) {
    const embalagem = await db.embalagemCompra.upsert({
      where: {
        insumoId_nome: {
          insumoId: dados.insumoId,
          nome: dados.embalagemNome,
        },
      },
      update: { fator, ativo: true },
      create: {
        insumoId: dados.insumoId,
        nome: dados.embalagemNome,
        fator,
      },
      select: { id: true },
    });
    embalagemId = embalagem.id;
  }

  await db.notaEntradaItem.create({
    data: {
      notaId,
      insumoId: dados.insumoId,
      quantidadeNota: dados.quantidadeNota,
      embalagemId,
      // Congelado: se a caixa mudar de tamanho, o passado não se reescreve.
      fatorConversao: fator,
      quantidade,
      valorUnitario,
      valorTotal: dados.valorTotal,
    },
  });

  await recalcularTotal(notaId);
}

export async function removerItem(
  contexto: ContextoSessao,
  notaId: string,
  itemId: string,
) {
  if (!pode(contexto, "estoque.lancar")) {
    throw new SemPermissao("lançar notas de entrada");
  }
  const unidade = exigirUnidade(contexto);

  const nota = await db.notaEntrada.findFirst({
    where: { id: notaId, unidadeId: unidade.id },
    select: { id: true, status: true },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.status !== "RASCUNHO") {
    throw new Error("Esta nota já foi lançada e não aceita alterações.");
  }

  await db.notaEntradaItem.deleteMany({ where: { id: itemId, notaId } });
  await recalcularTotal(notaId);
}

async function recalcularTotal(notaId: string) {
  const soma = await db.notaEntradaItem.aggregate({
    where: { notaId },
    _sum: { valorTotal: true },
  });

  await db.notaEntrada.update({
    where: { id: notaId },
    data: { valorTotal: soma._sum.valorTotal ?? 0 },
  });
}

/**
 * O MIOLO DO LANÇAMENTO — o papel vira estoque e custo.
 *
 * Duas coisas acontecem por item, e as duas importam:
 *
 *   SALDO   soma no lugar de destino da nota.
 *   CUSTO   entra na MÉDIA PONDERADA, não substitui. Comprar 2kg a R$50
 *           tendo 100kg a R$30 não faz o estoque valer R$50 o quilo — e é
 *           essa média que custeia a contagem e, por consequência, o CMV.
 *
 * Os insumos são TRAVADOS (em ordem, para duas notas nunca se esperarem em
 * cruz): duas entradas do mesmo queijo ao mesmo tempo não calculam a média a
 * partir do mesmo saldo antigo.
 */
async function postarNota(tx: Tx, notaId: string, usuarioId: string) {
  const nota = await tx.notaEntrada.findUniqueOrThrow({
    where: { id: notaId },
    include: { itens: true },
  });
  if (nota.status !== "RASCUNHO") throw new Error("Esta nota já foi lançada.");
  if (nota.itens.length === 0) {
    throw new Error("A nota não tem itens. Acrescente ao menos um.");
  }
  if (!nota.localDestinoId) {
    throw new Error(
      "Escolha onde a mercadoria foi guardada antes de lançar — o saldo precisa de um lugar.",
    );
  }
  const localId = nota.localDestinoId;

  const insumoIds = [...new Set(nota.itens.map((i) => i.insumoId))].sort();
  await tx.$queryRaw`
    SELECT "id" FROM "insumo" WHERE "id" IN (${Prisma.join(insumoIds)})
    ORDER BY "id" FOR UPDATE`;

  // O saldo atual de cada insumo na unidade INTEIRA: a média ponderada é do
  // insumo, não do lugar. O mesmo queijo não tem dois custos por estar em
  // duas geladeiras.
  const posicoes = await tx.posicaoEstoque.findMany({
    where: { unidadeId: nota.unidadeId, insumoId: { in: insumoIds } },
    select: { insumoId: true, quantidade: true, localId: true },
  });
  const insumos = await tx.insumo.findMany({
    where: { id: { in: insumoIds } },
    select: { id: true, custoMedio: true },
  });
  const custoAtual = new Map(insumos.map((i) => [i.id, Number(i.custoMedio)]));

  const saldoPorInsumo = new Map<string, number>();
  for (const p of posicoes) {
    saldoPorInsumo.set(
      p.insumoId,
      (saldoPorInsumo.get(p.insumoId) ?? 0) + Number(p.quantidade),
    );
  }

  for (const insumoId of insumoIds) {
    const doInsumo = nota.itens.filter((i) => i.insumoId === insumoId);
    const quantidadeEntrada = doInsumo.reduce((s, i) => s + Number(i.quantidade), 0);
    const valorEntrada = doInsumo.reduce((s, i) => s + Number(i.valorTotal), 0);
    const precoEntrada = valorEntrada / quantidadeEntrada;

    const saldo = saldoPorInsumo.get(insumoId) ?? 0;
    const medioAnterior = custoAtual.get(insumoId) ?? 0;

    // Sem saldo (ou sem custo conhecido), a entrada VIRA a média. Ponderar
    // contra zero daria zero e apagaria o custo do insumo.
    const novoMedio =
      saldo > 0 && medioAnterior > 0
        ? (saldo * medioAnterior + quantidadeEntrada * precoEntrada) /
          (saldo + quantidadeEntrada)
        : precoEntrada;

    await tx.insumo.update({
      where: { id: insumoId },
      data: {
        custoMedio: novoMedio,
        custoUltimo: precoEntrada,
        atualizadoPorId: usuarioId,
      },
    });

    await tx.posicaoEstoque.upsert({
      where: { localId_insumoId: { localId, insumoId } },
      update: { quantidade: { increment: quantidadeEntrada } },
      create: {
        unidadeId: nota.unidadeId,
        localId,
        insumoId,
        quantidade: quantidadeEntrada,
      },
    });
  }

  await tx.notaEntrada.update({
    where: { id: notaId },
    data: { status: "LANCADA", lancadaEm: new Date() },
  });

  return { itens: nota.itens.length, valor: Number(nota.valorTotal) };
}

/**
 * LANÇAR: o momento em que o papel vira estoque e custo. Tudo numa
 * transação: metade lançada seria pior que nada lançado.
 */
export async function lancarNota(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.lancar")) {
    throw new SemPermissao("lançar notas de entrada");
  }
  const unidade = exigirUnidade(contexto);

  const nota = await db.notaEntrada.findFirst({
    where: { id, unidadeId: unidade.id },
    select: { id: true, status: true },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.status !== "RASCUNHO") throw new Error("Esta nota já foi lançada.");

  const resumo = await db.$transaction(
    (tx) => postarNota(tx, id, contexto.usuario.id),
    { timeout: 20_000 },
  );

  await registrarAuditoria(
    contexto,
    "ALTEROU",
    id,
    { status: "RASCUNHO" },
    { status: "LANCADA", itens: resumo.itens, valor: resumo.valor },
  );
}

/**
 * Cancelar.
 *
 * Rascunho some sem consequência. Lançada devolve o saldo ao que era — mas
 * NÃO desfaz o custo médio: a média é uma mistura, e não dá para separar de
 * volta o que já foi diluído. A tela diz isso antes de o botão ser apertado,
 * porque descobrir depois seria pior.
 *
 * Nota que nasceu de um recebimento de Compras não se cancela aqui: o
 * recebimento é imutável, e desfazer entrada é DEVOLUÇÃO, pela tela dele.
 */
export async function cancelarNota(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.lancar")) {
    throw new SemPermissao("cancelar notas de entrada");
  }
  const unidade = exigirUnidade(contexto);

  const nota = await db.notaEntrada.findFirst({
    where: { id, unidadeId: unidade.id, canceladaEm: null },
    include: { itens: true },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.recebimentoId && nota.status === "LANCADA") {
    throw new Error(
      "Esta nota está ligada a um recebimento de Compras. Para desfazer a entrada, registre uma devolução no recebimento.",
    );
  }

  const escritas = [];

  if (nota.status === "LANCADA" && nota.localDestinoId) {
    const localId = nota.localDestinoId;
    for (const item of nota.itens) {
      escritas.push(
        db.posicaoEstoque.update({
          where: { localId_insumoId: { localId, insumoId: item.insumoId } },
          data: { quantidade: { decrement: Number(item.quantidade) } },
        }),
      );
    }
  }

  escritas.push(
    db.notaEntrada.update({
      where: { id },
      data: { status: "CANCELADA", canceladaEm: new Date() },
    }),
  );

  await db.$transaction(escritas);

  await registrarAuditoria(
    contexto,
    "EXCLUIU",
    id,
    { status: nota.status },
    null,
  );
}

// ---------------------------------------------------- ENTRADA POR RECEBIMENTO

/**
 * Receber um pedido é uma forma legítima de dar entrada: quem tem
 * `compras.receber` confere o caminhão sem precisar também de
 * `estoque.lancar`. A permissão é conferida AQUI, no Estoque, de novo.
 */
function exigirEntrada(contexto: ContextoSessao) {
  if (!pode(contexto, "estoque.lancar") && !pode(contexto, "compras.receber")) {
    throw new SemPermissao("dar entrada de mercadoria");
  }
}

export type ItemDaEntrada = {
  insumoId: string;
  /** Como na nota/caixa: "2" (caixas). Texto com ponto decimal. */
  quantidadeNota: string;
  fatorConversao: string;
  /** Na unidade de estoque. */
  quantidade: string;
  valorUnitario: string;
  valorTotal: string;
};

export async function lancarEntradaDeRecebimento(
  tx: Tx,
  contexto: ContextoSessao,
  dados: {
    unidadeId: string;
    fornecedorId: string;
    recebimentoId: string;
    pedidoId: string;
    recebidaEm: Date;
    localDestinoId: string;
    numero: string | null;
    serie: string | null;
    chaveAcesso: string | null;
    observacao: string | null;
    itens: ItemDaEntrada[];
  },
): Promise<{ notaId: string }> {
  exigirEntrada(contexto);
  if (!contexto.unidadesVisiveis.some((u) => u.id === dados.unidadeId)) {
    throw new SemPermissao("dar entrada em outra loja");
  }
  if (dados.itens.length === 0) throw new Error("Nada entrou nesta conferência.");

  const local = await tx.localEstoque.findFirst({
    where: { id: dados.localDestinoId, unidadeId: dados.unidadeId, ativo: true },
    select: { id: true },
  });
  if (!local) {
    throw new Error("Escolha onde a mercadoria foi guardada — um lugar desta loja.");
  }

  const valorTotal = dados.itens
    .reduce((s, i) => s + Math.round(Number(i.valorTotal) * 100), 0)
    .toString();

  let notaId: string;
  try {
    const nota = await tx.notaEntrada.create({
      data: {
        unidadeId: dados.unidadeId,
        fornecedorId: dados.fornecedorId,
        numero: dados.numero,
        serie: dados.serie,
        chaveAcesso: dados.chaveAcesso,
        recebidaEm: dados.recebidaEm,
        localDestinoId: dados.localDestinoId,
        recebimentoId: dados.recebimentoId,
        pedidoId: dados.pedidoId,
        valorTotal: (Number(valorTotal) / 100).toFixed(2),
        observacao: dados.observacao,
        registradaPorId: contexto.usuario.id,
        itens: {
          create: dados.itens.map((i) => ({
            insumoId: i.insumoId,
            quantidadeNota: i.quantidadeNota,
            fatorConversao: i.fatorConversao,
            quantidade: i.quantidade,
            valorUnitario: i.valorUnitario,
            valorTotal: i.valorTotal,
          })),
        },
      },
      select: { id: true },
    });
    notaId = nota.id;
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      throw new Error(
        "Esta nota (número e série) já foi lançada para este fornecedor. Vincule o recebimento a ela em vez de lançar de novo.",
      );
    }
    throw erro;
  }

  await postarNota(tx, notaId, contexto.usuario.id);

  await tx.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: dados.unidadeId,
      usuarioId: contexto.usuario.id,
      entidade: "NotaEntrada",
      entidadeId: notaId,
      acao: "CRIOU",
      valoresDepois: {
        origem: "recebimento",
        recebimentoId: dados.recebimentoId,
        pedidoId: dados.pedidoId,
        itens: dados.itens.length,
      },
    },
  });

  return { notaId };
}

/**
 * Nota lançada à mão ANTES da conferência: o recebimento se liga a ela e não
 * dá entrada de novo. Uma nota só se liga a um recebimento.
 */
export async function vincularNotaAoRecebimento(
  tx: Tx,
  contexto: ContextoSessao,
  dados: { notaId: string; unidadeId: string; fornecedorId: string; recebimentoId: string; pedidoId: string },
): Promise<{ itens: { insumoId: string; quantidade: string; valorTotal: string }[]; valorTotal: string }> {
  exigirEntrada(contexto);

  const r = await tx.notaEntrada.updateMany({
    where: {
      id: dados.notaId,
      unidadeId: dados.unidadeId,
      fornecedorId: dados.fornecedorId,
      status: "LANCADA",
      recebimentoId: null,
    },
    data: { recebimentoId: dados.recebimentoId, pedidoId: dados.pedidoId },
  });
  if (r.count !== 1) {
    throw new Error(
      "Esta nota não pode ser ligada: não é deste fornecedor nesta loja, não está lançada, ou já foi conferida com outro recebimento.",
    );
  }
  const nota = await tx.notaEntrada.findUniqueOrThrow({
    where: { id: dados.notaId },
    select: {
      valorTotal: true,
      itens: { select: { insumoId: true, quantidade: true, valorTotal: true } },
    },
  });
  return {
    valorTotal: nota.valorTotal.toString(),
    itens: nota.itens.map((i) => ({
      insumoId: i.insumoId,
      quantidade: i.quantidade.toString(),
      valorTotal: i.valorTotal.toString(),
    })),
  };
}

/**
 * DEVOLUÇÃO — o movimento que compensa uma entrada. Baixa o saldo do lugar; a
 * nota original não é apagada nem editada, e o CMV desconta a devolução.
 */
export async function registrarDevolucao(
  tx: Tx,
  contexto: ContextoSessao,
  dados: {
    unidadeId: string;
    localId: string;
    recebimentoId: string;
    motivo: string;
    itens: { insumoId: string; quantidade: string; custoUnitario: string }[];
  },
): Promise<void> {
  exigirEntrada(contexto);
  const local = await tx.localEstoque.findFirst({
    where: { id: dados.localId, unidadeId: dados.unidadeId },
    select: { id: true },
  });
  if (!local) throw new Error("Lugar não encontrado nesta loja.");

  for (const item of dados.itens) {
    await tx.movimentoEstoque.create({
      data: {
        unidadeId: dados.unidadeId,
        insumoId: item.insumoId,
        localId: dados.localId,
        tipo: "DEVOLUCAO",
        quantidade: item.quantidade,
        custoUnitario: item.custoUnitario,
        motivo: dados.motivo,
        recebimentoId: dados.recebimentoId,
        registradoPorId: contexto.usuario.id,
      },
    });
    await tx.posicaoEstoque.upsert({
      where: { localId_insumoId: { localId: dados.localId, insumoId: item.insumoId } },
      update: { quantidade: { decrement: item.quantidade } },
      create: {
        unidadeId: dados.unidadeId,
        localId: dados.localId,
        insumoId: item.insumoId,
        quantidade: `-${item.quantidade}`,
      },
    });
  }
}

/** Notas lançadas deste fornecedor, nesta loja, ainda sem conferência ligada. */
export async function notasParaVincular(contexto: ContextoSessao, fornecedorId: string) {
  const unidade = exigirUnidade(contexto);
  return db.notaEntrada.findMany({
    where: {
      unidadeId: unidade.id,
      fornecedorId,
      status: "LANCADA",
      recebimentoId: null,
      recebidaEm: { gte: new Date(Date.now() - 60 * 86_400_000) },
    },
    select: { id: true, numero: true, serie: true, recebidaEm: true, valorTotal: true },
    orderBy: { recebidaEm: "desc" },
  });
}

async function registrarAuditoria(
  contexto: ContextoSessao,
  acao: "CRIOU" | "ALTEROU" | "EXCLUIU",
  entidadeId: string,
  antes: unknown,
  depois: unknown,
) {
  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade: "NotaEntrada",
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}
