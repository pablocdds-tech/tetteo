import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma } from "@prisma/client";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { FinalizarEntrada } from "../types";
import type { ReceberEntrada } from "../recebimento-types";
import { diaPedidos } from "../schemas/pedido";
import { salvarCarrinho } from "./carrinhos";
import { consultarHistorico, exportarHistorico } from "./historico";
import { obterDocumentoImpressao } from "./impressoes";
import {
  abrirCaixa,
  cancelarVenda,
  carregarPdv,
  fecharCaixa,
  finalizarVenda,
} from "./pdv";
import { listarPedidos, moverPedido } from "./pedidos";
import { consultarRecebimento, receberPedido } from "./recebimentos";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

async function cenario() {
  const slug = `pendente-fluxo-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "Pagamento pendente fictício", slug },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "TESTE" },
  });
  const outra = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Outra fictícia", codigo: "OUTRA" },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Caixa fictício",
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
    unidadesVisiveis: [unidade, outra],
    podeVerRedeInteira: true,
    permissoes: new Set(["*"]),
    ehDiretor: true,
  };
  const vendedor = {
    ...ctx,
    permissoes: new Set(["pdv.ver", "pdv.vender"]),
    ehDiretor: false,
  };
  const leitor = { ...ctx, permissoes: new Set(["pdv.ver"]), ehDiretor: false };
  const localA = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Origem fictícia" },
  });
  const localB = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Outro local fictício" },
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
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.posicaoEstoque.createMany({
    data: [
      {
        unidadeId: unidade.id,
        localId: localA.id,
        insumoId: insumo.id,
        quantidade: 10,
      },
      {
        unidadeId: unidade.id,
        localId: localB.id,
        insumoId: insumo.id,
        quantidade: 20,
      },
    ],
  });
  const caixaId = await abrirCaixa(ctx, {
    saldoInicialCentavos: 1000,
    localEstoqueId: localA.id,
  });
  const entrada: FinalizarEntrada = {
    chave: randomUUID(),
    caixaId,
    modalidade: "RETIRADA",
    observacao: "Pedido fictício",
    itens: [{ produtoId: ficha.id, quantidade: 1, opcoes: [], observacao: "" }],
    descontoCentavos: 0,
    taxaCentavos: 0,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }],
  };
  const pendente = (): FinalizarEntrada => ({
    ...entrada,
    chave: randomUUID(),
    pagamentoPendente: true,
    pagamentos: [],
  });
  const saldo = async (localId = localA.id) =>
    Number(
      (
        await db.posicaoEstoque.findUniqueOrThrow({
          where: { localId_insumoId: { localId, insumoId: insumo.id } },
        })
      ).quantidade,
    );
  const cash = async () =>
    (await carregarPdv(ctx)).caixa!.saldoEsperadoCentavos;
  return {
    ctx,
    vendedor,
    leitor,
    org,
    unidade,
    outra,
    usuario,
    localA,
    localB,
    insumo,
    ficha,
    caixaId,
    entrada,
    pendente,
    saldo,
    cash,
  };
}

test("pendente consome uma vez, recebe em outro caixa/local e cancela com estoque original sem reprecificar", async () => {
  const f = await cenario();
  const imediata = await finalizarVenda(f.ctx, f.entrada);
  assert.equal(await finalizarVenda(f.ctx, f.entrada), imediata);
  assert.equal(
    (await db.pdvVenda.findUniqueOrThrow({ where: { id: imediata } })).status,
    "CONCLUIDA",
  );
  assert.equal(await f.cash(), 2000);
  assert.equal(await f.saldo(), 9);
  await assert.rejects(() =>
    finalizarVenda(f.ctx, {
      ...f.entrada,
      chave: randomUUID(),
      pagamentos: [],
    }),
  );
  await assert.rejects(() =>
    finalizarVenda(f.ctx, {
      ...f.pendente(),
      pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }],
    }),
  );

  const entrega = {
    destinatario: "Destinatário pendente reservado",
    telefone: "11900000000",
    endereco: {
      logradouro: "Rua Fictícia Pendente Reservada",
      numero: "10",
      complemento: "",
      bairro: "Centro fictício",
      cidade: "Mossoró",
      uf: "RN" as const,
      cep: "",
      referencia: "Referência pendente reservada",
    },
    freteCentavos: 500,
    prazoMinutos: 30,
    motivoFreteManual: "Frete fictício combinado",
  };
  const itens = [{ ...f.entrada.itens[0], quantidade: 2 }];
  const salvo = await salvarCarrinho(f.ctx, {
    id: randomUUID(),
    versao: 0,
    nome: "Pendente fictício",
    conteudo: {
      modalidade: "ENTREGA",
      entrega: {
        destinatario: entrega.destinatario,
        telefone: entrega.telefone,
        endereco: entrega.endereco,
      },
      observacao: "Rascunho fictício",
      itens,
    },
  });
  const entradaPendente: FinalizarEntrada = {
    ...f.pendente(),
    carrinhoId: salvo.id,
    versaoCarrinho: salvo.versao,
    modalidade: "ENTREGA",
    entrega,
    itens,
    descontoCentavos: 100,
    taxaCentavos: 100,
  };
  const vendaId = await finalizarVenda(f.ctx, entradaPendente);
  assert.equal(await finalizarVenda(f.ctx, entradaPendente), vendaId);
  await assert.rejects(
    () =>
      finalizarVenda(f.ctx, {
        ...entradaPendente,
        observacao: "Outra tentativa",
      }),
    /outro carrinho/,
  );
  assert.equal(await f.saldo(), 7);
  assert.equal(await f.cash(), 2000, "pendente não é dinheiro recebido");
  const original = await db.pdvVenda.findUniqueOrThrow({
    where: { id: vendaId },
  });
  assert.equal(original.status, "PENDENTE");
  assert.equal(original.totalCentavos, 2500);
  assert.equal(original.versaoFinanceira, 1);
  assert.deepEqual(original.pagamentos, []);
  assert.equal(original.trocoCentavos, 0);
  assert.equal(original.caixaRecebimentoId, null);
  assert.equal(
    (await db.pdvCarrinho.findUniqueOrThrow({ where: { id: salvo.id } }))
      .status,
    "CONCLUIDO",
  );
  const cozinha = (await listarPedidos(f.ctx)).pedidos.find(
    (p) => p.vendaId === vendaId,
  )!;
  assert.equal(cozinha.status, "COZINHA");
  assert.equal(cozinha.venda.status, "PENDENTE");
  const periodoHistorico = {
    de: diaPedidos(original.criadaEm),
    ate: diaPedidos(original.criadaEm),
  };
  const historicoInicial = await consultarHistorico(f.ctx, periodoHistorico);
  assert.equal(historicoInicial.resumo.pendentes, 1);
  assert.equal(historicoInicial.resumo.totalPendenteCentavos, 2500);
  assert.equal(historicoInicial.resumo.concluidas, 1);
  assert.equal(historicoInicial.resumo.totalConcluidoCentavos, 1000);
  const filtroPendente = { ...periodoHistorico, status: "PENDENTE" };
  const historicoPendente = await consultarHistorico(f.ctx, filtroPendente);
  assert.deepEqual(
    historicoPendente.vendas.map((v) => v.id),
    [vendaId],
  );
  assert.equal(historicoPendente.resumo.totalConcluidoCentavos, 0);
  assert.deepEqual(historicoPendente.vendas[0].pagamentos, []);
  assert.equal(historicoPendente.vendas[0].recebidoEm, null);
  assert.equal(historicoPendente.vendas[0].recebidoPor, null);
  const exportacaoPendente = await exportarHistorico(f.ctx, filtroPendente);
  assert.equal(exportacaoPendente.quantidade, 1);
  // Estes dados fictícios não possuem delimitadores ou quebras nas células.
  const celulasCsv = (csv: string) =>
    csv
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .map((linha) =>
        linha
          .split(";")
          .map((celula) => celula.slice(1, -1).replaceAll('""', '"')),
      );
  const [cabecalhoPendente, linhaPendente] = celulasCsv(exportacaoPendente.csv);
  const valorPendente = (nome: string) =>
    linhaPendente[cabecalhoPendente.indexOf(nome)];
  assert.equal(valorPendente("Situação"), "PENDENTE");
  assert.equal(valorPendente("Pagamentos registrados"), "");
  assert.equal(valorPendente("Recebido em (São Paulo)"), "");
  assert.equal(valorPendente("Recebido por"), "");
  const consulta = await consultarRecebimento(f.vendedor, { vendaId });
  assert.equal(consulta.venda.totalCentavos, 2500);
  const privados =
    /Rua Fictícia Pendente Reservada|11900000000|Destinatário pendente reservado|Referência pendente reservada/;
  assert.doesNotMatch(JSON.stringify(consulta), privados);
  await assert.rejects(
    () => consultarRecebimento(f.leitor, { vendaId }),
    /permissão/,
  );
  await assert.rejects(
    () =>
      consultarRecebimento({ ...f.ctx, unidadeAtiva: f.outra }, { vendaId }),
    /indisponível|encontrad/,
  );
  const comprovante = await obterDocumentoImpressao(f.ctx, {
    vendaId,
    tipo: "COMPROVANTE",
  });
  assert.equal(comprovante.statusVenda, "PENDENTE");
  const viaCozinha = await obterDocumentoImpressao(f.ctx, {
    vendaId,
    tipo: "COZINHA",
  });
  assert.doesNotMatch(JSON.stringify(viaCozinha), privados);

  // Entregue antigo ainda em aberto financeiramente não desaparece da cobrança.
  const semReceberId = await finalizarVenda(f.ctx, f.pendente());
  let pedido = await db.pdvPedido.findUniqueOrThrow({
    where: { vendaId: semReceberId },
  });
  await moverPedido(f.ctx, {
    pedidoId: pedido.id,
    versao: pedido.versao,
    destino: "AGUARDANDO_COLETA",
  });
  pedido = await db.pdvPedido.findUniqueOrThrow({ where: { id: pedido.id } });
  await moverPedido(f.ctx, {
    pedidoId: pedido.id,
    versao: pedido.versao,
    destino: "ENTREGUE",
  });
  await db.pdvPedido.update({
    where: { id: pedido.id },
    data: {
      entregueEm: new Date("2026-01-10T12:00:00Z"),
      criadoEm: new Date("2026-01-10T10:00:00Z"),
    },
  });
  assert.ok(
    (await listarPedidos(f.ctx, { dia: "2026-10-27" })).pedidos.some(
      (p) => p.id === pedido.id,
    ),
    "entregue pendente de outro dia permanece visível",
  );
  assert.equal(await f.saldo(), 6);

  // Um legado pago com vínculo nulo continua no saldo do caixa original.
  await db.pdvVenda.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      caixaId: f.caixaId,
      chave: randomUUID(),
      payloadHash: "legado-ficticio",
      usuarioId: f.usuario.id,
      operador: f.usuario.nome,
      modalidade: "RETIRADA",
      subtotalCentavos: 600,
      descontoCentavos: 0,
      taxaCentavos: 0,
      totalCentavos: 600,
      trocoCentavos: 0,
      itens: original.itens as Prisma.InputJsonValue,
      consumo: [],
      pagamentos: [{ forma: "DINHEIRO", valorCentavos: 600 }],
      caixaRecebimentoId: null,
    },
  });
  assert.equal(await f.cash(), 2600);
  await fecharCaixa(f.ctx, {
    caixaId: f.caixaId,
    valorContadoCentavos: 2600,
    observacao: "Origem fechada fictícia",
  });
  const fechado = await db.pdvCaixa.findUniqueOrThrow({
    where: { id: f.caixaId },
  });
  assert.equal(fechado.saldoFechamentoCentavos, 2600);
  const caixaNovoId = await abrirCaixa(f.ctx, {
    saldoInicialCentavos: 500,
    localEstoqueId: f.localB.id,
  });
  await cancelarVenda(f.ctx, {
    vendaId: semReceberId,
    versaoFinanceira: 1,
    motivo: "Pendente não recebido cancelado",
  });
  assert.equal(await f.saldo(), 7);
  assert.equal(await f.cash(), 500);
  await db.fichaTecnica.update({
    where: { id: f.ficha.id },
    data: { precoVenda: 99 },
  });
  await db.itemDeFicha.updateMany({
    where: { fichaId: f.ficha.id },
    data: { quantidade: 3 },
  });
  const recebimento: ReceberEntrada = {
    vendaId,
    versaoFinanceira: 1,
    chave: randomUUID(),
    caixaId: caixaNovoId,
    pagamentos: [
      { forma: "PIX", valorCentavos: 1000 },
      { forma: "DINHEIRO", valorCentavos: 2000 },
    ],
  };
  await assert.rejects(() => receberPedido(f.leitor, recebimento), /permissão/);
  await assert.rejects(
    () => receberPedido({ ...f.ctx, unidadeAtiva: f.outra }, recebimento),
    /indisponível|encontrad/,
  );
  await receberPedido(f.vendedor, recebimento);
  const recebida = await db.pdvVenda.findUniqueOrThrow({
    where: { id: vendaId },
  });
  assert.equal(recebida.status, "CONCLUIDA");
  assert.equal(
    recebida.caixaId,
    f.caixaId,
    "origem do estoque não muda para o caixa que recebe",
  );
  assert.equal(recebida.caixaRecebimentoId, caixaNovoId);
  assert.equal(recebida.versaoFinanceira, 2);
  assert.ok(recebida.recebidoEm);
  assert.equal(
    recebida.totalCentavos,
    2500,
    "recebimento não consulta o preço atual",
  );
  assert.equal(recebida.trocoCentavos, 500);
  const pendentesDepois = await consultarHistorico(f.ctx, filtroPendente);
  assert.equal(pendentesDepois.totalRegistros, 0);
  assert.equal(pendentesDepois.resumo.totalPendenteCentavos, 0);
  assert.equal((await exportarHistorico(f.ctx, filtroPendente)).quantidade, 0);
  const historicoRecebido = await consultarHistorico(f.ctx, {
    ...periodoHistorico,
    busca: vendaId,
  });
  assert.equal(historicoRecebido.resumo.totalConcluidoCentavos, 2500);
  assert.equal(historicoRecebido.resumo.pendentes, 0);
  assert.equal(historicoRecebido.vendas[0].recebidoPor, f.usuario.nome);
  assert.equal(
    historicoRecebido.vendas[0].recebidoEm,
    recebida.recebidoEm!.toISOString(),
  );
  const exportacaoRecebida = await exportarHistorico(f.ctx, {
    ...periodoHistorico,
    busca: vendaId,
  });
  assert.equal(exportacaoRecebida.quantidade, 1);
  const [cabecalhoRecebido, linhaRecebida] = celulasCsv(exportacaoRecebida.csv);
  const valorRecebido = (nome: string) =>
    linhaRecebida[cabecalhoRecebido.indexOf(nome)];
  assert.equal(valorRecebido("Situação"), "CONCLUIDA");
  assert.equal(valorRecebido("Recebido por"), f.usuario.nome);
  assert.equal(
    valorRecebido("Recebido em (São Paulo)"),
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(recebida.recebidoEm!),
  );
  assert.equal(
    valorRecebido("Pagamentos registrados"),
    "PIX: 10,00 | DINHEIRO: 20,00",
  );
  assert.deepEqual(recebida.consumo, original.consumo);
  assert.deepEqual(recebida.itens, original.itens);
  assert.equal(await f.saldo(), 7);
  assert.equal(await f.saldo(f.localB.id), 20);
  assert.equal(await f.cash(), 2000);
  assert.equal(
    (await db.pdvCaixa.findUniqueOrThrow({ where: { id: f.caixaId } }))
      .saldoFechamentoCentavos,
    2600,
  );
  const pedidoRecebido = await db.pdvPedido.findUniqueOrThrow({
    where: { vendaId },
  });
  assert.equal(pedidoRecebido.status, "COZINHA");
  assert.equal(
    pedidoRecebido.versao,
    cozinha.versao + 1,
    "recebimento invalida uma tentativa antiga de cancelar pelo quadro",
  );
  await assert.rejects(
    () =>
      cancelarVenda(f.ctx, {
        vendaId,
        versaoFinanceira: 1,
        motivo: "Versão financeira antiga",
      }),
    /mudou|versão|recebid/i,
  );
  await cancelarVenda(f.ctx, {
    vendaId,
    versaoFinanceira: 2,
    motivo: "Cancelamento após recebimento em outro caixa",
  });
  assert.equal(
    await f.saldo(),
    9,
    "somente a venda imediata permanece consumida",
  );
  assert.equal(await f.saldo(f.localB.id), 20);
  assert.equal(await f.cash(), 500);
  assert.equal(
    await receberPedido(f.vendedor, recebimento),
    vendaId,
    "retry da confirmação após cancelamento não recebe de novo",
  );
  assert.equal(await f.cash(), 500);
  await fecharCaixa(f.ctx, {
    caixaId: caixaNovoId,
    valorContadoCentavos: 500,
    observacao: "Recebimento encerrado fictício",
  });
  assert.equal(
    await receberPedido(f.vendedor, recebimento),
    vendaId,
    "retry após fechamento recupera a confirmação original",
  );
  assert.equal(await f.saldo(), 9);
  const auditorias = await db.auditoria.findMany({
    where: { organizacaoId: f.org.id },
    select: { valoresAntes: true, valoresDepois: true },
  });
  assert.doesNotMatch(JSON.stringify(auditorias), privados);
});

test("duas chaves de recebimento confirmam apenas uma cobrança e uma baixa de estoque", async () => {
  const f = await cenario();
  const vendaId = await finalizarVenda(f.ctx, f.pendente());
  const base: ReceberEntrada = {
    vendaId,
    versaoFinanceira: 1,
    chave: randomUUID(),
    caixaId: f.caixaId,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }],
  };
  const segunda = { ...base, chave: randomUUID() };
  await assert.rejects(() =>
    receberPedido(f.ctx, {
      ...base,
      pagamentos: [{ forma: "PIX", valorCentavos: 999 }],
    }),
  );
  assert.equal(await f.cash(), 1000);
  assert.equal(await f.saldo(), 9);
  assert.equal(
    (await db.pdvVenda.findUniqueOrThrow({ where: { id: vendaId } })).status,
    "PENDENTE",
  );
  const respostas = await Promise.allSettled([
    receberPedido(f.ctx, base),
    receberPedido(f.ctx, segunda),
  ]);
  assert.equal(respostas.filter((r) => r.status === "fulfilled").length, 1);
  const vencedora = respostas[0].status === "fulfilled" ? base : segunda;
  assert.equal(await receberPedido(f.ctx, vencedora), vendaId);
  await assert.rejects(
    () =>
      receberPedido(f.ctx, {
        ...vencedora,
        pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
      }),
    /outro recebimento/,
  );
  await assert.rejects(
    () =>
      receberPedido(
        { ...f.ctx, usuario: { ...f.ctx.usuario, id: randomUUID() } },
        vencedora,
      ),
    /outro recebimento/,
  );
  assert.equal(await f.cash(), 2000);
  assert.equal(await f.saldo(), 9);
  assert.equal(
    await db.movimentoEstoque.count({
      where: { unidadeId: f.unidade.id, tipo: "VENDA" },
    }),
    1,
  );
  assert.equal(
    (await db.pdvVenda.findUniqueOrThrow({ where: { id: vendaId } }))
      .versaoFinanceira,
    2,
  );
  const pedido = await db.pdvPedido.findUniqueOrThrow({
    where: { vendaId },
    include: { eventos: true },
  });
  assert.equal(pedido.eventos.length, 2);
});

test("receber e cancelar a mesma versão não podem confirmar duas alterações financeiras", async () => {
  const f = await cenario();
  const vendaId = await finalizarVenda(f.ctx, f.pendente());
  const pagamento: ReceberEntrada = {
    vendaId,
    versaoFinanceira: 1,
    chave: randomUUID(),
    caixaId: f.caixaId,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }],
  };
  const [receber, cancelar] = await Promise.allSettled([
    receberPedido(f.ctx, pagamento),
    cancelarVenda(f.ctx, {
      vendaId,
      versaoFinanceira: 1,
      motivo: "Cancelamento concorrente fictício",
    }),
  ]);
  assert.equal(
    [receber, cancelar].filter((r) => r.status === "fulfilled").length,
    1,
  );
  const venda = await db.pdvVenda.findUniqueOrThrow({ where: { id: vendaId } });
  if (receber.status === "fulfilled") {
    assert.equal(venda.status, "CONCLUIDA");
    assert.equal(await f.saldo(), 9);
    assert.equal(await f.cash(), 2000);
    await cancelarVenda(f.ctx, {
      vendaId,
      versaoFinanceira: venda.versaoFinanceira,
      motivo: "Encerramento da corrida fictícia",
    });
    assert.equal(await receberPedido(f.ctx, pagamento), vendaId);
  } else {
    assert.equal(venda.status, "CANCELADA");
    assert.equal(await f.saldo(), 10);
    assert.equal(await f.cash(), 1000);
    await cancelarVenda(f.ctx, {
      vendaId,
      versaoFinanceira: 1,
      motivo: "Retry sem duplicar estorno",
    });
  }
  assert.equal(await f.saldo(), 10);
  assert.equal(await f.cash(), 1000);
  assert.equal(
    await db.movimentoEstoque.count({
      where: { unidadeId: f.unidade.id, tipo: "ESTORNO_VENDA" },
    }),
    1,
  );
});

test("recebimento concorrente com fechamento fica integralmente no fechamento ou é recusado sem efeitos", async () => {
  const f = await cenario();
  const vendaId = await finalizarVenda(f.ctx, f.pendente());
  const pagamento: ReceberEntrada = {
    vendaId,
    versaoFinanceira: 1,
    chave: randomUUID(),
    caixaId: f.caixaId,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }],
  };
  const [recebimento, fechamento] = await Promise.allSettled([
    receberPedido(f.ctx, pagamento),
    fecharCaixa(f.ctx, {
      caixaId: f.caixaId,
      valorContadoCentavos: 1000,
      observacao: "Fechamento concorrente fictício",
    }),
  ]);
  assert.equal(fechamento.status, "fulfilled");
  const caixa = await db.pdvCaixa.findUniqueOrThrow({
    where: { id: f.caixaId },
  });
  const venda = await db.pdvVenda.findUniqueOrThrow({ where: { id: vendaId } });
  assert.equal(await f.saldo(), 9);
  if (recebimento.status === "fulfilled") {
    assert.equal(caixa.saldoFechamentoCentavos, 2000);
    assert.equal(venda.status, "CONCLUIDA");
    assert.equal(await receberPedido(f.ctx, pagamento), vendaId);
    await assert.rejects(
      () =>
        cancelarVenda(f.ctx, {
          vendaId,
          versaoFinanceira: venda.versaoFinanceira,
          motivo: "Caixa que recebeu fechado",
        }),
      /fechado/,
    );
  } else {
    assert.equal(caixa.saldoFechamentoCentavos, 1000);
    assert.equal(venda.status, "PENDENTE");
    assert.equal(venda.caixaRecebimentoId, null);
  }
});
