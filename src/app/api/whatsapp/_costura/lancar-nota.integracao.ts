import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import type { NotaAssistidaPronta } from "@/server/nota-assistida-contrato";
import { db } from "@/server/db";
import { lancarNotaAssistida } from "./lancar-nota";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.includes("_test"),
  "Somente banco local exclusivo de testes.",
);
after(() => db.$disconnect());

async function fixture() {
  const tag = randomUUID();
  const org = await db.organizacao.create({
    data: { nome: "Notas fictícias", slug: tag },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: tag },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Pessoa fictícia",
      email: `${tag}@example.test`,
      status: "ATIVO",
    },
  });
  const ctx: ContextoSessao = {
    organizacao: org,
    usuario: { ...usuario, avatarUrl: null },
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade],
    permissoes: new Set(["*"]),
    ehDiretor: true,
    podeVerRedeInteira: true,
  };
  const papel = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Diretor fictício",
      permissoes: { create: { chave: "*" } },
    },
  });
  const acesso = await db.acesso.create({
    data: {
      usuarioId: usuario.id,
      organizacaoId: org.id,
      unidadeId: unidade.id,
      papelId: papel.id,
    },
  });
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Depósito fictício" },
  });
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: org.id,
      nome: "Insumo fictício",
      unidadeMedida: "KG",
      custoMedio: "2",
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
  const empresa = await db.empresaFinanceira.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      nome: "Empresa fictícia",
      razaoSocial: "Empresa fictícia",
      cnpj: "11222333000181",
      regime: "SIMPLES",
    },
  });
  const conta = await db.contaFinanceira.create({
    data: {
      unidadeId: unidade.id,
      empresaId: empresa.id,
      nome: "Banco fictício",
      saldoInicial: "1000",
    },
  });
  const categoria = await db.categoriaFinanceira.create({
    data: {
      organizacaoId: org.id,
      nome: "Mercadoria fictícia",
      tipo: "DESPESA",
      grupoDre: "MERCADORIA",
    },
  });
  const nota: NotaAssistidaPronta = {
    operacaoId: randomUUID(),
    fornecedor: { nome: "Fornecedor fictício", documento: "44555666000190" },
    numero: "123",
    serie: "1",
    chaveAcesso: undefined,
    emitidaEm: "2026-11-04",
    recebidaEm: "2026-11-04",
    localId: local.id,
    empresaId: empresa.id,
    categoriaId: categoria.id,
    valorTotal: 30,
    itens: [
      {
        descricao: "Produto na nota",
        insumoId: insumo.id,
        quantidade: 2,
        fatorConversao: 3,
        valorTotal: 30,
      },
    ],
    pagamento: {
      situacao: "A_PAGAR",
      forma: "BOLETO",
      parcelas: [
        { vencimento: "2026-11-20", valor: 15 },
        { vencimento: "2026-12-20", valor: 15 },
      ],
    },
  };
  const saldo = async () =>
    String(
      (
        await db.posicaoEstoque.findUniqueOrThrow({
          where: {
            localId_insumoId: { localId: local.id, insumoId: insumo.id },
          },
        })
      ).quantidade,
    );
  return {
    ctx,
    papel,
    acesso,
    org,
    unidade,
    usuario,
    local,
    insumo,
    empresa,
    conta,
    categoria,
    nota,
    saldo,
  };
}

test("confirmação cria estoque, custo, fornecedor e todas as parcelas em conjunto", async () => {
  const f = await fixture();
  const r = await lancarNotaAssistida(f.ctx, f.nota);
  assert.equal(await f.saldo(), "16");
  assert.equal(
    String(
      (await db.insumo.findUniqueOrThrow({ where: { id: f.insumo.id } }))
        .custoMedio,
    ),
    "3.125",
  );
  const nota = await db.notaEntrada.findUniqueOrThrow({
    where: { id: r.notaId },
  });
  assert.equal(nota.status, "LANCADA");
  assert.equal(nota.recebidaEm.toISOString(), "2026-11-04T03:00:00.000Z");
  const contas = await db.lancamento.findMany({
    where: { id: { in: r.lancamentoIds } },
    orderBy: { parcela: "asc" },
  });
  assert.deepEqual(
    contas.map((c) => [String(c.valor), c.status, c.empresaId, c.composeDre]),
    [
      ["15", "ABERTO", f.empresa.id, false],
      ["15", "ABERTO", f.empresa.id, false],
    ],
  );
  assert.equal(contas[0].notaEntradaId, r.notaId);
  assert.equal(contas[1].notaEntradaId, null);
  assert.equal(contas[0].grupoParcelas, contas[1].grupoParcelas);
  assert.equal(
    await db.baixaFinanceira.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.pessoaFinanceira.count({ where: { unidadeId: f.unidade.id } }),
    1,
  );
});

