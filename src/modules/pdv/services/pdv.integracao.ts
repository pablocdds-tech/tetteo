import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { db } from "@/server/db";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import {
  abrirCaixa,
  cancelarVenda,
  carregarPdv,
  fecharCaixa,
  finalizarVenda,
  movimentarCaixa,
  salvarComplementos,
} from "./pdv";
import type { FinalizarEntrada } from "../types";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("PDV integra autorização, concorrência, idempotência, estoque, cancelamento e fechamento", async () => {
  const prefixo = `pdv-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "PDV teste fictício", slug: prefixo },
  });
  const orgOutra = await db.organizacao.create({
    data: { nome: "Outra organização fictícia", slug: `${prefixo}-outra` },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Unidade fictícia", codigo: "TESTE" },
  });
  const unidadeOutra = await db.unidade.create({
    data: {
      organizacaoId: orgOutra.id,
      nome: "Outra unidade fictícia",
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
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Estoque fictício" },
  });
  const localOutro = await db.localEstoque.create({
    data: { unidadeId: unidadeOutra.id, nome: "Outro estoque fictício" },
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
    unidadesVisiveis: [unidade],
    podeVerRedeInteira: false,
    permissoes: new Set(["*"]),
    ehDiretor: true,
  };
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: org.id,
      nome: "Bebida fictícia",
      unidadeMedida: "UN",
      custoMedio: "2",
    },
  });
  const ficha = await db.fichaTecnica.create({
    data: {
      organizacaoId: org.id,
      nome: "Produto fictício",
      tipo: "PRATO",
      precoVenda: "10",
      rendimento: "1",
      itens: {
        create: { insumoId: insumo.id, quantidade: "1", unidade: "UN" },
      },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: unidade.id,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: "10",
    },
  });
  await assert.rejects(
    () =>
      abrirCaixa(
        { ...ctx, permissoes: new Set(["pdv.ver"]) },
        { saldoInicialCentavos: 1000, localEstoqueId: local.id },
      ),
    /permissão/,
  );
  await assert.rejects(
    () =>
      carregarPdv({
        ...ctx,
        unidadeAtiva: unidadeOutra,
        unidadesVisiveis: [unidadeOutra],
      }),
    /permissão/,
  );
  await assert.rejects(
    () =>
      abrirCaixa(ctx, {
        saldoInicialCentavos: 1000,
        localEstoqueId: localOutro.id,
      }),
    /desta unidade/,
  );
  const aberturas = await Promise.allSettled([
    abrirCaixa(ctx, { saldoInicialCentavos: 1000, localEstoqueId: local.id }),
    abrirCaixa(ctx, { saldoInicialCentavos: 1000, localEstoqueId: local.id }),
  ]);
  assert.equal(aberturas.filter((r) => r.status === "fulfilled").length, 1);
  const caixa = (await carregarPdv(ctx)).caixa!;
  const entrada: FinalizarEntrada = {
    chave: randomUUID(),
    caixaId: caixa.id,
    modalidade: "BALCAO",
    observacao: "",
    itens: [{ produtoId: ficha.id, quantidade: 2, opcoes: [], observacao: "" }],
    descontoCentavos: 0,
    taxaCentavos: 0,
    pagamentos: [
      { forma: "PIX", valorCentavos: 1000 },
      { forma: "DINHEIRO", valorCentavos: 1500 },
    ],
  };
  const ids = await Promise.all([
    finalizarVenda(ctx, entrada),
    finalizarVenda(ctx, entrada),
  ]);
  assert.equal(ids[0], ids[1]);
  assert.equal(
    await db.pdvVenda.count({ where: { organizacaoId: org.id } }),
    1,
  );
  assert.equal(
    (
      await db.posicaoEstoque.findUniqueOrThrow({
        where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
      })
    ).quantidade.toString(),
    "8",
  );
  assert.equal(
    await db.movimentoEstoque.count({
      where: { unidadeId: unidade.id, tipo: "VENDA" },
    }),
    1,
  );
  assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 2000);
  await assert.rejects(
    () => finalizarVenda(ctx, { ...entrada, observacao: "outro pedido" }),
    /outro carrinho/,
  );
  const segunda = await finalizarVenda(ctx, {
    ...entrada,
    chave: randomUUID(),
    descontoCentavos: 1,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 2000 }],
  });
  await cancelarVenda(ctx, { vendaId: segunda, motivo: "Teste de reversão" });
  await assert.rejects(
    () =>
      finalizarVenda(
        { ...ctx, permissoes: new Set(["pdv.ver", "pdv.vender"]) },
        { ...entrada, chave: randomUUID(), descontoCentavos: 1 },
      ),
    /descontos/,
  );
  await assert.rejects(
    () =>
      finalizarVenda(ctx, {
        ...entrada,
        chave: randomUUID(),
        itens: [{ ...entrada.itens[0], quantidade: 99 }],
        pagamentos: [{ forma: "PIX", valorCentavos: 99000 }],
      }),
    /Estoque insuficiente/,
  );
  assert.equal(
    await db.pdvVenda.count({ where: { organizacaoId: org.id } }),
    2,
  );
  await db.fichaTecnica.update({
    where: { id: ficha.id },
    data: { precoVenda: 99 },
  });
  await db.itemDeFicha.updateMany({
    where: { fichaId: ficha.id },
    data: { quantidade: 3 },
  });
  assert.equal(
    (await db.pdvVenda.findUniqueOrThrow({ where: { id: ids[0] } }))
      .totalCentavos,
    2000,
  );
  await cancelarVenda(ctx, {
    vendaId: ids[0],
    motivo: "Cancelamento fictício",
  });
  await cancelarVenda(ctx, {
    vendaId: ids[0],
    motivo: "Repetição sem duplicar",
  });
  assert.equal(
    (
      await db.posicaoEstoque.findUniqueOrThrow({
        where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
      })
    ).quantidade.toString(),
    "10",
  );
  await movimentarCaixa(ctx, {
    caixaId: caixa.id,
    tipo: "SUPRIMENTO",
    valorCentavos: 500,
    motivo: "Fundo fictício",
  });
  await movimentarCaixa(ctx, {
    caixaId: caixa.id,
    tipo: "SANGRIA",
    valorCentavos: 200,
    motivo: "Retirada fictícia",
  });
  await assert.rejects(
    () =>
      movimentarCaixa(ctx, {
        caixaId: caixa.id,
        tipo: "SANGRIA",
        valorCentavos: 9999,
        motivo: "Saldo insuficiente",
      }),
    /supera/,
  );
  await fecharCaixa(ctx, {
    caixaId: caixa.id,
    valorContadoCentavos: 1250,
    observacao: "Conferência fictícia",
  });
  const encerrado = (await carregarPdv(ctx)).caixasAnteriores[0];
  assert.equal(encerrado.saldoEsperadoCentavos, 1300);
  assert.equal(encerrado.diferencaCentavos, -50);
  await assert.rejects(
    () => finalizarVenda(ctx, { ...entrada, chave: randomUUID() }),
    /não está aberto/,
  );
  assert.equal(
    await finalizarVenda(ctx, entrada),
    ids[0],
    "replay confirmado funciona depois do fechamento",
  );
  assert.ok(
    (await db.auditoria.count({
      where: { organizacaoId: org.id, entidade: "PdvVenda" },
    })) >= 4,
  );
  await salvarComplementos(ctx, {
    produtoId: ficha.id,
    codigo: "PDV-1",
    grupos: [],
  });
  assert.equal((await carregarPdv(ctx)).produtos[0].codigo, "PDV-1");

  // A venda e o fechamento disputam a mesma trava: ou o fechamento inclui a
  // venda inteira, ou a venda é recusada sem baixar estoque depois de fechado.
  const caixaDaCorrida = await abrirCaixa(ctx, {
    saldoInicialCentavos: 1000,
    localEstoqueId: local.id,
  });
  const [vendaConcorrente, fechamentoConcorrente] = await Promise.allSettled([
    finalizarVenda(ctx, {
      ...entrada,
      chave: randomUUID(),
      caixaId: caixaDaCorrida,
      pagamentos: [{ forma: "DINHEIRO", valorCentavos: 19800 }],
    }),
    fecharCaixa(ctx, {
      caixaId: caixaDaCorrida,
      valorContadoCentavos: 1000,
      observacao: "Corrida fictícia com venda",
    }),
  ]);
  assert.equal(fechamentoConcorrente.status, "fulfilled");
  const caixaFinal = await db.pdvCaixa.findUniqueOrThrow({
    where: { id: caixaDaCorrida },
  });
  const saldoEstoque = (
    await db.posicaoEstoque.findUniqueOrThrow({
      where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
    })
  ).quantidade.toString();
  if (vendaConcorrente.status === "fulfilled") {
    assert.equal(caixaFinal.saldoFechamentoCentavos, 20800);
    assert.equal(saldoEstoque, "4");
  } else {
    assert.match(String(vendaConcorrente.reason), /não está aberto/);
    assert.equal(caixaFinal.saldoFechamentoCentavos, 1000);
    assert.equal(saldoEstoque, "10");
  }
});
