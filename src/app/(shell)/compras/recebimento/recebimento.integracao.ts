import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, test } from "node:test";

import {
  criarCenario,
  limparBanco,
  type Cenario,
} from "@/modules/compras/integracao/cenario";
import { pedidosAprovados } from "@/modules/compras/integracao/fluxo";
import type { Informado } from "@/modules/compras/schemas/recebimento";
import {
  ConferenciaInvalida,
  encerrarSaldo,
} from "@/modules/compras/services/recebimentos";
import { adicionarItem, criarNota, lancarNota } from "@/modules/estoque/services/notas";
import { db } from "@/server/db";

import { conferirRecebimento, devolverMercadoria } from "./conferir";

/**
 * O recebimento de ponta a ponta: Compras + Estoque (+ Financeiro), banco de
 * verdade. A pergunta de cada teste é a mesma: o saldo e o dinheiro contam a
 * mercadoria UMA vez?
 */

let c: Cenario;

beforeEach(async () => {
  await limparBanco();
  c = await criarCenario();
});

after(async () => {
  await db.$disconnect();
});

const informado = (
  itemDePedidoId: string,
  boas: bigint,
  resto: Partial<Informado> = {},
): Informado => ({
  itemDePedidoId,
  boas,
  avariadas: 0n,
  decisaoExcedente: null,
  substitutoInsumoId: null,
  decisaoSubstituicao: null,
  lote: null,
  validade: null,
  observacao: null,
  fotoIds: [],
  ...resto,
});

async function entrega() {
  const f = await pedidosAprovados(c);
  const gerente = await c.ctx(c.gerenteCentro, c.centro);
  const molho = f.centro.itens.find((i) => i.insumoNome === "Molho de tomate")!;
  const mussarela = f.centro.itens.find((i) => i.insumoNome === "Mussarela")!;
  const conferirAgora = (
    informados: Informado[],
    extra: Partial<Parameters<typeof conferirRecebimento>[1]> = {},
  ) =>
    conferirRecebimento(gerente, {
      pedidoId: f.centro.id,
      chave: randomUUID(),
      recebidaEm: new Date(),
      localDestinoId: c.locais.depositoCentro.id,
      informados,
      numeroNota: null,
      serieNota: null,
      chaveAcesso: null,
      notaExistenteId: null,
      observacao: null,
      ...extra,
    });
  return { ...f, gerente, molho, mussarela, conferirAgora };
}

const posicao = async (insumoId: string) =>
  (
    await db.posicaoEstoque.findUnique({
      where: { localId_insumoId: { localId: c.locais.depositoCentro.id, insumoId } },
    })
  )?.quantidade.toString() ?? null;

