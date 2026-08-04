import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { DadosItem, DadosNota } from "../schemas/nota";

import { exigirUnidade } from "./contagens";

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
 */

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
 * LANÇAR: o momento em que o papel vira estoque e custo.
 *
 * Duas coisas acontecem por item, e as duas importam:
 *
 *   SALDO   soma no lugar de destino da nota.
 *   CUSTO   entra na MÉDIA PONDERADA, não substitui. Comprar 2kg a R$50
 *           tendo 100kg a R$30 não faz o estoque valer R$50 o quilo — e é
 *           essa média que custeia a contagem e, por consequência, o CMV.
 *
 * Tudo numa transação: metade lançada seria pior que nada lançado.
 */
export async function lancarNota(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.lancar")) {
    throw new SemPermissao("lançar notas de entrada");
  }
  const unidade = exigirUnidade(contexto);

  const nota = await db.notaEntrada.findFirst({
    where: { id, unidadeId: unidade.id },
    include: { itens: true },
  });
  if (!nota) throw new Error("Nota não encontrada.");
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

  const insumoIds = [...new Set(nota.itens.map((i) => i.insumoId))];

  // O saldo atual de cada insumo na unidade INTEIRA: a média ponderada é do
  // insumo, não do lugar. O mesmo queijo não tem dois custos por estar em
  // duas geladeiras.
  const posicoes = await db.posicaoEstoque.findMany({
    where: { unidadeId: unidade.id, insumoId: { in: insumoIds } },
    select: { insumoId: true, quantidade: true, localId: true },
  });

  const insumos = await db.insumo.findMany({
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

  const escritas = [];

  for (const insumoId of insumoIds) {
    const doInsumo = nota.itens.filter((i) => i.insumoId === insumoId);
    const quantidadeEntrada = doInsumo.reduce(
      (s, i) => s + Number(i.quantidade),
      0,
    );
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

    escritas.push(
      db.insumo.update({
        where: { id: insumoId },
        data: {
          custoMedio: novoMedio,
          custoUltimo: precoEntrada,
          atualizadoPorId: contexto.usuario.id,
        },
      }),
    );

    const posicaoExiste = posicoes.some(
      (p) => p.insumoId === insumoId && p.localId === localId,
    );

    escritas.push(
      posicaoExiste
        ? db.posicaoEstoque.update({
            where: { localId_insumoId: { localId, insumoId } },
            data: { quantidade: { increment: quantidadeEntrada } },
          })
        : db.posicaoEstoque.create({
            data: {
              unidadeId: unidade.id,
              localId,
              insumoId,
              quantidade: quantidadeEntrada,
            },
          }),
    );
  }

  escritas.push(
    db.notaEntrada.update({
      where: { id },
      data: { status: "LANCADA", lancadaEm: new Date() },
    }),
  );

  await db.$transaction(escritas);

  await registrarAuditoria(
    contexto,
    "ALTEROU",
    id,
    { status: "RASCUNHO" },
    {
      status: "LANCADA",
      itens: nota.itens.length,
      valor: Number(nota.valorTotal),
    },
  );
}

/**
 * Cancelar.
 *
 * Rascunho some sem consequência. Lançada devolve o saldo ao que era — mas
 * NÃO desfaz o custo médio: a média é uma mistura, e não dá para separar de
 * volta o que já foi diluído. A tela diz isso antes de o botão ser apertado,
 * porque descobrir depois seria pior.
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
