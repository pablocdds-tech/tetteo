import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { db } from "@/server/db";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import {
  iniciarAgendado,
  listarAgendamentos,
  processarAgendamentosVencidos,
  reagendarPedido,
} from "./agendamentos";
import { formatoLocalSaoPaulo } from "../schemas/agendamento";
const alvo = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(alvo.hostname) ||
  !alvo.pathname.includes("_test")
)
  throw Error("Exige banco local _test.");
after(async () => db.$disconnect());
test("agendamentos paginam sem perder atrasados, repetem fatos e nunca reescrevem financeiro", async () => {
  const org = await db.organizacao.create({
    data: { nome: "Agenda fictícia", slug: randomUUID() },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Agenda", codigo: "TEST" },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador teste",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Teste" },
  });
  const e = { organizacaoId: org.id, unidadeId: unidade.id };
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
  const caixa = await db.pdvCaixa.create({
    data: {
      ...e,
      localEstoqueId: local.id,
      abertoPorId: usuario.id,
      operador: usuario.nome,
      saldoInicialCentavos: 0,
    },
  });
  const agora = new Date();
  const para = new Date(agora.getTime() + 3600000);
  const inicio = new Date(para.getTime() - 30 * 60000);
  async function pedido(numero: number, atrasado = false) {
    const venda = await db.pdvVenda.create({
      data: {
        ...e,
        caixaId: caixa.id,
        chave: randomUUID(),
        payloadHash: "test",
        usuarioId: usuario.id,
        operador: usuario.nome,
        modalidade: "BALCAO",
        subtotalCentavos: 1000,
        descontoCentavos: 0,
        taxaCentavos: 0,
        totalCentavos: 1000,
        trocoCentavos: 0,
        itens: [],
        pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
        consumo: [],
      },
    });
    const entrega = atrasado ? new Date(agora.getTime() - 3600000) : para;
    return db.pdvPedido.create({
      data: {
        ...e,
        vendaId: venda.id,
        numero,
        status: "AGENDADO",
        agendadoPara: entrega,
        iniciarPreparoEm: new Date(entrega.getTime() - 30 * 60000),
        antecedenciaMinutos: 30,
        eventos: {
          create: {
            para: "AGENDADO",
            versao: 1,
            usuarioId: usuario.id,
            operador: usuario.nome,
          },
        },
      },
    });
  }
  const primeiro = await pedido(1, true);
  for (let n = 2; n <= 21; n++) await pedido(n);
  const pagina = await listarAgendamentos(ctx);
  assert.equal(pagina.totalRegistros, 21);
  assert.equal(pagina.pedidos.length, 20);
  assert.equal(pagina.resumo.atrasados, 1);
  assert.equal(
    (await listarAgendamentos(ctx, { pagina: 2 })).pedidos.length,
    1,
  );
  const futuro = await db.pdvPedido.findFirstOrThrow({
    where: { ...e, numero: 2 },
  });
  assert.ok(futuro.vendaId, "Este agendamento foi criado por uma venda local.");
  const entrada = {
    pedidoId: futuro.id,
    versao: 1,
    chave: randomUUID(),
    agendamento: {
      paraLocal: formatoLocalSaoPaulo(new Date(agora.getTime() + 7200000)),
      antecedenciaMinutos: 30,
    },
    motivo: "Cliente ajustou horário",
  };
  const financeiro = await db.pdvVenda.findUniqueOrThrow({
    where: { id: futuro.vendaId },
  });
  const reagendado = await reagendarPedido(ctx, entrada);
  assert.equal(reagendado.versao, 2);
  const iniciar = {
    pedidoId: futuro.id,
    versao: 2,
    chave: randomUUID(),
    motivo: "Adiantar preparo",
  };
  await iniciarAgendado(ctx, iniciar);
  assert.equal((await reagendarPedido(ctx, entrada)).status, "COZINHA");
  assert.equal((await iniciarAgendado(ctx, iniciar)).versao, 3);
  await assert.rejects(
    reagendarPedido(ctx, { ...entrada, chave: randomUUID() }),
  );
  assert.deepEqual(
    await db.pdvVenda.findUniqueOrThrow({ where: { id: futuro.vendaId } }),
    financeiro,
  );
  const liberados = await Promise.all([
    processarAgendamentosVencidos(e, agora),
    processarAgendamentosVencidos(e, agora),
  ]);
  assert.equal(liberados[0] + liberados[1], 1);
  assert.equal(
    (await db.pdvPedido.findUniqueOrThrow({ where: { id: primeiro.id } }))
      .status,
    "COZINHA",
  );
  assert.equal(
    await db.pdvPedidoEvento.count({
      where: { pedidoId: primeiro.id, para: "COZINHA" },
    }),
    1,
  );
  await db.unidade.update({
    where: { id: unidade.id },
    data: { ativa: false },
  });
  assert.equal(
    await processarAgendamentosVencidos(
      e,
      new Date(inicio.getTime() + 86400000),
    ),
    0,
  );
});