describe("receber", () => {
  test("parcial: entra pela nota o que chegou; o resto fica pendente", async () => {
    const e = await entrega();
    const r = await e.conferirAgora(
      [informado(e.molho.id, 1000n), informado(e.mussarela.id, 6000n)],
      { gerarContaAPagar: true },
    );
    assert.equal(r.numero, 1);
    assert.equal(r.completo, false);
    // O gerente não tem financeiro.lancar: a conta a pagar não é gerada, e
    // a tela diz por quê.
    assert.equal(r.contaAPagar, "sem-permissao");

    const nota = await db.notaEntrada.findUniqueOrThrow({ where: { id: r.notaEntradaId! } });
    assert.equal(nota.status, "LANCADA");
    assert.equal(nota.recebimentoId, r.recebimentoId);
    assert.equal(nota.valorTotal.toString(), "287.4"); // 95,40 + 6 × 32

    assert.equal(await posicao(c.insumos.molho.id), "10.8");
    assert.equal(await posicao(c.insumos.mussarela.id), "6");

    const pedido = await db.pedido.findUniqueOrThrow({ where: { id: e.centro.id } });
    assert.equal(pedido.situacaoRecebimento, "PARCIAL");
    assert.equal(pedido.status, "APROVADO");
  });

  test("a segunda entrega completa e conclui o pedido", async () => {
    const e = await entrega();
    await e.conferirAgora([informado(e.molho.id, 1000n), informado(e.mussarela.id, 6000n)]);
    const r = await e.conferirAgora([informado(e.molho.id, 1000n), informado(e.mussarela.id, 4000n)]);
    assert.equal(r.numero, 2);
    assert.equal(r.completo, true);
    const pedido = await db.pedido.findUniqueOrThrow({ where: { id: e.centro.id } });
    assert.equal(pedido.status, "CONCLUIDO");
    assert.equal(pedido.situacaoRecebimento, "COMPLETO");
    assert.equal(await posicao(c.insumos.molho.id), "21.6");
    assert.equal(await db.notaEntrada.count(), 2);
  });

  test("duplo clique com a mesma chave: um recebimento, uma nota, uma entrada", async () => {
    const e = await entrega();
    const chave = randomUUID();
    const resultado = await Promise.allSettled([
      e.conferirAgora([informado(e.molho.id, 1000n)], { chave }),
      e.conferirAgora([informado(e.molho.id, 1000n)], { chave }),
    ]);
    assert.ok(resultado.every((r) => r.status === "fulfilled"));
    assert.equal(await db.recebimento.count(), 1);
    assert.equal(await db.notaEntrada.count(), 1);
    assert.equal(await posicao(c.insumos.molho.id), "10.8");
  });

  test("duas conferências ao mesmo tempo não passam do pedido", async () => {
    const e = await entrega();
    const resultado = await Promise.allSettled([
      e.conferirAgora([informado(e.molho.id, 2000n)]),
      e.conferirAgora([informado(e.molho.id, 2000n)]),
    ]);
    assert.equal(resultado.filter((r) => r.status === "fulfilled").length, 1);
    const recusa = resultado.find((r) => r.status === "rejected");
    assert.ok(recusa && recusa.reason instanceof ConferenciaInvalida);
    assert.match(String(recusa.reason.message), /a mais/);
    assert.equal(await posicao(c.insumos.molho.id), "21.6");
  });

  test("excedente aceito entra e vira divergência", async () => {
    const e = await entrega();
    await e.conferirAgora([informado(e.molho.id, 3000n, { decisaoExcedente: "ACEITAR" })]);
    assert.equal(await posicao(c.insumos.molho.id), "32.4");
    const d = await db.divergenciaDeCompra.findFirstOrThrow({ where: { tipo: "EXCEDENTE" } });
    assert.equal(d.impacto?.toString(), "95.4");
  });

  test("avariado não entra no estoque", async () => {
    const e = await entrega();
    await e.conferirAgora([informado(e.molho.id, 1000n, { avariadas: 1000n })]);
    assert.equal(await posicao(c.insumos.molho.id), "10.8");
    assert.equal(await db.divergenciaDeCompra.count({ where: { tipo: "AVARIA" } }), 1);
    const pedido = await db.pedido.findUniqueOrThrow({ where: { id: e.centro.id } });
    assert.equal(pedido.situacaoRecebimento, "PARCIAL");
  });

  test("falha no meio da transação: nada fica gravado", async () => {
    const e = await entrega();
    const antes = await db.pedido.findUniqueOrThrow({ where: { id: e.centro.id } });
    // O depósito do SUL não é lugar desta loja: o Estoque recusa DEPOIS de o
    // recebimento já ter sido gravado na transação.
    await assert.rejects(
      () =>
        e.conferirAgora([informado(e.molho.id, 1000n)], {
          localDestinoId: c.locais.depositoSul.id,
        }),
      /lugar desta loja/,
    );
    assert.equal(await db.recebimento.count(), 0);
    assert.equal(await db.itemDeRecebimento.count(), 0);
    assert.equal(await db.notaEntrada.count(), 0);
    assert.equal(await posicao(c.insumos.molho.id), null);
    const depois = await db.pedido.findUniqueOrThrow({ where: { id: e.centro.id } });
    assert.equal(depois.versao, antes.versao);
    assert.equal(depois.situacaoRecebimento, "NADA");
  });

  test("outra loja não confere o pedido", async () => {
    const e = await entrega();
    const gerenteSul = await c.ctx(c.gerenteSul, c.sul);
    await assert.rejects(
      () =>
        conferirRecebimento(gerenteSul, {
          pedidoId: e.centro.id,
          chave: randomUUID(),
          recebidaEm: new Date(),
          localDestinoId: c.locais.depositoSul.id,
          informados: [informado(e.molho.id, 1000n)],
          numeroNota: null,
          serieNota: null,
          chaveAcesso: null,
          notaExistenteId: null,
          observacao: null,
        }),
      /não encontrado/,
    );
  });

  test("encerrar o saldo conclui com o que faltou em divergência", async () => {
    const e = await entrega();
    await e.conferirAgora([informado(e.molho.id, 1000n)]);
    await encerrarSaldo(e.gerente, e.centro.id, "Fornecedor sem estoque até o mês que vem");
    const pedido = await db.pedido.findUniqueOrThrow({ where: { id: e.centro.id } });
    assert.equal(pedido.status, "CONCLUIDO");
    assert.equal(
      await db.divergenciaDeCompra.count({ where: { tipo: "SALDO_ENCERRADO" } }),
      2,
    );
  });
});

