import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { EntregaEntrada } from "../entrega-types";
import { esquemaEntregaSnapshot } from "../schemas/entrega";
import {
  atribuirEntregador,
  listarAreasEntrega,
  listarEntregadores,
  prepararEntrega,
  salvarAreaEntrega,
  salvarEntregador,
} from "./entregas";
import { cancelarVenda } from "./pdv";
import { moverPedido } from "./pedidos";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("delivery protege cotação, cadastros, escopo, versões e atribuição concorrente sem expor contatos em auditoria", async () => {
  const prefixo = `entregas-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "Delivery fictício", slug: prefixo },
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
  const escopo = { organizacaoId: org.id, unidadeId: unidade.id };
  const outroCtx = { ...ctx, unidadeAtiva: outra };
  const vendedor = { ...ctx, permissoes: new Set(["pdv.ver", "pdv.vender"]) };
  const areaDados = {
    id: randomUUID(),
    versao: 0,
    nome: "Nova Betânia",
    cidade: "Mossoró",
    uf: "RN",
    bairros: ["Nova Betânia"],
    freteCentavos: 500,
    prazoMinutos: 40,
    ativa: true,
  };
  await assert.rejects(
    () => salvarAreaEntrega(vendedor, areaDados),
    /permissão/,
  );
  const area = await salvarAreaEntrega(ctx, areaDados);
  assert.equal(area.versao, 1);
  assert.equal(
    (await salvarAreaEntrega(ctx, areaDados)).versao,
    1,
    "retry não cria outra versão",
  );
  assert.equal((await listarAreasEntrega(vendedor)).length, 1);
  assert.equal((await listarAreasEntrega(outroCtx)).length, 0);
  await assert.rejects(
    () => listarAreasEntrega({ ...ctx, permissoes: new Set(["pdv.ver"]) }),
    /permissão/,
  );
  await assert.rejects(
    () =>
      salvarAreaEntrega(ctx, {
        ...areaDados,
        id: randomUUID(),
        nome: "  NOVA BETANIA ",
      }),
    /Já existe/,
  );
  const endereco = {
    logradouro: "Rua privativa fictícia",
    numero: "10",
    complemento: "Casa fictícia",
    bairro: "nova betania",
    cidade: "mossoro",
    uf: "RN" as const,
    cep: "59600000",
    referencia: "Referência privativa fictícia",
  };
  const entrada: EntregaEntrada = {
    destinatario: "Destinatário privado fictício",
    telefone: "84999991234",
    endereco,
    areaId: area.id,
    versaoArea: 1,
    freteCentavos: 500,
    prazoMinutos: 40,
    motivoFreteManual: "",
  };
  const cotar = (dados: unknown, contexto = ctx, esc = escopo) =>
    db.$transaction((tx) =>
      prepararEntrega(
        tx,
        contexto,
        esc,
        dados,
        new Date("2026-10-27T18:00:00Z"),
      ),
    );
  const snapshot = await cotar(entrada);
  assert.equal(snapshot.previstoEm, "2026-10-27T18:40:00.000Z");
  assert.equal(snapshot.areaNome, "Nova Betânia");
  assert.equal(esquemaEntregaSnapshot.safeParse(snapshot).success, true);
  assert.equal("usuarioId" in snapshot, false);
  await assert.rejects(() => cotar({ ...entrada, freteCentavos: 0 }), /mudou/);
  await assert.rejects(() => cotar({ ...entrada, prazoMinutos: 1 }), /mudou/);
  await assert.rejects(
    () =>
      cotar({ ...entrada, endereco: { ...endereco, bairro: "Outro bairro" } }),
    /bairro/,
  );
  await assert.rejects(() => cotar(entrada, outroCtx), /permissão/);
  await assert.rejects(
    () =>
      cotar(entrada, outroCtx, { organizacaoId: org.id, unidadeId: outra.id }),
    /indisponível/,
  );
  const atualizada = await salvarAreaEntrega(ctx, {
    ...areaDados,
    versao: 1,
    freteCentavos: 700,
    prazoMinutos: 45,
  });
  assert.equal(atualizada.versao, 2);
  await assert.rejects(() => cotar(entrada), /mudou/);
  await assert.rejects(
    () =>
      salvarAreaEntrega(ctx, {
        ...areaDados,
        versao: 1,
        nome: "Sobrescrita antiga",
      }),
    /outra tela/,
  );
  const inativa = await salvarAreaEntrega(ctx, {
    ...areaDados,
    versao: 2,
    freteCentavos: 700,
    prazoMinutos: 45,
    ativa: false,
  });
  assert.equal(inativa.versao, 3);
  assert.equal((await listarAreasEntrega(ctx)).length, 0);
  assert.equal((await listarAreasEntrega(ctx, true)).length, 1);
  await assert.rejects(
    () =>
      cotar({
        ...entrada,
        versaoArea: 3,
        freteCentavos: 700,
        prazoMinutos: 45,
      }),
    /inativa/,
  );
  const manual = {
    ...entrada,
    areaId: undefined,
    versaoArea: undefined,
    freteCentavos: 0,
    prazoMinutos: 30,
    motivoFreteManual: "Frete cortesia combinado",
  };
  assert.equal((await cotar(manual)).freteCentavos, 0);
  await assert.rejects(() => cotar({ ...manual, motivoFreteManual: "" }));
  const geralDados = {
    ...areaDados,
    id: randomUUID(),
    nome: "Toda a cidade",
    bairros: [],
  };
  const geral = await salvarAreaEntrega(ctx, geralDados);
  assert.equal(
    (
      await cotar({
        ...entrada,
        areaId: geral.id,
        versaoArea: 1,
        endereco: { ...endereco, bairro: "Qualquer bairro" },
      })
    ).areaNome,
    "Toda a cidade",
  );
  const entregadorDados = {
    id: randomUUID(),
    versao: 0,
    nome: "Entregador fictício",
    telefone: "+55 (84) 98888-1234",
    ativo: true,
  };
  await assert.rejects(() => listarEntregadores(vendedor), /permissão/);
  const entregador = await salvarEntregador(ctx, entregadorDados);
  assert.equal(entregador.telefone, "84988881234");
  assert.equal((await salvarEntregador(ctx, entregadorDados)).versao, 1);
  assert.equal((await listarEntregadores(outroCtx)).length, 0);
  const outroEntregador = await salvarEntregador(outroCtx, {
    ...entregadorDados,
    id: randomUUID(),
  });
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local fictício" },
  });
  const caixa = await db.pdvCaixa.create({
    data: {
      ...escopo,
      localEstoqueId: local.id,
      abertoPorId: usuario.id,
      operador: usuario.nome,
      saldoInicialCentavos: 0,
    },
  });
  const base = {
    ...escopo,
    caixaId: caixa.id,
    usuarioId: usuario.id,
    operador: usuario.nome,
    payloadHash: "fictício",
    modalidade: "ENTREGA",
    observacao: "",
    subtotalCentavos: 1000,
    descontoCentavos: 0,
    taxaCentavos: 0,
    freteCentavos: 0,
    totalCentavos: 1000,
    trocoCentavos: 0,
    itens: [],
    pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
    consumo: [],
  };
  const venda = await db.pdvVenda.create({
    data: { ...base, chave: randomUUID() },
  });
  const pedido = await db.pdvPedido.create({
    data: {
      ...escopo,
      vendaId: venda.id,
      numero: 1,
      eventos: {
        create: {
          de: null,
          para: "COZINHA",
          versao: 1,
          usuarioId: usuario.id,
          operador: usuario.nome,
        },
      },
    },
  });
  await assert.rejects(
    () =>
      atribuirEntregador(vendedor, {
        pedidoId: pedido.id,
        versaoPedido: 1,
        entregadorId: entregador.id,
      }),
    /permissão/,
  );
  await assert.rejects(
    () =>
      atribuirEntregador(outroCtx, {
        pedidoId: pedido.id,
        versaoPedido: 1,
        entregadorId: outroEntregador.id,
      }),
    /indisponível/,
  );
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pedido.id,
        versaoPedido: 1,
        entregadorId: outroEntregador.id,
      }),
    /nesta unidade/,
  );
  const atribuir = {
    pedidoId: pedido.id,
    versaoPedido: 1,
    entregadorId: entregador.id,
  };
  await Promise.all([
    atribuirEntregador(ctx, atribuir),
    atribuirEntregador(ctx, atribuir),
  ]);
  const atribuido = await db.pdvPedido.findUniqueOrThrow({
    where: { id: pedido.id },
  });
  assert.equal(atribuido.versao, 2);
  assert.equal(atribuido.entregadorNome, "Entregador fictício");
  assert.equal(
    await db.pdvPedidoEvento.count({ where: { pedidoId: pedido.id } }),
    2,
  );
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pedido.id,
        versaoPedido: 1,
        entregadorId: null,
      }),
    /outra tela/,
  );
  const driverInativo = await salvarEntregador(ctx, {
    ...entregadorDados,
    versao: 1,
    ativo: false,
  });
  assert.equal(driverInativo.versao, 2);
  await assert.rejects(
    () =>
      salvarEntregador(ctx, {
        ...entregadorDados,
        versao: 1,
        nome: "Nome antigo",
      }),
    /outra tela/,
  );
  await atribuirEntregador(ctx, {
    pedidoId: pedido.id,
    versaoPedido: 2,
    entregadorId: null,
  });
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pedido.id,
        versaoPedido: 3,
        entregadorId: entregador.id,
      }),
    /inativo/,
  );
  await salvarEntregador(ctx, { ...entregadorDados, versao: 2, ativo: true });
  await moverPedido(ctx, {
    pedidoId: pedido.id,
    versao: 3,
    destino: "AGUARDANDO_COLETA",
  });
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pedido.id,
        versaoPedido: 3,
        entregadorId: null,
      }),
    /outra tela/,
    "avanço de produção não é retry de remover entregador",
  );
  await atribuirEntregador(ctx, {
    pedidoId: pedido.id,
    versaoPedido: 4,
    entregadorId: entregador.id,
  });
  assert.equal(
    (await db.pdvVenda.findUniqueOrThrow({ where: { id: venda.id } }))
      .totalCentavos,
    1000,
  );
  assert.equal(
    await db.movimentoEstoque.count({ where: { unidadeId: unidade.id } }),
    0,
  );
  await moverPedido(ctx, {
    pedidoId: pedido.id,
    versao: 5,
    destino: "SAIU_ENTREGA",
  });
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pedido.id,
        versaoPedido: 6,
        entregadorId: null,
      }),
    /antes da saída/,
  );
  const balcao = await db.pdvVenda.create({
    data: { ...base, chave: randomUUID(), modalidade: "BALCAO" },
  });
  const pedidoBalcao = await db.pdvPedido.create({
    data: { ...escopo, vendaId: balcao.id, numero: 2 },
  });
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pedidoBalcao.id,
        versaoPedido: 1,
        entregadorId: entregador.id,
      }),
    /Somente pedidos de entrega/,
  );
  const vendaRace = await db.pdvVenda.create({
    data: { ...base, chave: randomUUID() },
  });
  const pedidoRace = await db.pdvPedido.create({
    data: { ...escopo, vendaId: vendaRace.id, numero: 3 },
  });
  const race = await Promise.allSettled([
    atribuirEntregador(ctx, {
      pedidoId: pedidoRace.id,
      versaoPedido: 1,
      entregadorId: entregador.id,
    }),
    cancelarVenda(ctx, {
      vendaId: vendaRace.id,
      motivo: "Cancelamento fictício de concorrência",
    }),
  ]);
  assert.equal(race[1].status, "fulfilled");
  assert.equal(
    (await db.pdvPedido.findUniqueOrThrow({ where: { id: pedidoRace.id } }))
      .status,
    "CANCELADO",
  );
  await assert.rejects(
    () =>
      atribuirEntregador(ctx, {
        pedidoId: pedidoRace.id,
        versaoPedido: 2,
        entregadorId: null,
      }),
    /não cancelado/,
  );
  const auditorias = await db.auditoria.findMany({
    where: {
      organizacaoId: org.id,
      entidade: { in: ["PdvAreaEntrega", "PdvEntregador", "PdvPedidoEntrega"] },
    },
  });
  const textoAuditoria = JSON.stringify(
    auditorias.map((a) => [a.valoresAntes, a.valoresDepois]),
  );
  for (const segredoFicticio of [
    endereco.logradouro,
    endereco.referencia,
    entrada.destinatario,
    entrada.telefone,
    entregador.telefone,
  ])
    assert.ok(!textoAuditoria.includes(segredoFicticio));
  await db.pdvAreaEntrega.createMany({
    data: Array.from({ length: 198 }, (_, n) => ({
      ...escopo,
      id: randomUUID(),
      nome: `Área volume ${n}`,
      nomeChave: `area volume ${n}`,
      cidade: "Mossoró",
      uf: "RN",
      bairros: [],
      freteCentavos: 0,
      prazoMinutos: 30,
      ultimoHash: "volume",
      atualizadoEm: new Date(),
    })),
  });
  await assert.rejects(
    () =>
      salvarAreaEntrega(ctx, {
        ...areaDados,
        id: randomUUID(),
        nome: "Excesso",
      }),
    /200 áreas/,
  );
  assert.equal((await listarAreasEntrega(ctx, true)).length, 200);
  await db.pdvEntregador.createMany({
    data: Array.from({ length: 199 }, (_, n) => ({
      ...escopo,
      id: randomUUID(),
      nome: `Entregador volume ${n}`,
      telefone: "",
      ultimoHash: "volume",
      atualizadoEm: new Date(),
    })),
  });
  await assert.rejects(
    () => salvarEntregador(ctx, { ...entregadorDados, id: randomUUID() }),
    /200 entregadores/,
  );
  assert.equal((await listarEntregadores(ctx)).length, 200);
});
