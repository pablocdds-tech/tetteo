import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { obterDesempenho } from "./desempenho";
import { carregarCozinha } from "./cozinha";
import { moverPedido } from "./pedidos";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Exige banco local exclusivo _test.");
after(async () => db.$disconnect());
test("novas seções isolam unidade, agregam pedidos sem duplicar origens e mantêm a cozinha sem PII", async () => {
  const prefixo = "secoes-test-" + randomUUID();
  const org = await db.organizacao.create({
    data: { nome: "Seções fictícias", slug: prefixo },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "TESTE" },
  });
  const outra = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Outra loja", codigo: "OUTRA" },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador fictício",
      email: prefixo + "@example.invalid",
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
    permissoes: new Set(["pdv.ver", "pdv.operar"]),
    ehDiretor: false,
  };
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local fictício" },
  });
  const caixa = await db.pdvCaixa.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      localEstoqueId: local.id,
      abertoPorId: usuario.id,
      operador: usuario.nome,
      saldoInicialCentavos: 0,
    },
  });
  const escopo = { organizacaoId: org.id, unidadeId: unidade.id };
  const base = {
    ...escopo,
    caixaId: caixa.id,
    usuarioId: usuario.id,
    operador: usuario.nome,
    payloadHash: "ficticio",
    modalidade: "RETIRADA",
    descontoCentavos: 0,
    taxaCentavos: 0,
    trocoCentavos: 0,
    itens: [
      {
        produtoId: "ficticio",
        nome: "Pizza teste",
        quantidade: 1,
        opcoes: [],
        observacao: "Sem cebola",
        precoUnitarioCentavos: 1000,
        totalCentavos: 1000,
        complementos: [],
      },
    ],
    consumo: [],
    criadaEm: new Date("2026-10-27T23:00:00Z"),
    cliente: "PII-NAO-RETORNAR",
    observacao: "Bem assada",
  };
  const paga = await db.pdvVenda.create({
    data: {
      ...base,
      chave: randomUUID(),
      subtotalCentavos: 1000,
      totalCentavos: 1000,
      status: "CONCLUIDA",
      pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
    },
  });
  await db.pdvVenda.create({
    data: {
      ...base,
      chave: randomUUID(),
      subtotalCentavos: 2000,
      totalCentavos: 2000,
      status: "PENDENTE",
      pagamentos: [],
    },
  });
  await db.pdvVenda.create({
    data: {
      ...base,
      chave: randomUUID(),
      subtotalCentavos: 900,
      totalCentavos: 900,
      status: "CANCELADA",
      pagamentos: [],
      motivoCancelamento: "Teste fictício",
      canceladaEm: new Date(),
      canceladaPorId: usuario.id,
    },
  });
  const pedido = await db.pdvPedido.create({
    data: {
      ...escopo,
      vendaId: paga.id,
      numero: 1,
      status: "COZINHA",
      criadoEm: base.criadaEm,
    },
  });
  for (const [indice, valor, cancelado] of [
    [2, 4000, false],
    [3, 5000, true],
  ] as const) {
    const data = "2026-10-28T01:00:00.000Z";
    const recebido = await db.pedidoRecebido.create({
      data: {
        ...escopo,
        origem: "CARDAPIO_WEB",
        referencia: randomUUID(),
        numeroOrigem: String(indice),
        situacao: cancelado ? "CANCELADO" : "ENTREGUE",
        criadoNaOrigemEm: new Date(data),
        atualizadoNaOrigemEm: new Date(data),
        conteudo: {
          numeroOrigem: String(indice),
          canal: "Site",
          situacao: cancelado ? "CANCELADO" : "ENTREGUE",
          situacaoNome: cancelado ? "Cancelado" : "Entregue",
          etapa: cancelado ? "CANCELADO" : "ENTREGUE",
          modalidade: "ENTREGA",
          criadoEm: data,
          atualizadoEm: data,
          agendadoPara: null,
          cliente: "PII-EXTERNO",
          observacao: "",
          totalCentavos: valor,
          freteCentavos: 0,
          itens: [
            {
              produtoId: "externo",
              nome: "Pizza externa",
              quantidade: 2,
              observacao: "",
              precoUnitarioCentavos: valor / 2,
              totalCentavos: valor,
              complementos: [],
            },
          ],
          pagamentos: [],
          entrega: null,
        },
      },
    });
    await db.pdvPedido.create({
      data: {
        ...escopo,
        recebidoId: recebido.id,
        numero: indice,
        status: cancelado ? "CANCELADO" : "ENTREGUE",
        revisaoOrigemEm: new Date(data),
        criadoEm: new Date(data),
        ...(cancelado
          ? { canceladoEm: new Date(data) }
          : { entregueEm: new Date(data) }),
      },
    });
  }
  const periodo = { de: "2026-10-27", ate: "2026-10-28" };
  const d = await obterDesempenho(ctx, periodo);
  assert.equal(d.atual.pedidos, 3);
  assert.equal(d.atual.valorCentavos, 7000);
  assert.equal(d.atual.cancelados, 2);
  assert.equal(d.atual.valorCanceladoCentavos, 5900);
  assert.equal(d.atual.pendentes, 1);
  assert.equal(
    d.origens.find((o) => o.nome === "Cardápio Web")?.valorCentavos,
    4000,
  );
  assert.equal(JSON.stringify(d).includes("PII-"), false);
  assert.equal(
    (await obterDesempenho({ ...ctx, unidadeAtiva: outra }, periodo)).atual
      .pedidos,
    0,
  );
  await assert.rejects(() =>
    obterDesempenho({ ...ctx, permissoes: new Set() }, periodo),
  );
  await assert.rejects(() =>
    obterDesempenho({ ...ctx, unidadesVisiveis: [outra] }, periodo),
  );
  const cozinha = await carregarCozinha(ctx);
  assert.equal(cozinha.pedidos.length, 1);
  assert.equal(cozinha.pedidos[0].itens[0].observacao, "Sem cebola");
  assert.equal(JSON.stringify(cozinha).includes("PII-"), false);
  await assert.rejects(() =>
    moverPedido(
      { ...ctx, permissoes: new Set(["pdv.ver"]) },
      { pedidoId: pedido.id, versao: 1, destino: "AGUARDANDO_COLETA" },
    ),
  );
  await moverPedido(ctx, {
    pedidoId: pedido.id,
    versao: 1,
    destino: "AGUARDANDO_COLETA",
  });
  const depois = await carregarCozinha(ctx);
  assert.equal(depois.pedidos[0].status, "AGUARDANDO_COLETA");
  assert.equal(depois.prontos, 1);
  assert.equal(
    (await carregarCozinha({ ...ctx, unidadeAtiva: outra })).pedidos.length,
    0,
  );
});
