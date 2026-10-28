import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { db } from "@/server/db";
import {
  publicarPedidoRecebido,
  EVENTO_PEDIDO_RECEBIDO,
} from "@/server/pedidos-recebidos";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import type { PedidoRecebido } from "@/lib/pedido-recebido";
import { processarPedidosRecebidos } from "@/modules/pdv/services/pedidos-recebidos";
import { listarPedidos, moverPedido } from "@/modules/pdv/services/pedidos";
import {
  abrirCaixa,
  finalizarVenda,
  cancelarVenda,
} from "@/modules/pdv/services/pdv";
import { receberPedido } from "@/modules/pdv/services/recebimentos";
import {
  listarAgendamentos,
  processarAgendamentosVencidos,
  iniciarAgendado,
} from "@/modules/pdv/services/agendamentos";
import {
  prepararLegadoCw,
  confirmarLegadoCw,
  gravarEventoCw,
} from "@/connectors/cardapioweb/recebimento";
import { processarRecebimentoCw } from "@/connectors/cardapioweb/worker";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige PostgreSQL local exclusivo _test.");
after(async () => db.$disconnect());

async function contexto() {
  const org = await db.organizacao.create({
    data: { nome: "Rede fictícia", slug: `cw-pdv-test-${randomUUID()}` },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "A" },
  });
  const outra = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Outra loja fictícia", codigo: "B" },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador fictício",
      email: `${randomUUID()}@example.invalid`,
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
    ehDiretor: true,
    permissoes: new Set(["*"]),
  };
  return { ctx, e: { organizacaoId: org.id, unidadeId: unidade.id }, outra };
}
const snapshot = (
  alteracoes: Partial<PedidoRecebido> = {},
): PedidoRecebido => ({
  numeroOrigem: "10",
  canal: "Cardápio digital",
  situacao: "confirmed",
  situacaoNome: "Confirmado",
  etapa: "COZINHA",
  modalidade: "ENTREGA",
  criadoEm: new Date(Date.now() - 120000).toISOString(),
  atualizadoEm: new Date().toISOString(),
  agendadoPara: null,
  cliente: "Cliente fictício reservado",
  observacao: "Sem cebola",
  totalCentavos: 7050,
  freteCentavos: 500,
  itens: [
    {
      produtoId: "externo:1",
      nome: "Pizza fictícia",
      quantidade: 1,
      observacao: "",
      precoUnitarioCentavos: 6550,
      totalCentavos: 6550,
      complementos: [
        { grupo: "Sabores", nome: "1× Mussarela", precoCentavos: 0 },
      ],
    },
  ],
  pagamentos: [
    {
      meio: "Pix",
      tipo: "ONLINE",
      situacao: "pending",
      pago: false,
      totalCentavos: 7050,
      trocoParaCentavos: null,
    },
  ],
  entrega: {
    destinatario: "Cliente fictício reservado",
    telefone: "11999999999",
    logradouro: "Rua fictícia privada",
    numero: "12",
    complemento: "",
    bairro: "Centro",
    cidade: "Cidade fictícia",
    uf: "SP",
    cep: "01000000",
    referencia: "",
  },
  ...alteracoes,
});
const publicar = (
  e: { organizacaoId: string; unidadeId: string },
  ref: string,
  dados = snapshot(),
) =>
  db.$transaction((tx) =>
    publicarPedidoRecebido(tx, e, "CARDAPIO_WEB", ref, dados),
  );

