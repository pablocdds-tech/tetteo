import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma } from "@prisma/client";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { EntregaEntrada, EntregaSnapshot } from "../entrega-types";
import type { FinalizarEntrada } from "../types";
import { esquemaFinalizar } from "../schemas/venda";
import { salvarCarrinho, retomarCarrinho } from "./carrinhos";
import { obterDocumentoImpressao } from "./impressoes";
import { atribuirEntregador, salvarEntregador } from "./entregas";
import { abrirCaixa, cancelarVenda, carregarPdv, finalizarVenda } from "./pdv";
import { listarPedidos, moverPedido } from "./pedidos";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("delivery integra frete, snapshot, privacidade, rascunho, despacho e estorno sem alterar legado", async () => {
  const slug = `delivery-fluxo-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "Delivery fictício", slug },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "TESTE" },
  });
  const outraUnidade = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Outra loja fictícia",
      codigo: "OUTRA",
    },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador fictício de delivery",
      email: `${slug}@example.invalid`,
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
    unidadesVisiveis: [unidade, outraUnidade],
    podeVerRedeInteira: true,
    permissoes: new Set(["*"]),
    ehDiretor: true,
  };
  const leitor = { ...ctx, permissoes: new Set(["pdv.ver"]), ehDiretor: false };
  const vendedor = {
    ...ctx,
    permissoes: new Set(["pdv.ver", "pdv.vender"]),
    ehDiretor: false,
  };
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local fictício" },
  });
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: org.id,
      nome: "Insumo fictício",
      unidadeMedida: "UN",
      custoMedio: 2,
    },
  });
  const ficha = await db.fichaTecnica.create({
    data: {
      organizacaoId: org.id,
      nome: "Produto fictício",
      precoVenda: 10,
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
  const caixaId = await abrirCaixa(ctx, {
    saldoInicialCentavos: 1000,
    localEstoqueId: local.id,
  });
  const area = await db.pdvAreaEntrega.create({
    data: {
      id: randomUUID(),
      organizacaoId: org.id,
      unidadeId: unidade.id,
      nome: "Área fictícia",
      nomeChave: `area-${slug}`,
      cidade: "Mossoró",
      uf: "RN",
      bairros: ["Centro fictício"],
      freteCentavos: 500,
      prazoMinutos: 45,
      ultimoHash: "fixture",
    },
  });
  const areaOutra = await db.pdvAreaEntrega.create({
    data: {
      id: randomUUID(),
      organizacaoId: org.id,
      unidadeId: outraUnidade.id,
      nome: "Área de outra unidade",
      nomeChave: `outra-${slug}`,
      cidade: "Mossoró",
      uf: "RN",
      bairros: [],
      freteCentavos: 500,
      prazoMinutos: 45,
      ultimoHash: "fixture",
    },
  });
  const entrega: EntregaEntrada = {
    destinatario: "Destinatário fictício reservado",
    telefone: "11900000000",
    endereco: {
      logradouro: "Rua Fictícia Reservada",
      numero: "10",
      complemento: "Casa fictícia",
      bairro: "Centro fictício",
      cidade: "Mossoró",
      uf: "RN",
      cep: "",
      referencia: "Referência fictícia reservada",
    },
    areaId: area.id,
    versaoArea: area.versao,
    freteCentavos: 500,
    prazoMinutos: 45,
    motivoFreteManual: "",
  };
  const entrada: FinalizarEntrada = {
    chave: randomUUID(),
    caixaId,
    modalidade: "ENTREGA",
    entrega,
    observacao: "Delivery fictício",
    itens: [{ produtoId: ficha.id, quantidade: 2, opcoes: [], observacao: "" }],
    descontoCentavos: 100,
    taxaCentavos: 200,
    pagamentos: [
      { forma: "PIX", valorCentavos: 1000 },
      { forma: "DINHEIRO", valorCentavos: 2000 },
    ],
  };
  const saldo = async () =>
    Number(
      (
        await db.posicaoEstoque.findUniqueOrThrow({
          where: {
            localId_insumoId: { localId: local.id, insumoId: insumo.id },
          },
        })
      ).quantidade,
    );
  const assertSemEfeitos = async () => {
    assert.equal(await saldo(), 10);
    assert.equal(
      await db.pdvVenda.count({ where: { unidadeId: unidade.id } }),
      0,
    );
    assert.equal(
      await db.pdvPedido.count({ where: { unidadeId: unidade.id } }),
      0,
    );
    assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 1000);
  };
  const semEndereco = { ...entrada };
  delete semEndereco.entrega;
  await assert.rejects(
    () => finalizarVenda(ctx, { ...semEndereco, chave: randomUUID() }),
    /entrega|endereço/i,
  );
  await assert.rejects(
    () =>
      finalizarVenda(ctx, {
        ...entrada,
        chave: randomUUID(),
        entrega: { ...entrega, areaId: areaOutra.id },
      }),
    /área|unidade/i,
  );
  await assert.rejects(
    () =>
      finalizarVenda(ctx, {
        ...entrada,
        chave: randomUUID(),
        entrega: { ...entrega, freteCentavos: 1 },
      }),
    /mudou/,
  );
  await assert.rejects(
    () =>
      finalizarVenda(ctx, {
        ...entrada,
        chave: randomUUID(),
        entrega: {
          ...entrega,
          endereco: { ...entrega.endereco, bairro: "Outro bairro fictício" },
        },
      }),
    /bairro/,
  );
  await assert.rejects(
    () =>
      finalizarVenda(ctx, {
        ...entrada,
        chave: randomUUID(),
        itens: [{ ...entrada.itens[0], quantidade: 999 }],
        pagamentos: [{ forma: "PIX", valorCentavos: 999600 }],
      }),
    /Estoque insuficiente/,
  );
  await assertSemEfeitos();

  // O rascunho guarda o endereço digitado pelo próprio vendedor, nunca o custo.
  const enderecoCarrinho = {
    destinatario: entrega.destinatario,
    telefone: entrega.telefone,
    endereco: entrega.endereco,
    areaId: entrega.areaId,
  };
  const conteudo = {
    modalidade: "ENTREGA" as const,
    entrega: enderecoCarrinho,
    observacao: "Rascunho fictício",
    itens: entrada.itens,
  };
  const salvo = await salvarCarrinho(vendedor, {
    id: randomUUID(),
    versao: 0,
    nome: "Entrega em espera",
    conteudo,
  });
  const retomado = await retomarCarrinho(vendedor, { id: salvo.id });
  assert.deepEqual(retomado.carrinho.conteudo.entrega, enderecoCarrinho);
  const rawCarrinho = await db.pdvCarrinho.findUniqueOrThrow({
    where: { id: salvo.id },
  });
  assert.doesNotMatch(
    JSON.stringify(rawCarrinho.conteudo),
    /freteCentavos|prazoMinutos|previstoEm|pagamentos|taxaCentavos/,
  );
  await assertSemEfeitos();

  const vendaId = await finalizarVenda(ctx, {
    ...entrada,
    carrinhoId: salvo.id,
    versaoCarrinho: salvo.versao,
  });
  const finalizacao = {
    ...entrada,
    carrinhoId: salvo.id,
    versaoCarrinho: salvo.versao,
  };
  const venda = await db.pdvVenda.findUniqueOrThrow({ where: { id: vendaId } });
  assert.equal(venda.subtotalCentavos, 2000);
  assert.equal(venda.descontoCentavos, 100);
  assert.equal(venda.taxaCentavos, 200);
  assert.equal(venda.freteCentavos, 500);
  assert.equal(venda.totalCentavos, 2600);
  assert.equal(venda.trocoCentavos, 400);
  assert.equal(await saldo(), 8);
  assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 2600);
  const congelada = venda.entrega as unknown as EntregaSnapshot;
  assert.equal(congelada.areaNome, "Área fictícia");
  assert.equal(congelada.freteCentavos, 500);
  assert.equal(congelada.prazoMinutos, 45);
  assert.equal(congelada.endereco.logradouro, entrega.endereco.logradouro);
  assert.ok(
    Math.abs(
      new Date(congelada.previstoEm).getTime() -
        venda.criadaEm.getTime() -
        45 * 60_000,
    ) < 5000,
  );
  assert.equal(
    (await db.pdvCarrinho.findUniqueOrThrow({ where: { id: salvo.id } }))
      .status,
    "CONCLUIDO",
  );

  await db.pdvAreaEntrega.update({
    where: { id: area.id },
    data: {
      nome: "Área alterada depois da venda",
      freteCentavos: 700,
      prazoMinutos: 60,
      versao: { increment: 1 },
    },
  });
  assert.equal(await finalizarVenda(ctx, finalizacao), vendaId);
  await assert.rejects(
    () => finalizarVenda(ctx, { ...entrada, chave: randomUUID() }),
    /mudou/,
  );
  assert.equal(
    await db.pdvVenda.count({ where: { unidadeId: unidade.id } }),
    1,
  );
  assert.equal(await saldo(), 8);
  assert.deepEqual(
    (await db.pdvVenda.findUniqueOrThrow({ where: { id: vendaId } })).entrega,
    venda.entrega,
  );

  const privados =
    /Rua Fictícia Reservada|11900000000|Destinatário fictício reservado|Referência fictícia reservada/;
  const quadroRestrito = await listarPedidos(leitor);
  assert.doesNotMatch(JSON.stringify(quadroRestrito), privados);
  const quadroCompleto = await listarPedidos(ctx);
  assert.match(JSON.stringify(quadroCompleto), privados);
  const comprovanteRestrito = await obterDocumentoImpressao(leitor, {
    vendaId,
    tipo: "COMPROVANTE",
  });
  assert.doesNotMatch(JSON.stringify(comprovanteRestrito), privados);
  const cozinha = await obterDocumentoImpressao(ctx, {
    vendaId,
    tipo: "COZINHA",
  });
  assert.doesNotMatch(JSON.stringify(cozinha), privados);
  assert.doesNotMatch(JSON.stringify(cozinha), /Centavos|pagamentos/);
  const comprovante = await obterDocumentoImpressao(ctx, {
    vendaId,
    tipo: "COMPROVANTE",
  });
  assert.match(JSON.stringify(comprovante), privados);
  if (comprovante.tipo !== "COMPROVANTE") throw new Error("Tipo inesperado");
  assert.equal(comprovante.totalCentavos, 2600);
  assert.equal(comprovante.freteCentavos, 500);
  assert.equal(comprovante.taxaCentavos, 200);

  const pedidoInicial = await db.pdvPedido.findUniqueOrThrow({
    where: { vendaId },
  });
  const pronto = await moverPedido(ctx, {
    pedidoId: pedidoInicial.id,
    versao: pedidoInicial.versao,
    destino: "AGUARDANDO_COLETA",
  });
  await assert.rejects(
    () =>
      moverPedido(ctx, {
        pedidoId: pronto.id,
        versao: pronto.versao,
        destino: "SAIU_ENTREGA",
      }),
    /entregador/i,
  );
  const entregador = await salvarEntregador(ctx, {
    id: randomUUID(),
    versao: 0,
    nome: "Entregador fictício",
    telefone: "",
    ativo: true,
  });
  const inativo = await salvarEntregador(ctx, {
    id: randomUUID(),
    versao: 0,
    nome: "Entregador inativo fictício",
    telefone: "",
    ativo: false,
  });
  const outro = await salvarEntregador(
    { ...ctx, unidadeAtiva: outraUnidade },
    {
      id: randomUUID(),
      versao: 0,
      nome: "Entregador de outra unidade",
      telefone: "",
      ativo: true,
    },
  );
  await assert.rejects(
    () =>
      atribuirEntregador(leitor, {
        pedidoId: pronto.id,
        versaoPedido: pronto.versao,
        entregadorId: entregador.id,
      }),
    /permissão/,
  );
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pronto.id,
        versaoPedido: pronto.versao,
        entregadorId: outro.id,
      }),
    /indisponível|unidade/,
  );
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pronto.id,
        versaoPedido: pronto.versao,
        entregadorId: inativo.id,
      }),
    /inativo/,
  );
  const atribuicao = {
    pedidoId: pronto.id,
    versaoPedido: pronto.versao,
    entregadorId: entregador.id,
  };
  await atribuirEntregador(ctx, atribuicao);
  await atribuirEntregador(ctx, atribuicao);
  const atribuido = await db.pdvPedido.findUniqueOrThrow({
    where: { id: pronto.id },
    include: { eventos: { orderBy: { versao: "asc" } } },
  });
  assert.equal(atribuido.status, "AGUARDANDO_COLETA");
  assert.equal(atribuido.versao, pronto.versao + 1);
  assert.equal(atribuido.entregadorId, entregador.id);
  assert.equal(
    atribuido.eventos.length,
    3,
    "retry da atribuição não cria outro evento",
  );
  assert.equal(
    atribuido.eventos[2].de,
    atribuido.eventos[2].para,
    "atribuição registra evento sem mudar etapa",
  );
  await assert.rejects(
    () =>
      moverPedido(
        { ...leitor, permissoes: new Set(["pdv.ver", "pdv.operar"]) },
        {
          pedidoId: pronto.id,
          versao: atribuido.versao,
          destino: "SAIU_ENTREGA",
        },
      ),
    /permissão/,
  );
  await assert.rejects(
    () =>
      moverPedido(ctx, {
        pedidoId: pronto.id,
        versao: pronto.versao,
        destino: "SAIU_ENTREGA",
      }),
    /mudou/,
  );
  const desativado = await salvarEntregador(ctx, {
    id: entregador.id,
    versao: entregador.versao,
    nome: entregador.nome,
    telefone: entregador.telefone,
    ativo: false,
  });
  await assert.rejects(
    () =>
      moverPedido(ctx, {
        pedidoId: pronto.id,
        versao: atribuido.versao,
        destino: "SAIU_ENTREGA",
      }),
    /ativo/,
  );
  await salvarEntregador(ctx, {
    id: entregador.id,
    versao: desativado.versao,
    nome: entregador.nome,
    telefone: entregador.telefone,
    ativo: true,
  });
  const saiu = await moverPedido(ctx, {
    pedidoId: pronto.id,
    versao: atribuido.versao,
    destino: "SAIU_ENTREGA",
  });
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pronto.id,
        versaoPedido: saiu.versao,
        entregadorId: null,
      }),
    /antes da saída/,
  );
  const entregue = await moverPedido(ctx, {
    pedidoId: pronto.id,
    versao: saiu.versao,
    destino: "ENTREGUE",
  });
  assert.equal(entregue.status, "ENTREGUE");
  assert.equal(await saldo(), 8, "movimentos operacionais não alteram estoque");
  assert.deepEqual(
    await db.pdvVenda.findUniqueOrThrow({ where: { id: vendaId } }),
    venda,
    "atribuição e produção não reescrevem valores financeiros",
  );
  assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 2600);

  // Uma venda antiga sem endereço deve continuar reconhecendo a tentativa antiga.
  const antigaEntrada: FinalizarEntrada = {
    ...semEndereco,
    chave: randomUUID(),
    descontoCentavos: 0,
    taxaCentavos: 0,
    itens: [{ ...entrada.itens[0], quantidade: 1 }],
    pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
  };
  const antiga = await db.pdvVenda.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      caixaId,
      chave: antigaEntrada.chave,
      payloadHash: createHash("sha256")
        .update(JSON.stringify(esquemaFinalizar.parse(antigaEntrada)))
        .digest("hex"),
      usuarioId: usuario.id,
      operador: usuario.nome,
      modalidade: "ENTREGA",
      observacao: antigaEntrada.observacao,
      subtotalCentavos: 1000,
      descontoCentavos: 0,
      taxaCentavos: 0,
      freteCentavos: 0,
      totalCentavos: 1000,
      trocoCentavos: 0,
      entrega: Prisma.JsonNull,
      itens: venda.itens as Prisma.InputJsonValue,
      pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
      consumo: [],
    },
  });
  assert.equal(await finalizarVenda(ctx, antigaEntrada), antiga.id);
  assert.equal(
    await db.pdvPedido.count({ where: { vendaId: antiga.id } }),
    0,
    "replay legado não inventa pedido novo ou endereço",
  );

  // O estorno usa a receita original mesmo que o cadastro seja alterado depois.
  await db.itemDeFicha.updateMany({
    where: { fichaId: ficha.id },
    data: { quantidade: 3 },
  });
  await cancelarVenda(ctx, {
    vendaId,
    motivo: "Cancelamento fictício da entrega",
  });
  await cancelarVenda(ctx, {
    vendaId,
    motivo: "Retry fictício sem estorno duplicado",
  });
  assert.equal(await saldo(), 10);
  assert.equal(
    await db.movimentoEstoque.count({
      where: { unidadeId: unidade.id, tipo: "ESTORNO_VENDA" },
    }),
    1,
  );
  assert.equal(
    (await db.pdvPedido.findUniqueOrThrow({ where: { vendaId } })).status,
    "CANCELADO",
  );
  assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 1000);

  const manual: EntregaEntrada = {
    destinatario: entrega.destinatario,
    telefone: entrega.telefone,
    endereco: entrega.endereco,
    freteCentavos: 123,
    prazoMinutos: 30,
    motivoFreteManual: "Entrega fictícia fora das áreas",
  };
  const entradaManual: FinalizarEntrada = {
    ...entrada,
    chave: randomUUID(),
    entrega: manual,
    descontoCentavos: 0,
    taxaCentavos: 0,
    itens: [{ ...entrada.itens[0], quantidade: 1 }],
    pagamentos: [{ forma: "PIX", valorCentavos: 1123 }],
  };
  await assert.rejects(
    () =>
      finalizarVenda(ctx, {
        ...entradaManual,
        entrega: { ...manual, motivoFreteManual: "" },
      }),
    /motivo/i,
  );
  const manualId = await finalizarVenda(vendedor, entradaManual);
  const vendaManual = await db.pdvVenda.findUniqueOrThrow({
    where: { id: manualId },
  });
  assert.equal(vendaManual.totalCentavos, 1123);
  assert.equal(
    (vendaManual.entrega as unknown as EntregaSnapshot).areaNome,
    null,
  );
  assert.equal(
    (vendaManual.entrega as unknown as EntregaSnapshot).motivoFreteManual,
    manual.motivoFreteManual,
  );
  await cancelarVenda(ctx, {
    vendaId: manualId,
    motivo: "Encerramento do teste manual fictício",
  });
  assert.equal(await saldo(), 10);
  assert.equal((await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos, 1000);
  const auditoria = await db.auditoria.findMany({
    where: { organizacaoId: org.id },
    select: { valoresAntes: true, valoresDepois: true },
  });
  assert.doesNotMatch(
    JSON.stringify(auditoria),
    privados,
    "endereços e telefones não são copiados para a auditoria",
  );
});
