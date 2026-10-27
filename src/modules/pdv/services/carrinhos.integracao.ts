import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { ConteudoCarrinho } from "../carrinho-types";
import type { FinalizarEntrada } from "../types";
import {
  descartarCarrinho,
  listarCarrinhos,
  retomarCarrinho,
  salvarCarrinho,
} from "./carrinhos";
import { abrirCaixa, finalizarVenda } from "./pdv";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("carrinhos persistem sem reserva, isolam operadores e unidades, controlam versão e concluem uma única vez", async () => {
  const prefixo = `carrinho-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "Carrinhos fictícios", slug: prefixo },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "TESTE" },
  });
  const unidade2 = await db.unidade.create({
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
    unidadesVisiveis: [unidade, unidade2],
    podeVerRedeInteira: true,
    permissoes: new Set(["*"]),
    ehDiretor: true,
  };
  const outroOperador = {
    ...ctx,
    usuario: { ...ctx.usuario, id: usuario2.id },
  };
  const outraUnidade = { ...ctx, unidadeAtiva: unidade2 };
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local fictício" },
  });
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
      rendimento: 1,
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: unidade.id,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: 10,
    },
  });
  const conteudo: ConteudoCarrinho = {
    modalidade: "BALCAO",
    observacao: "Pedido fictício",
    itens: [{ produtoId: ficha.id, quantidade: 2, opcoes: [], observacao: "" }],
  };
  const entrada = {
    id: randomUUID(),
    versao: 0,
    nome: "Rascunho fictício",
    conteudo,
  };
  await assert.rejects(
    () => salvarCarrinho({ ...ctx, permissoes: new Set(["pdv.ver"]) }, entrada),
    /permissão/,
  );
  const [salvo, repetido] = await Promise.all([
    salvarCarrinho(ctx, entrada),
    salvarCarrinho(ctx, entrada),
  ]);
  assert.equal(salvo.id, repetido.id);
  assert.equal(salvo.versao, 1);
  assert.equal((await listarCarrinhos(ctx)).length, 1);
  assert.equal(
    (
      await db.posicaoEstoque.findUniqueOrThrow({
        where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
      })
    ).quantidade.toString(),
    "10",
  );
  assert.equal(
    await db.movimentoEstoque.count({ where: { unidadeId: unidade.id } }),
    0,
  );
  assert.equal((await listarCarrinhos(outroOperador)).length, 0);
  assert.equal((await listarCarrinhos(outraUnidade)).length, 0);
  await assert.rejects(
    () => retomarCarrinho(outroOperador, { id: salvo.id }),
    /indisponível/,
  );
  await assert.rejects(
    () => descartarCarrinho(outraUnidade, { id: salvo.id, versao: 1 }),
    /indisponível/,
  );
  const editado = await salvarCarrinho(ctx, {
    ...entrada,
    versao: 1,
    nome: "Editado",
  });
  assert.equal(editado.versao, 2);
  assert.equal(
    (await salvarCarrinho(ctx, { ...entrada, versao: 1, nome: "Editado" }))
      .versao,
    2,
    "retry não incrementa de novo",
  );
  await assert.rejects(
    () => salvarCarrinho(ctx, { ...entrada, versao: 1, nome: "Outra aba" }),
    /outra aba/,
  );
  const registro = await db.pdvCarrinho.findUniqueOrThrow({
    where: { id: salvo.id },
  });
  assert.equal("pagamentos" in (registro.conteudo as object), false);
  await db.fichaTecnica.update({
    where: { id: ficha.id },
    data: { precoVenda: 12 },
  });
  const retomada = await retomarCarrinho(ctx, { id: salvo.id });
  assert.equal(
    retomada.produtos.find((p) => p.id === ficha.id)!.precoCentavos,
    1200,
  );
  await db.fichaTecnica.update({
    where: { id: ficha.id },
    data: { ativo: false },
  });
  await assert.rejects(
    () => retomarCarrinho(ctx, { id: salvo.id }),
    /preservado/,
  );
  assert.deepEqual(
    (await db.pdvCarrinho.findUniqueOrThrow({ where: { id: salvo.id } }))
      .conteudo,
    registro.conteudo,
  );
  await db.fichaTecnica.update({
    where: { id: ficha.id },
    data: { ativo: true },
  });
  const caixaId = await abrirCaixa(ctx, {
    localEstoqueId: local.id,
    saldoInicialCentavos: 0,
  });
  const finalizacao: FinalizarEntrada = {
    chave: randomUUID(),
    caixaId,
    carrinhoId: salvo.id,
    versaoCarrinho: 2,
    ...conteudo,
    entrega: undefined,
    descontoCentavos: 0,
    taxaCentavos: 0,
    pagamentos: [{ forma: "PIX", valorCentavos: 2400 }],
  };
  await assert.rejects(
    () => finalizarVenda(outroOperador, finalizacao),
    /indisponível/,
  );
  await assert.rejects(
    () => finalizarVenda(ctx, { ...finalizacao, versaoCarrinho: 1 }),
    /outra aba/,
  );
  const insuficiente = await salvarCarrinho(ctx, {
    ...entrada,
    id: randomUUID(),
    nome: "Sem saldo",
    conteudo: {
      ...conteudo,
      itens: [{ ...conteudo.itens[0], quantidade: 99 }],
    },
  });
  await assert.rejects(
    () =>
      finalizarVenda(ctx, {
        ...finalizacao,
        chave: randomUUID(),
        carrinhoId: insuficiente.id,
        versaoCarrinho: 1,
        itens: [{ ...conteudo.itens[0], quantidade: 99 }],
        pagamentos: [{ forma: "PIX", valorCentavos: 118800 }],
      }),
    /Estoque insuficiente/,
  );
  assert.equal(
    (await db.pdvCarrinho.findUniqueOrThrow({ where: { id: insuficiente.id } }))
      .status,
    "ATIVO",
  );
  assert.equal(
    await db.pdvVenda.count({ where: { unidadeId: unidade.id } }),
    0,
  );
  const outraChave = { ...finalizacao, chave: randomUUID() };
  const corridas = await Promise.allSettled([
    finalizarVenda(ctx, finalizacao),
    finalizarVenda(ctx, outraChave),
  ]);
  assert.equal(corridas.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await db.pdvVenda.count({ where: { unidadeId: unidade.id } }),
    1,
  );
  const indiceConfirmado = corridas.findIndex((r) => r.status === "fulfilled");
  await assert.rejects(
    () =>
      finalizarVenda(
        outroOperador,
        indiceConfirmado === 0 ? finalizacao : outraChave,
      ),
    /indisponível/,
  );
  assert.equal(
    await finalizarVenda(
      ctx,
      indiceConfirmado === 0 ? finalizacao : outraChave,
    ),
    (corridas[indiceConfirmado] as PromiseFulfilledResult<string>).value,
  );
  assert.equal(
    (await db.pdvCarrinho.findUniqueOrThrow({ where: { id: salvo.id } }))
      .status,
    "CONCLUIDO",
  );
  assert.equal(
    (
      await db.posicaoEstoque.findUniqueOrThrow({
        where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
      })
    ).quantidade.toString(),
    "8",
  );
  await assert.rejects(
    () => finalizarVenda(ctx, { ...finalizacao, chave: randomUUID() }),
    /concluído/,
  );
  await descartarCarrinho(ctx, { id: insuficiente.id, versao: 1 });
  await descartarCarrinho(ctx, { id: insuficiente.id, versao: 1 });
  assert.equal((await listarCarrinhos(ctx)).length, 0);
  await assert.rejects(
    () => retomarCarrinho(ctx, { id: insuficiente.id }),
    /indisponível/,
  );
  const disputado = await salvarCarrinho(ctx, {
    ...entrada,
    id: randomUUID(),
    nome: "Disputa entre abas",
  });
  const [salvamentoConcorrente, conclusaoConcorrente] =
    await Promise.allSettled([
      salvarCarrinho(ctx, {
        ...entrada,
        id: disputado.id,
        versao: disputado.versao,
        nome: "Editado em outra aba",
      }),
      finalizarVenda(ctx, {
        ...finalizacao,
        chave: randomUUID(),
        carrinhoId: disputado.id,
        versaoCarrinho: disputado.versao,
      }),
    ]);
  assert.equal(
    [salvamentoConcorrente, conclusaoConcorrente].filter(
      (resultado) => resultado.status === "fulfilled",
    ).length,
    1,
    "uma edição e uma conclusão da mesma versão não podem confirmar juntas",
  );
  const carrinhoDisputado = await db.pdvCarrinho.findUniqueOrThrow({
    where: { id: disputado.id },
  });
  const saldoDepoisDaDisputa = (
    await db.posicaoEstoque.findUniqueOrThrow({
      where: { localId_insumoId: { localId: local.id, insumoId: insumo.id } },
    })
  ).quantidade.toString();
  assert.equal(carrinhoDisputado.versao, 2);
  if (salvamentoConcorrente.status === "fulfilled") {
    assert.equal(conclusaoConcorrente.status, "rejected");
    if (conclusaoConcorrente.status === "rejected")
      assert.match(String(conclusaoConcorrente.reason), /outra aba/);
    assert.equal(carrinhoDisputado.status, "ATIVO");
    assert.equal(saldoDepoisDaDisputa, "8");
    await descartarCarrinho(ctx, { id: disputado.id, versao: 2 });
  } else {
    assert.equal(conclusaoConcorrente.status, "fulfilled");
    assert.match(String(salvamentoConcorrente.reason), /concluído/);
    assert.equal(carrinhoDisputado.status, "CONCLUIDO");
    assert.equal(saldoDepoisDaDisputa, "6");
  }
  const cliente = await db.crmContact.create({
    data: { storeId: unidade.id, name: "Cliente fictício" },
  });
  const semCrm = { ...ctx, permissoes: new Set(["pdv.ver", "pdv.vender"]) };
  await assert.rejects(
    () =>
      salvarCarrinho(semCrm, {
        ...entrada,
        id: randomUUID(),
        conteudo: { ...conteudo, clienteId: cliente.id },
      }),
    /permissão/,
  );
  for (let n = 0; n < 20; n++)
    await salvarCarrinho(ctx, {
      ...entrada,
      id: randomUUID(),
      nome: `Rascunho ${n}`,
    });
  await assert.rejects(
    () => salvarCarrinho(ctx, { ...entrada, id: randomUUID() }),
    /20 carrinhos/,
  );
  assert.equal((await listarCarrinhos(ctx)).length, 20);
  assert.ok(
    (await db.auditoria.count({
      where: { organizacaoId: org.id, entidade: "PdvCarrinho" },
    })) >= 24,
  );
});
