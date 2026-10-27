import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { FinalizarEntrada } from "../types";
import type { ReceberEntrada } from "../recebimento-types";
import {
  abrirCaixa,
  cancelarVenda,
  carregarPdv,
  fecharCaixa,
  finalizarVenda,
} from "./pdv";
import { consultarRecebimento, receberPedido } from "./recebimentos";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("pendente baixa uma vez, recebe snapshot em outro caixa, cancela corretamente e preserva fechos e legado", async () => {
  const prefixo = `recebimento-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "Recebimentos fictícios", slug: prefixo },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "TESTE" },
  });
  const outra = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Outra loja fictícia",
      codigo: "OUTRA",
    },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador fictício",
      email: `${prefixo}@example.invalid`,
      status: "ATIVO",
    },
  });
  const usuario2 = await db.usuario.create({
    data: {
      nome: "Outro operador fictício",
      email: `${prefixo}-outro@example.invalid`,
      status: "ATIVO",
    },
  });
  const ctx: ContextoSessao = {
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      avatarUrl: null,
    },
    organizacao: { id: org.id, nome: org.nome },
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade, outra],
    podeVerRedeInteira: true,
    permissoes: new Set(["*"]),
    ehDiretor: true,
  };
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local original fictício" },
  });
  const outroLocal = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local de outro turno fictício" },
  });
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: org.id,
      nome: "Bebida fictícia",
      unidadeMedida: "UN",
      custoMedio: 2,
    },
  });
  const ficha = await db.fichaTecnica.create({
    data: {
      organizacaoId: org.id,
      nome: "Produto fictício",
      precoVenda: 25,
      rendimento: 1,
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: unidade.id,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: 100,
    },
  });
  const caixaOrigem = await abrirCaixa(ctx, {
    localEstoqueId: local.id,
    saldoInicialCentavos: 1000,
  });
  const cliente = await db.crmContact.create({
    data: { storeId: unidade.id, name: "Cliente privado fictício" },
  });
  const base: FinalizarEntrada = {
    chave: randomUUID(),
    caixaId: caixaOrigem,
    clienteId: cliente.id,
    modalidade: "BALCAO",
    observacao: "",
    itens: [{ produtoId: ficha.id, quantidade: 1, opcoes: [], observacao: "" }],
    descontoCentavos: 0,
    taxaCentavos: 0,
    pagamentos: [],
    pagamentoPendente: true,
  };
  const entrega: FinalizarEntrada = {
    ...base,
    chave: randomUUID(),
    modalidade: "ENTREGA",
    itens: [{ ...base.itens[0], quantidade: 2 }],
    entrega: {
      destinatario: "Destinatário privado fictício",
      telefone: "84999991234",
      endereco: {
        logradouro: "Rua privada fictícia",
        numero: "10",
        complemento: "",
        bairro: "Centro",
        cidade: "Mossoró",
        uf: "RN",
        cep: "",
        referencia: "",
      },
      freteCentavos: 500,
      prazoMinutos: 40,
      motivoFreteManual: "Frete combinado",
    },
  };
  const pendenteId = await finalizarVenda(ctx, entrega);
  assert.equal(await finalizarVenda(ctx, entrega), pendenteId);
  const pagaEntrada: FinalizarEntrada = {
    ...base,
    chave: randomUUID(),
    pagamentoPendente: undefined,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 3000 }],
  };
  const pagaId = await finalizarVenda(ctx, pagaEntrada);
  const pagaNova = await db.pdvVenda.findUniqueOrThrow({
    where: { id: pagaId },
  });
  assert.equal(pagaNova.caixaRecebimentoId, caixaOrigem);
  assert.equal(pagaNova.recebidoPorId, usuario.id);
  // Simula uma venda anterior à migração, sem inventar recebimento no legado.
  await db.pdvVenda.update({
    where: { id: pagaId },
    data: {
      caixaRecebimentoId: null,
      recebidoEm: null,
      recebidoPorId: null,
      recebidoPorNome: null,
      recebimentoChave: null,
      recebimentoHash: null,
    },
  });
  const cancelarPendenteId = await finalizarVenda(ctx, {
    ...base,
    chave: randomUUID(),
  });
  const corridaId = await finalizarVenda(ctx, { ...base, chave: randomUUID() });
  const fechadoId = await finalizarVenda(ctx, { ...base, chave: randomUUID() });
  const criado = await db.pdvVenda.findUniqueOrThrow({
    where: { id: pendenteId },
  });
  assert.equal(criado.status, "PENDENTE");
  assert.deepEqual(criado.pagamentos, []);
  assert.equal(criado.trocoCentavos, 0);
  assert.equal(criado.totalCentavos, 5500);
  assert.equal(criado.caixaRecebimentoId, null);
  assert.equal(
    (await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos,
    3500,
    "pendentes não entram no saldo; legado pago entra uma vez",
  );
  const estoque = async () =>
    (
      await db.posicaoEstoque.findUniqueOrThrow({
        where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
      })
    ).quantidade.toString();
  assert.equal(await estoque(), "94");
  await fecharCaixa(ctx, {
    caixaId: caixaOrigem,
    valorContadoCentavos: 3500,
    observacao: "Origem encerrada",
  });
  assert.equal(
    await finalizarVenda(ctx, pagaEntrada),
    pagaId,
    "hash legado sem flag default confirma depois de fechar",
  );
  const cancelamento = await cancelarVenda(ctx, {
    vendaId: cancelarPendenteId,
    versaoFinanceira: 1,
    motivo: "Pendente não retirado",
  });
  assert.equal(cancelamento.devolucaoPagamento, false);
  assert.equal(
    (
      await cancelarVenda(ctx, {
        vendaId: cancelarPendenteId,
        versaoFinanceira: 1,
        motivo: "Mesmo cancelamento",
      })
    ).devolucaoPagamento,
    false,
  );
  assert.equal(await estoque(), "95");
  await assert.rejects(
    () =>
      cancelarVenda(ctx, {
        vendaId: pagaId,
        versaoFinanceira: 1,
        motivo: "Legado pago fechado",
      }),
    /já foi fechado/,
  );
  const caixaAtual = await abrirCaixa(ctx, {
    localEstoqueId: outroLocal.id,
    saldoInicialCentavos: 200,
  });
  await db.fichaTecnica.update({
    where: { id: ficha.id },
    data: {
      precoVenda: 999,
      ativo: false,
      itens: {
        updateMany: {
          where: { insumoId: insumo.id },
          data: { quantidade: 20 },
        },
      },
    },
  });
  const semCrm = { ...ctx, permissoes: new Set(["pdv.ver", "pdv.vender"]) };
  const consulta = await consultarRecebimento(semCrm, { vendaId: pendenteId });
  assert.equal(consulta.caixa!.id, caixaAtual);
  assert.equal(consulta.venda.totalCentavos, 5500);
  assert.equal(consulta.venda.cliente, null);
  assert.equal("entrega" in consulta.venda, false);
  await assert.rejects(
    () =>
      consultarRecebimento(
        { ...ctx, permissoes: new Set(["pdv.ver"]) },
        { vendaId: pendenteId },
      ),
    /permissão/,
  );
  await assert.rejects(
    () =>
      consultarRecebimento(
        { ...ctx, unidadeAtiva: outra },
        { vendaId: pendenteId },
      ),
    /indisponível/,
  );
  const receber: ReceberEntrada = {
    vendaId: pendenteId,
    versaoFinanceira: 1,
    chave: randomUUID(),
    caixaId: caixaAtual,
    pagamentos: [
      { forma: "PIX", valorCentavos: 2000 },
      { forma: "DINHEIRO", valorCentavos: 4000 },
    ],
  };
  await assert.rejects(
    () =>
      receberPedido(ctx, {
        ...receber,
        pagamentos: [{ forma: "PIX", valorCentavos: 6000 }],
      }),
    /Troco/,
  );
  const saldoAntes = await estoque();
  const movimentosAntes = await db.movimentoEstoque.count({
    where: { unidadeId: unidade.id },
  });
  assert.equal(await receberPedido(ctx, receber), pendenteId);
  assert.equal(await receberPedido(ctx, receber), pendenteId);
  assert.equal(await estoque(), saldoAntes);
  assert.equal(
    await db.movimentoEstoque.count({ where: { unidadeId: unidade.id } }),
    movimentosAntes,
  );
  const paga = await db.pdvVenda.findUniqueOrThrow({
    where: { id: pendenteId },
  });
  assert.equal(paga.totalCentavos, 5500);
  assert.deepEqual(paga.itens, criado.itens);
  assert.deepEqual(paga.consumo, criado.consumo);
  assert.deepEqual(paga.entrega, criado.entrega);
  assert.equal(paga.trocoCentavos, 500);
  assert.equal(paga.caixaRecebimentoId, caixaAtual);
  assert.equal(paga.versaoFinanceira, 2);
  assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 3700);
  assert.equal(
    (await db.pdvCaixa.findUniqueOrThrow({ where: { id: caixaOrigem } }))
      .saldoFechamentoCentavos,
    3500,
  );
  await assert.rejects(
    () =>
      receberPedido(
        { ...ctx, usuario: { ...ctx.usuario, id: usuario2.id } },
        receber,
      ),
    /outro recebimento/,
  );
  await assert.rejects(
    () => receberPedido(ctx, { ...receber, vendaId: corridaId }),
    /outro recebimento/,
  );
  await assert.rejects(
    () =>
      cancelarVenda(ctx, {
        vendaId: pendenteId,
        versaoFinanceira: 1,
        motivo: "Cancelamento antigo",
      }),
    /financeira.*mudou/,
  );
  assert.equal(
    (
      await cancelarVenda(ctx, {
        vendaId: pendenteId,
        versaoFinanceira: 2,
        motivo: "Pagamento devolvido manualmente",
      })
    ).devolucaoPagamento,
    true,
  );
  assert.equal(
    (
      await cancelarVenda(ctx, {
        vendaId: pendenteId,
        versaoFinanceira: 2,
        motivo: "Mesmo cancelamento",
      })
    ).devolucaoPagamento,
    true,
  );
  assert.equal(await estoque(), "97");
  assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 200);
  assert.equal(
    await receberPedido(ctx, receber),
    pendenteId,
    "retry confirma fato do recebimento, não reabre cancelamento",
  );
  const chave1 = {
    ...receber,
    vendaId: corridaId,
    chave: randomUUID(),
    pagamentos: [{ forma: "DINHEIRO" as const, valorCentavos: 3000 }],
  };
  const chave2 = { ...chave1, chave: randomUUID() };
  const corridas = await Promise.allSettled([
    receberPedido(ctx, chave1),
    receberPedido(ctx, chave2),
  ]);
  assert.equal(corridas.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db.pdvVenda.findUniqueOrThrow({ where: { id: corridaId } }))
      .versaoFinanceira,
    2,
  );
  const vencedora = corridas[0].status === "fulfilled" ? chave1 : chave2;
  const receberFechado = { ...chave1, vendaId: fechadoId, chave: randomUUID() };
  await receberPedido(ctx, receberFechado);
  assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 5200);
  await fecharCaixa(ctx, {
    caixaId: caixaAtual,
    valorContadoCentavos: 5200,
    observacao: "Recebimentos conferidos",
  });
  assert.equal(await receberPedido(ctx, vencedora), corridaId);
  assert.equal(await receberPedido(ctx, receberFechado), fechadoId);
  await assert.rejects(
    () =>
      cancelarVenda(ctx, {
        vendaId: fechadoId,
        versaoFinanceira: 2,
        motivo: "Recebimento já encerrado",
      }),
    /já foi fechado/,
  );
  assert.equal(
    (await db.pdvCaixa.findUniqueOrThrow({ where: { id: caixaOrigem } }))
      .saldoFechamentoCentavos,
    3500,
  );
  assert.equal(
    (await db.pdvCaixa.findUniqueOrThrow({ where: { id: caixaAtual } }))
      .saldoFechamentoCentavos,
    5200,
  );
  assert.equal(
    await db.auditoria.count({
      where: { organizacaoId: org.id, entidade: "PdvRecebimento" },
    }),
    3,
  );
});