test("confirmações concorrentes e recuperação após falha de resposta não duplicam nota nem baixa", async () => {
  const f = await fixture();
  const nota = {
    ...f.nota,
    pagamento: {
      situacao: "PAGA",
      forma: "PIX",
      contaId: f.conta.id,
      dataPagamento: "2026-11-04",
      parcelas: [{ vencimento: "2026-11-04", valor: 30 }],
    },
  };
  const [a, b] = await Promise.all([
    lancarNotaAssistida(f.ctx, nota),
    lancarNotaAssistida(f.ctx, nota),
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(await lancarNotaAssistida(f.ctx, nota), a);
  assert.equal(await f.saldo(), "16");
  const conta = await db.lancamento.findUniqueOrThrow({
    where: { id: a.lancamentoIds[0] },
    include: { baixas: true },
  });
  assert.equal(conta.status, "QUITADO");
  assert.equal(conta.baixas.length, 1);
  assert.equal(String(conta.baixas[0].valor), "30");
  await assert.rejects(
    () => lancarNotaAssistida(f.ctx, { ...nota, recebidaEm: "2026-11-03" }),
    /dados diferentes/,
  );
  assert.equal(await f.saldo(), "16");
});

test("reenvio com outra operação recusa nota já existente mesmo sem série e com zeros à esquerda", async () => {
  const f = await fixture();
  const nota = { ...f.nota, serie: undefined };
  await lancarNotaAssistida(f.ctx, nota);
  await assert.rejects(
    () =>
      lancarNotaAssistida(f.ctx, {
        ...nota,
        operacaoId: randomUUID(),
        numero: "00123",
      }),
    /já está cadastrada/,
  );
  assert.equal(await f.saldo(), "16");
});

test("chave fiscal repetida impede entrada mesmo quando número e nome lidos mudam", async () => {
  const f = await fixture();
  const chaveAcesso = "1".repeat(44);
  await lancarNotaAssistida(f.ctx, { ...f.nota, chaveAcesso });
  await assert.rejects(
    () =>
      lancarNotaAssistida(f.ctx, {
        ...f.nota,
        chaveAcesso,
        numero: "999",
        operacaoId: randomUUID(),
      }),
    /já está cadastrada/,
  );
  assert.equal(await f.saldo(), "16");
});

test("sem permissão para cadastrar insumo, a operação inteira é desfeita", async () => {
  const f = await fixture();
  const ctx = {
    ...f.ctx,
    ehDiretor: false,
    permissoes: new Set([
      "financeiro.ver",
      "financeiro.lancar",
      "estoque.lancar",
    ]),
  };
  const nota = {
    ...f.nota,
    itens: [
      {
        descricao: "Novo produto",
        novoInsumo: { nome: "Novo produto fictício", unidadeMedida: "UN" },
        quantidade: 2,
        fatorConversao: 1,
        valorTotal: 30,
      },
    ],
  };
  await assert.rejects(
    () => lancarNotaAssistida(ctx, nota),
    /cadastrar novos insumos/,
  );
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.fornecedor.count({ where: { organizacaoId: f.org.id } }),
    0,
  );
  assert.equal(await f.saldo(), "10");
  const r = await lancarNotaAssistida(f.ctx, nota);
  const itens = await db.notaEntradaItem.findMany({
    where: { notaId: r.notaId },
    include: { insumo: true },
  });
  assert.equal(itens[0].insumo.nome, "Novo produto fictício");
  assert.equal(itens[0].insumo.unidadeMedida, "UN");
});

test("falta de permissão de baixa e referências de outra organização impedem qualquer efeito", async () => {
  const f = await fixture(),
    outra = await fixture();
  const ctx = {
    ...f.ctx,
    ehDiretor: false,
    permissoes: new Set([
      "financeiro.ver",
      "financeiro.lancar",
      "estoque.lancar",
    ]),
  };
  await assert.rejects(
    () =>
      lancarNotaAssistida(ctx, {
        ...f.nota,
        pagamento: {
          situacao: "PAGA",
          forma: "PIX",
          contaId: f.conta.id,
          dataPagamento: "2026-11-04",
          parcelas: [{ vencimento: "2026-11-04", valor: 30 }],
        },
      }),
    /dar baixa/,
  );
  for (const alteracao of [
    { localId: outra.local.id },
    { empresaId: outra.empresa.id },
    { categoriaId: outra.categoria.id },
    { itens: [{ ...f.nota.itens[0], insumoId: outra.insumo.id }] },
    { pagamento: { ...f.nota.pagamento, contaId: outra.conta.id } },
  ])
    await assert.rejects(() =>
      lancarNotaAssistida(f.ctx, { ...f.nota, ...alteracao }),
    );
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(await f.saldo(), "10");
});

test("erro financeiro depois da entrada reverte saldo, custo, nota e novos cadastros", async () => {
  const f = await fixture();
  await db.pessoaFinanceira.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      nome: f.nota.fornecedor.nome,
      documento: f.nota.fornecedor.documento,
      ativa: false,
    },
  });
  await assert.rejects(
    () => lancarNotaAssistida(f.ctx, f.nota),
    /financeira.*inativa/,
  );
  assert.equal(await f.saldo(), "10");
  assert.equal(
    String(
      (await db.insumo.findUniqueOrThrow({ where: { id: f.insumo.id } }))
        .custoMedio,
    ),
    "2",
  );
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.fornecedor.count({ where: { organizacaoId: f.org.id } }),
    0,
  );
});

