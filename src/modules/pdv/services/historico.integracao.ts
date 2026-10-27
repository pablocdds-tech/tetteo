import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { consultarHistorico, exportarHistorico } from "./historico";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("histórico pagina, filtra e exporta todo o filtro com resumo consistente, escopo e proteção de dados", async () => {
  const prefixo = `historico-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "Histórico fictício", slug: prefixo },
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
  const base = {
    organizacaoId: org.id,
    unidadeId: unidade.id,
    caixaId: caixa.id,
    usuarioId: usuario.id,
    operador: usuario.nome,
    payloadHash: "fictício",
    modalidade: "BALCAO",
    subtotalCentavos: 1000,
    descontoCentavos: 0,
    taxaCentavos: 0,
    totalCentavos: 1000,
    trocoCentavos: 0,
    itens: [
      {
        produtoId: "produto-ficticio",
        nome: "Item fictício",
        quantidade: 1,
        opcoes: [],
        observacao: "ObservacaoItemNaoExportar",
        precoUnitarioCentavos: 1000,
        totalCentavos: 1000,
        complementos: [],
      },
    ],
    pagamentos: [{ forma: "PIX", valorCentavos: 1000 }],
    consumo: [],
    observacao: "EnderecoTelefoneNaoExportar",
  };
  const formas = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"];
  const modalidades = ["BALCAO", "RETIRADA", "ENTREGA"];
  const registros = Array.from({ length: 25 }, (_, n) => ({
    ...base,
    id: randomUUID(),
    chave: randomUUID(),
    usuarioId: n % 2 ? usuario2.id : usuario.id,
    operador: n % 2 ? "=Operador fictício" : "Operador fictício",
    cliente:
      n === 7 ? "@Cliente perigoso" : n === 4 ? "Promo 100%_" : `Cliente ${n}`,
    modalidade: modalidades[n % 3],
    status: n % 5 === 0 ? "CANCELADA" : "CONCLUIDA",
    subtotalCentavos: 1000 + n * 10,
    totalCentavos: 1000 + n * 10,
    pagamentos:
      n === 3
        ? [
            { forma: "PIX", valorCentavos: 500 },
            { forma: "DINHEIRO", valorCentavos: 530 },
          ]
        : [{ forma: formas[n % 4], valorCentavos: 1000 + n * 10 }],
    criadaEm:
      n === 0
        ? new Date("2026-10-27T03:00:00Z")
        : n === 24
          ? new Date("2026-10-28T02:59:59.999Z")
          : new Date(`2026-10-27T12:${String(n).padStart(2, "0")}:00Z`),
  }));
  await db.pdvVenda.createMany({ data: registros });
  await db.pdvVenda.createMany({
    data: [
      {
        ...base,
        id: randomUUID(),
        chave: randomUUID(),
        criadaEm: new Date("2026-10-27T02:59:59.999Z"),
      },
      {
        ...base,
        id: randomUUID(),
        chave: randomUUID(),
        criadaEm: new Date("2026-10-28T03:00:00Z"),
      },
    ],
  });
  await db.pdvPedido.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      vendaId: registros[2].id,
      numero: 123,
      status: "ENTREGUE",
      entregueEm: new Date(),
      atualizadoEm: new Date(),
    },
  });
  const caixaOutra = await db.pdvCaixa.create({
    data: {
      organizacaoId: org.id,
      unidadeId: outra.id,
      localEstoqueId: local.id,
      abertoPorId: usuario.id,
      operador: usuario.nome,
      saldoInicialCentavos: 0,
    },
  });
  await db.pdvVenda.create({
    data: {
      ...base,
      caixaId: caixaOutra.id,
      unidadeId: outra.id,
      id: randomUUID(),
      chave: randomUUID(),
      cliente: "Cliente secreto outra loja",
      criadaEm: new Date("2026-10-27T12:00:00Z"),
    },
  });
  const filtro = { de: "2026-10-27", ate: "2026-10-27" };
  const primeira = await consultarHistorico(ctx, filtro);
  assert.equal(primeira.totalRegistros, 25);
  assert.equal(primeira.vendas.length, 10);
  assert.equal(primeira.totalPaginas, 3);
  assert.equal(primeira.resumo.concluidas, 20);
  assert.equal(primeira.resumo.canceladas, 5);
  assert.equal(
    primeira.resumo.totalConcluidoCentavos,
    registros
      .filter((r) => r.status === "CONCLUIDA")
      .reduce((s, r) => s + r.totalCentavos, 0),
  );
  const segunda = await consultarHistorico(ctx, { ...filtro, pagina: 2 });
  const terceira = await consultarHistorico(ctx, { ...filtro, pagina: 999 });
  assert.equal(terceira.filtros.pagina, 3);
  assert.equal(terceira.vendas.length, 5);
  assert.equal(
    new Set(
      [...primeira.vendas, ...segunda.vendas, ...terceira.vendas].map(
        (v) => v.id,
      ),
    ).size,
    25,
  );
  assert.equal(
    (await consultarHistorico(ctx, { ...filtro, pagamento: "PIX" }))
      .totalRegistros,
    7,
    "pagamento dividido atende filtro por existência",
  );
  assert.equal(
    (await consultarHistorico(ctx, { ...filtro, modalidade: "ENTREGA" }))
      .totalRegistros,
    8,
  );
  assert.equal(
    (await consultarHistorico(ctx, { ...filtro, status: "CANCELADA" }))
      .totalRegistros,
    5,
  );
  assert.equal(
    (await consultarHistorico(ctx, { ...filtro, operadorId: usuario2.id }))
      .totalRegistros,
    12,
  );
  assert.equal(
    (await consultarHistorico(ctx, { ...filtro, busca: "#123" })).vendas[0].id,
    registros[2].id,
  );
  assert.equal(
    (await consultarHistorico(ctx, { ...filtro, busca: registros[11].id }))
      .totalRegistros,
    1,
  );
  assert.equal(
    (await consultarHistorico(ctx, { ...filtro, busca: "100%_" }))
      .totalRegistros,
    1,
  );
  assert.equal(
    (await consultarHistorico(ctx, { ...filtro, busca: "' OR 1=1 --" }))
      .totalRegistros,
    0,
  );
  const composto = {
    ...filtro,
    status: "CONCLUIDA",
    modalidade: "RETIRADA",
    pagamento: "PIX",
    operadorId: usuario2.id,
  };
  const esperado = registros.filter(
    (r) =>
      r.status === "CONCLUIDA" &&
      r.modalidade === "RETIRADA" &&
      r.usuarioId === usuario2.id &&
      r.pagamentos.some((p) => p.forma === "PIX"),
  );
  assert.equal(
    (await consultarHistorico(ctx, composto)).totalRegistros,
    esperado.length,
  );
  await assert.rejects(
    () => consultarHistorico({ ...ctx, permissoes: new Set() }, filtro),
    /permissão/,
  );
  const semCrm = { ...ctx, permissoes: new Set(["pdv.ver"]) };
  const restrita = await consultarHistorico(semCrm, filtro);
  assert.equal(restrita.podeVerClientes, false);
  assert.ok(restrita.vendas.every((v) => v.cliente === null));
  assert.equal(
    (await consultarHistorico(semCrm, { ...filtro, busca: "Cliente 11" }))
      .totalRegistros,
    0,
  );
  const exportado = await exportarHistorico(ctx, { ...filtro, pagina: 2 });
  assert.equal(exportado.quantidade, 25);
  assert.equal(exportado.csv.split("\r\n").length, 26);
  assert.ok(exportado.csv.includes('"\'=Operador fictício"'));
  assert.ok(exportado.csv.includes('"\'@Cliente perigoso"'));
  assert.ok(exportado.csv.includes(registros[0].id));
  assert.ok(!exportado.csv.includes("EnderecoTelefoneNaoExportar"));
  assert.ok(!exportado.csv.includes("ObservacaoItemNaoExportar"));
  assert.ok(!exportado.csv.includes("Cliente secreto outra loja"));
  const csvRestrito = await exportarHistorico(semCrm, filtro);
  assert.ok(!csvRestrito.csv.includes('"Cliente"'));
  assert.ok(!csvRestrito.csv.includes("Cliente 11"));
  const csvComposto = await exportarHistorico(ctx, composto);
  assert.equal(csvComposto.quantidade, esperado.length);
  const auditadas = await db.auditoria.count({
    where: { organizacaoId: org.id, entidade: "PdvHistoricoExportacao" },
  });
  assert.equal(auditadas, 3);
  assert.equal(
    (await consultarHistorico({ ...ctx, unidadeAtiva: outra }, filtro))
      .totalRegistros,
    1,
  );
  await db.pdvVenda.createMany({
    data: Array.from({ length: 4976 }, () => ({
      ...base,
      id: randomUUID(),
      chave: randomUUID(),
      criadaEm: new Date("2026-10-27T12:00:00Z"),
    })),
  });
  await assert.rejects(
    () => exportarHistorico(ctx, filtro),
    /5001 vendas.*5000/,
  );
  assert.equal(
    await db.auditoria.count({
      where: { organizacaoId: org.id, entidade: "PdvHistoricoExportacao" },
    }),
    auditadas,
    "exportação recusada não registra sucesso parcial",
  );
});