test("webhook → API → evento durável → mesmo kanban, com sequência compartilhada e sem segunda venda", async () => {
  const { ctx, e } = await contexto();
  const local = await db.localEstoque.create({
    data: { unidadeId: e.unidadeId, nome: "Estoque fictício" },
  });
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: e.organizacaoId,
      nome: "Insumo fictício",
      unidadeMedida: "UN",
      custoMedio: 2,
    },
  });
  const ficha = await db.fichaTecnica.create({
    data: {
      organizacaoId: e.organizacaoId,
      nome: "Produto fictício",
      precoVenda: 10,
      rendimento: 1,
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: e.unidadeId,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: 100,
    },
  });
  const caixaId = await abrirCaixa(ctx, {
    localEstoqueId: local.id,
    saldoInicialCentavos: 0,
  });
  const vender = () =>
    finalizarVenda(ctx, {
      chave: randomUUID(),
      caixaId,
      modalidade: "RETIRADA",
      observacao: "",
      itens: [
        { produtoId: ficha.id, quantidade: 1, opcoes: [], observacao: "" },
      ],
      descontoCentavos: 0,
      taxaCentavos: 0,
      pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
    });
  const nativa = await vender();
  const inicial = (await listarPedidos(ctx)).pedidos[0];
  assert.equal(inicial.numero, 1);

  Object.assign(process.env, {
    CARDAPIOWEB_ENCRYPTION_KEY: "ac".repeat(32),
    APP_URL: "https://tetteo.example.test",
  });
  const merchant = parseInt(randomUUID().slice(0, 6), 16) + 10000000;
  const scope = { ...e, usuarioId: ctx.usuario.id };
  const segredo = "webhook-ficticio-pdv-".repeat(3);
  const horario = new Date().toISOString();
  const pedido = {
    id: 1234,
    display_id: 10,
    merchant_id: merchant,
    status: "confirmed",
    order_type: "delivery",
    sales_channel: "catalog",
    created_at: horario,
    updated_at: horario,
    total: 70.5,
    delivery_fee: 5,
    customer: { name: "Cliente fictício reservado", phone: "11999999999" },
    delivery_address: {
      street: "Rua fictícia privada",
      number: "12",
      neighborhood: "Centro",
      city: "Cidade fictícia",
      state: "SP",
    },
    items: [
      {
        item_id: 1,
        name: "Pizza fictícia",
        quantity: 1,
        unit_price: 65.5,
        total_price: 65.5,
        options: [],
      },
    ],
    payments: [
      {
        total: 70.5,
        payment_method: "pix",
        payment_type: "online",
        status: "pending",
      },
    ],
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const api = new URL(String(input));
    assert.equal(api.hostname, "integracao.cardapioweb.com");
    assert.equal(init?.method, "GET");
    assert.equal(
      new Headers(init?.headers).get("X-API-KEY"),
      "api-ficticia-pdv",
    );
    if (api.pathname.endsWith("/merchant"))
      return Response.json({ id: merchant, name: "Loja fictícia" });
    if (api.pathname.endsWith("/orders")) return Response.json([pedido]);
    assert.ok(api.pathname.endsWith("/orders/1234"));
    return Response.json(pedido);
  };
  try {
    await prepararLegadoCw(scope, "producao", "api-ficticia-pdv", segredo);
    const vinculo = await db.cardapioWebRecebimento.findUniqueOrThrow({
      where: {
        ambiente_merchantId: { ambiente: "producao", merchantId: merchant },
      },
    });
    await confirmarLegadoCw(scope, vinculo.id);
    assert.equal(
      await gravarEventoCw("producao", segredo, {
        event_id: "criou-pdv",
        event_type: "ORDER_CREATED",
        merchant_id: merchant,
        order_id: 1234,
        order_status: "confirmed",
        created_at: horario,
      }),
      "recebido",
    );
    await db.cardapioWebPedido.create({
      data: {
        ...e,
        recebimentoId: vinculo.id,
        orderId: 1234,
        displayId: "10",
        estado: "confirmed",
        modalidade: "delivery",
        canal: "catalog",
        totalCentavos: 7050n,
        criadoNoProvedorEm: new Date(horario),
        atualizadoNoProvedorEm: new Date(horario),
      },
    });
    await processarRecebimentoCw(vinculo.id);
    assert.equal(
      await db.cardapioWebEvento.count({
        where: { recebimentoId: vinculo.id, origem: "REPROCESSAMENTO" },
      }),
      1,
    );
    await Promise.all([
      processarPedidosRecebidos(e),
      processarPedidosRecebidos(e),
    ]);
    let quadro = await listarPedidos(ctx);
    const externo = quadro.pedidos.find((p) => p.origem)!;
    assert.equal(externo.numero, 2);
    assert.equal(externo.origem?.numero, "10");
    assert.equal(externo.origem?.nome, "Cardápio Web");
    assert.equal(externo.vendaId, null);
    assert.equal(externo.venda.status, "EXTERNA");
    assert.equal(externo.venda.totalCentavos, 7050);
    assert.equal(externo.origem?.pagamentos[0].pago, false);
    assert.equal(externo.venda.itens[0].nome, "Pizza fictícia");
    const financeiroAntes = await db.pdvVenda.findMany({ where: e });
    await processarRecebimentoCw(vinculo.id); // reentrada após a confirmação persistida
    await processarPedidosRecebidos(e);
    assert.equal(
      (await listarPedidos(ctx)).pedidos.filter((p) => p.origem).length,
      1,
    );
    await publicar(e, "segunda-origem", snapshot());
    await Promise.all([
      vender(),
      processarPedidosRecebidos(e),
      processarPedidosRecebidos(e),
    ]);
    quadro = await listarPedidos(ctx);
    assert.deepEqual(
      quadro.pedidos.map((p) => p.numero),
      [1, 2, 3, 4],
    );
    assert.equal(
      (await listarPedidos(ctx, { visao: "ENTREGA" })).pedidos.length,
      2,
    );
    assert.equal(
      (await listarPedidos(ctx, { visao: "RETIRADA" })).pedidos.length,
      2,
    );
    assert.equal(quadro.totaisVisao.TODOS, 4);
    assert.equal(quadro.totaisVisao.ENTREGA, 2);
    assert.equal(quadro.totaisVisao.RETIRADA, 2);
    assert.equal(quadro.pedidos.find((p) => p.vendaId === nativa)?.numero, 1);
    assert.equal(
      await db.pdvVenda.count({ where: e }),
      financeiroAntes.length + 1,
    );
    assert.equal(
      Number(
        (
          await db.posicaoEstoque.findFirstOrThrow({
            where: { unidadeId: e.unidadeId, insumoId: insumo.id },
          })
        ).quantidade,
      ),
      98,
    );
    const leitura = await listarPedidos({
      ...ctx,
      permissoes: new Set(["pdv.ver"]),
    });
    const json = JSON.stringify(leitura);
    assert.ok(
      !json.includes("11999999999") &&
        !json.includes("Rua fictícia privada") &&
        !json.includes("Cliente fictício reservado"),
    );
    await assert.rejects(
      moverPedido(ctx, {
        pedidoId: externo.id,
        versao: externo.versao,
        destino: "AGUARDANDO_COLETA",
      }),
      /origem/,
    );
    await assert.rejects(
      receberPedido(ctx, {
        vendaId: externo.id,
        caixaId,
        chave: randomUUID(),
        versaoFinanceira: 1,
        pagamentos: [{ forma: "PIX", valorCentavos: 7050 }],
      }),
    );
    await assert.rejects(
      cancelarVenda(ctx, {
        vendaId: externo.id,
        motivo: "Cancelamento fictício",
      }),
    );
    const auditorias = JSON.stringify(
      await db.auditoria.findMany({
        where: { ...e, entidade: { in: ["PdvPedido", "PedidoRecebido"] } },
      }),
    );
    assert.ok(
      !auditorias.includes("11999999999") &&
        !auditorias.includes("Rua fictícia privada"),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("atualizações e eventos repetidos mantêm número, retomam após falha e não regridem revisão", async () => {
  const { ctx, e } = await contexto();
  const inicio = snapshot();
  await assert.rejects(
    db.$transaction(async (tx) => {
      await publicarPedidoRecebido(
        tx,
        e,
        "CARDAPIO_WEB",
        "mesmo-pedido",
        inicio,
      );
      throw new Error("Falha fictícia antes do commit");
    }),
  );
  assert.equal(await db.pedidoRecebido.count({ where: e }), 0);
  assert.equal(await db.evento.count({ where: e }), 0);
  await publicar(e, "mesmo-pedido", inicio);
  const antes = await db.entregaEvento.count({ where: { evento: e } });
  await publicar(e, "mesmo-pedido", inicio);
  assert.equal(await db.entregaEvento.count({ where: { evento: e } }), antes);
  // Falha de auditoria precisa desfazer a criação e deixar o evento para nova tentativa.
  await db.$executeRawUnsafe(
    `CREATE FUNCTION cw_pdv_falha_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizacaoId" = '${e.organizacaoId}' AND NEW.entidade = 'PdvPedido' THEN RAISE EXCEPTION 'falha ficticia'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    "CREATE TRIGGER cw_pdv_falha_teste BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION cw_pdv_falha_teste()",
  );
  try {
    assert.equal(await processarPedidosRecebidos(e), 0);
    assert.equal(await db.pdvPedido.count({ where: e }), 0);
    assert.equal(
      await db.entregaEvento.count({
        where: { status: "PENDENTE", evento: e },
      }),
      1,
    );
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER cw_pdv_falha_teste ON auditoria");
    await db.$executeRawUnsafe("DROP FUNCTION cw_pdv_falha_teste()");
  }
  await processarPedidosRecebidos(e);
  const p = (await listarPedidos(ctx)).pedidos[0];
  assert.equal(p.numero, 1);
  const revisao = new Date(
    Date.parse(inicio.atualizadoEm) + 1000,
  ).toISOString();
  await publicar(
    e,
    "mesmo-pedido",
    snapshot({
      atualizadoEm: revisao,
      etapa: "SAIU_ENTREGA",
      situacao: "released",
      situacaoNome: "Saiu para entrega",
    }),
  );
  await Promise.all([
    processarPedidosRecebidos(e),
    processarPedidosRecebidos(e),
  ]);
  const atualizado = (await listarPedidos(ctx)).pedidos[0];
  assert.equal(atualizado.numero, p.numero);
  assert.equal(atualizado.status, "SAIU_ENTREGA");
  assert.equal(atualizado.versao, 2);
  await publicar(e, "mesmo-pedido", inicio);
  await processarPedidosRecebidos(e);
  assert.equal((await listarPedidos(ctx)).pedidos[0].status, "SAIU_ENTREGA");
  await publicar(
    e,
    "mesmo-pedido",
    snapshot({
      atualizadoEm: new Date(Date.parse(revisao) + 1000).toISOString(),
      etapa: "CANCELADO",
      situacao: "canceled",
      situacaoNome: "Cancelado",
    }),
  );
  assert.equal((await listarPedidos(ctx)).pedidos[0].status, "CANCELADO");
  assert.equal(await db.pdvVenda.count({ where: e }), 0);
});

test("duas unidades com o mesmo número externo são isoladas e evento cruzado é recusado", async () => {
  const { ctx, e, outra } = await contexto();
  const b = { ...e, unidadeId: outra.id };
  const a = await publicar(e, "loja-a:123", snapshot());
  await publicar(b, "loja-b:123", snapshot());
  await processarPedidosRecebidos();
  assert.equal((await listarPedidos(ctx)).pedidos[0].numero, 1);
  assert.equal(
    (await listarPedidos({ ...ctx, unidadeAtiva: outra })).pedidos[0].numero,
    1,
  );
  assert.equal((await listarPedidos(ctx)).pedidos[0].origem?.numero, "10");
  const malicioso = await db.evento.create({
    data: {
      ...b,
      tipo: EVENTO_PEDIDO_RECEBIDO,
      correlacaoId: randomUUID(),
      dados: { pedidoRecebidoId: a.id },
      entregas: { create: { appDestino: "pdv" } },
    },
  });
  await processarPedidosRecebidos(b);
  assert.equal(await db.pdvPedido.count({ where: b }), 1);
  assert.equal(
    (
      await db.entregaEvento.findUniqueOrThrow({
        where: {
          eventoId_appDestino: { eventoId: malicioso.id, appDestino: "pdv" },
        },
      })
    ).status,
    "PENDENTE",
  );
  await assert.rejects(
    db.pdvPedido.create({ data: { ...b, recebidoId: a.id, numero: 9 } }),
  );
  const mais = await publicar(e, "posterior", snapshot({ numeroOrigem: "11" }));
  await db.unidade.update({
    where: { id: e.unidadeId },
    data: { ativa: false },
  });
  assert.equal(await processarPedidosRecebidos(e), 0);
  assert.equal(
    await db.pdvPedido.count({ where: { ...e, recebidoId: mais.id } }),
    0,
  );
});

test("agendado externo aguarda confirmação da origem e mantém a sequência quando entra na cozinha", async () => {
  const { ctx, e } = await contexto();
  const para = new Date(Date.now() + 3600000).toISOString();
  const d = snapshot({
    etapa: "AGENDADO",
    situacao: "scheduled_confirmed",
    situacaoNome: "Agendado confirmado",
    agendadoPara: para,
  });
  await publicar(e, "agendado", d);
  assert.equal((await listarPedidos(ctx)).pedidos[0].status, "AGENDADO");
  assert.equal(
    (await listarPedidos(ctx, { visao: "AGENDADOS" })).pedidos[0].origem
      ?.numero,
    "10",
  );
  const agenda = (await listarAgendamentos(ctx)).pedidos[0];
  assert.equal(agenda.numero, 1);
  assert.equal(agenda.origem?.numero, "10");
  assert.equal(
    await processarAgendamentosVencidos(e, new Date(Date.now() + 7200000)),
    0,
  );
  await assert.rejects(
    iniciarAgendado(ctx, {
      chave: randomUUID(),
      pedidoId: agenda.pedidoId,
      versao: 1,
      motivo: "Iniciar pedido externo",
    }),
    /origem/,
  );
  await publicar(e, "agendado", {
    ...d,
    atualizadoEm: new Date(Date.parse(d.atualizadoEm) + 1000).toISOString(),
    etapa: "COZINHA",
    situacao: "confirmed",
    situacaoNome: "Confirmado",
  });
  const quadro = await listarPedidos(ctx);
  assert.equal(quadro.pedidos[0].numero, 1);
  assert.equal(quadro.pedidos[0].status, "COZINHA");
  assert.equal((await listarAgendamentos(ctx)).pedidos[0].origem?.numero, "10");
});