test("foto fica ligada à nota e sua repetição não exige novo vínculo", async () => {
  const f = await fixture();
  const arquivo = await db.arquivo.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      enviadoPorId: f.usuario.id,
      caminho: "ficticio/sem-bytes.jpg",
      tipo: "image/jpeg",
      tamanho: 4,
      nomeOriginal: "cupom.jpg",
      permissaoLeitura: "estoque.ver",
    },
  });
  const nota = { ...f.nota, arquivoId: arquivo.id };
  const r = await lancarNotaAssistida(f.ctx, nota);
  assert.deepEqual(await lancarNotaAssistida(f.ctx, nota), r);
  const salvo = await db.arquivo.findUniqueOrThrow({
    where: { id: arquivo.id },
  });
  assert.equal(salvo.entidade, "NotaEntrada");
  assert.equal(salvo.entidadeId, r.notaId);
});

test("suspensão depois de preparar a proposta recusa o contexto antigo sem alterar os saldos", async () => {
  const f = await fixture();
  await db.acesso.update({
    where: { id: f.acesso.id },
    data: { status: "SUSPENSO" },
  });
  await assert.rejects(
    () => lancarNotaAssistida(f.ctx, f.nota),
    /acesso atual/,
  );
  assert.equal(await f.saldo(), "10");
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
});

test("permissões de aplicativo seguem o mesmo curinga da sessão do sistema", async () => {
  const f = await fixture();
  await db.papelPermissao.deleteMany({ where: { papelId: f.papel.id } });
  await db.papelPermissao.createMany({
    data: ["estoque.*", "financeiro.*"].map((chave) => ({
      papelId: f.papel.id,
      chave,
    })),
  });
  const ctx = {
    ...f.ctx,
    ehDiretor: false,
    permissoes: new Set(["estoque.*", "financeiro.*"]),
  };
  const r = await lancarNotaAssistida(ctx, f.nota);
  assert.equal(await f.saldo(), "16");
  await assert.rejects(
    () =>
      lancarNotaAssistida(ctx, {
        ...f.nota,
        operacaoId: randomUUID(),
        serie: undefined,
      }),
    /já está cadastrada/,
  );
  assert.ok(r.notaId);
});

test("nota manual preexistente é reconhecida pelo documento formatado do fornecedor", async () => {
  const f = await fixture();
  const fornecedor = await db.fornecedor.create({
    data: {
      organizacaoId: f.org.id,
      nome: "Nome antigo do fornecedor",
      documento: "44.555.666/0001-90",
    },
  });
  await db.notaEntrada.create({
    data: {
      unidadeId: f.unidade.id,
      fornecedorId: fornecedor.id,
      numero: f.nota.numero,
      serie: f.nota.serie,
      recebidaEm: new Date("2026-11-04T03:00:00Z"),
    },
  });
  await assert.rejects(
    () => lancarNotaAssistida(f.ctx, f.nota),
    /já está cadastrada/,
  );
  assert.equal(await f.saldo(), "10");
  assert.equal(
    await db.fornecedor.count({ where: { organizacaoId: f.org.id } }),
    1,
  );
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
});

test("uma foto de outra pessoa não pode ser vinculada por tentativa de identificador", async () => {
  const f = await fixture();
  const arquivo = await db.arquivo.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      enviadoPorId: "outra-pessoa-ficticia",
      caminho: "ficticio/sem-bytes.jpg",
      tipo: "image/jpeg",
      tamanho: 4,
      nomeOriginal: "cupom.jpg",
      permissaoLeitura: "estoque.ver",
    },
  });
  await assert.rejects(
    () => lancarNotaAssistida(f.ctx, { ...f.nota, arquivoId: arquivo.id }),
    /foto não está disponível/,
  );
  assert.equal(await f.saldo(), "10");
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
});

test("data de entrada respeita o fuso da unidade mesmo quando difere da organização", async () => {
  const f = await fixture();
  await db.unidade.update({
    where: { id: f.unidade.id },
    data: { fusoHorario: "America/Manaus" },
  });
  const r = await lancarNotaAssistida(f.ctx, f.nota);
  const nota = await db.notaEntrada.findUniqueOrThrow({
    where: { id: r.notaId },
  });
  assert.equal(nota.recebidaEm.toISOString(), "2026-11-04T04:00:00.000Z");
  assert.equal(nota.emitidaEm!.toISOString(), "2026-11-04T04:00:00.000Z");
});