describe("a nota e o dinheiro", () => {
  test("nota já lançada à mão: o recebimento se liga a ela, sem segunda entrada", async () => {
    const e = await entrega();
    const nota = await criarNota(e.gerente, {
      fornecedor: "Distribuidora Exemplo A",
      numero: "1234",
      serie: "1",
      recebidaEm: new Date(),
      localDestinoId: c.locais.depositoCentro.id,
      observacao: undefined,
    });
    await adicionarItem(e.gerente, nota.id, {
      insumoId: c.insumos.molho.id,
      quantidadeNota: 20,
      fatorConversao: 1,
      valorTotal: 180,
      embalagemNome: undefined,
      salvarEmbalagem: false,
    });
    await lancarNota(e.gerente, nota.id);
    assert.equal(await posicao(c.insumos.molho.id), "20");

    const r = await e.conferirAgora([informado(e.molho.id, 2000n)], { notaExistenteId: nota.id });
    assert.equal(r.notaEntradaId, nota.id);
    assert.equal(await db.notaEntrada.count(), 1);
    assert.equal(await posicao(c.insumos.molho.id), "20"); // o estoque ficou com o papel
    const ligada = await db.notaEntrada.findUniqueOrThrow({ where: { id: nota.id } });
    assert.equal(ligada.recebimentoId, r.recebimentoId);

    const tipos = (await db.divergenciaDeCompra.findMany()).map((d) => d.tipo).sort();
    assert.deepEqual(tipos, ["NOTA_QUANTIDADE", "NOTA_VALOR"]);

    // A mesma nota não se liga a uma segunda conferência.
    await assert.rejects(
      () => e.conferirAgora([informado(e.mussarela.id, 1000n)], { notaExistenteId: nota.id }),
      /já foi conferida/,
    );
  });

  test("a conta a pagar da nota não duplica, nem com dois cliques ao mesmo tempo", async () => {
    const e = await entrega();
    const r = await e.conferirAgora([informado(e.molho.id, 2000n), informado(e.mussarela.id, 10_000n)]);
    const financeiro = await c.ctx(c.financeiro, c.centro);
    const { importarNotas } = await import("@/modules/financeiro/services/cadastros");

    await Promise.allSettled([
      importarNotas(financeiro, [r.notaEntradaId!], null),
      importarNotas(financeiro, [r.notaEntradaId!], null),
    ]);
    assert.equal(await importarNotas(financeiro, [r.notaEntradaId!], null), 0);
    const contas = await db.lancamento.findMany({ where: { notaEntradaId: r.notaEntradaId } });
    assert.equal(contas.length, 1);
    assert.equal(contas[0].valor.toString(), "510.8"); // 2 × 95,40 + 10 × 32
  });

  test("devolução baixa o estoque com movimento próprio; não se devolve mais do que entrou", async () => {
    const e = await entrega();
    const r = await e.conferirAgora([informado(e.molho.id, 2000n)]);
    const linha = await db.itemDeRecebimento.findFirstOrThrow({
      where: { recebimentoId: r.recebimentoId },
    });

    await devolverMercadoria(e.gerente, {
      recebimentoId: r.recebimentoId,
      chave: randomUUID(),
      motivo: "Lote com cheiro estranho",
      linhas: [{ itemDeRecebimentoId: linha.id, quantidade: "5" }],
    });
    assert.equal(await posicao(c.insumos.molho.id), "16.6");
    const mov = await db.movimentoEstoque.findFirstOrThrow({ where: { tipo: "DEVOLUCAO" } });
    assert.equal(mov.quantidade.toString(), "5");
    assert.equal(await db.divergenciaDeCompra.count({ where: { tipo: "DEVOLUCAO" } }), 1);

    // A nota original continua lá, intacta.
    const nota = await db.notaEntrada.findUniqueOrThrow({ where: { id: r.notaEntradaId! } });
    assert.equal(nota.status, "LANCADA");

    await assert.rejects(
      () =>
        devolverMercadoria(e.gerente, {
          recebimentoId: r.recebimentoId,
          chave: randomUUID(),
          motivo: "de novo",
          linhas: [{ itemDeRecebimentoId: linha.id, quantidade: "20" }],
        }),
      /mais do que entrou/,
    );
  });
});
