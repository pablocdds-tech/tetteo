import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { FinalizarEntrada } from "../types";
import type { EntregaSnapshot } from "../entrega-types";
import { converterAgendamento } from "../schemas/agendamento";
import {
  iniciarAgendado,
  listarAgendamentos,
  processarAgendamentosVencidos,
  reagendarPedido,
} from "./agendamentos";
import { retomarCarrinho, salvarCarrinho } from "./carrinhos";
import { obterDocumentoImpressao } from "./impressoes";
import {
  abrirCaixa,
  cancelarVenda,
  carregarPdv,
  fecharCaixa,
  finalizarVenda,
} from "./pdv";
import { listarPedidos } from "./pedidos";
import { receberPedido } from "./recebimentos";

const alvo = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(alvo.hostname) ||
  !alvo.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());
const localSP = (d: Date) =>
  new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 16);
const agenda = (horas = 2) => ({
  paraLocal: localSP(new Date(Date.now() + horas * 3600000)),
  antecedenciaMinutos: 30,
});
async function cenario() {
  const org = await db.organizacao.create({
    data: { nome: "Agenda fictícia", slug: `agenda-fluxo-${randomUUID()}` },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "TESTE" },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Operador fictício agenda",
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
    organizacao: org,
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade],
    podeVerRedeInteira: false,
    permissoes: new Set(["*"]),
    ehDiretor: true,
  };
  const escopo = { organizacaoId: org.id, unidadeId: unidade.id };
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
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: unidade.id,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: 20,
    },
  });
  const caixaId = await abrirCaixa(ctx, {
    saldoInicialCentavos: 1000,
    localEstoqueId: local.id,
  });
  const entrada = (): FinalizarEntrada => ({
    chave: randomUUID(),
    caixaId,
    modalidade: "RETIRADA",
    observacao: "Agendado fictício",
    itens: [{ produtoId: ficha.id, quantidade: 1, opcoes: [], observacao: "" }],
    descontoCentavos: 0,
    taxaCentavos: 0,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1000 }],
    agendamento: agenda(),
  });
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
  const caixa = async () => (await carregarPdv(ctx)).caixa!;
  const pedido = (vendaId: string) =>
    db.pdvPedido.findUniqueOrThrow({
      where: { vendaId },
      include: { eventos: true },
    });
  return {
    org,
    unidade,
    ctx,
    escopo,
    ficha,
    caixaId,
    entrada,
    saldo,
    caixa,
    pedido,
  };
}

test("agenda interpreta data civil São Paulo e recusa datas impossíveis, passado e limites", () => {
  const agora = new Date("2026-10-27T23:00:00Z");
  assert.equal(
    converterAgendamento(
      { paraLocal: "2026-10-28T00:15", antecedenciaMinutos: 30 },
      agora,
    ).agendadoPara.toISOString(),
    "2026-10-28T03:15:00.000Z",
  );
  for (const paraLocal of [
    "2026-02-30T12:00",
    "2026-10-27T19:59",
    "2026-10-27T20:04",
    "2027-02-01T10:00",
    "2026-10-28T24:00",
  ])
    assert.throws(() =>
      converterAgendamento({ paraLocal, antecedenciaMinutos: 30 }, agora),
    );
  for (const antecedenciaMinutos of [0, 1441, 1.5])
    assert.throws(() =>
      converterAgendamento(
        { paraLocal: "2026-10-28T12:00", antecedenciaMinutos },
        agora,
      ),
    );
});

test("agenda confirma estoque/financeiro uma vez, recebe sem liberar preparo e preserva snapshot ao reagendar", async () => {
  const f = await cenario();
  const pagaEntrada = f.entrada();
  const pagaId = await finalizarVenda(f.ctx, pagaEntrada);
  assert.equal(await finalizarVenda(f.ctx, pagaEntrada), pagaId);
  const entrega = {
    destinatario: "Pessoa agenda reservada",
    telefone: "11900000000",
    endereco: {
      logradouro: "Rua agenda reservada",
      numero: "123",
      complemento: "",
      bairro: "Centro fictício",
      cidade: "Mossoró",
      uf: "RN" as const,
      cep: "",
      referencia: "",
    },
    freteCentavos: 500,
    prazoMinutos: 30,
    motivoFreteManual: "Frete fictício combinado",
  };
  const pendenteEntrada: FinalizarEntrada = {
    ...f.entrada(),
    modalidade: "ENTREGA",
    entrega,
    pagamentoPendente: true,
    pagamentos: [],
  };
  const pendenteId = await finalizarVenda(f.ctx, pendenteEntrada);
  let p = await f.pedido(pendenteId);
  assert.equal(p.status, "AGENDADO");
  assert.equal(p.preparoIniciadoEm, null);
  for (const invalido of [
    () => db.$executeRaw`UPDATE "pdv_pedido" SET "versao"=0 WHERE "id"=${p.id}`,
    () => db.$executeRaw`UPDATE "pdv_pedido" SET "numero"=0 WHERE "id"=${p.id}`,
    () =>
      db.$executeRaw`UPDATE "pdv_pedido" SET "antecedenciaMinutos"=NULL WHERE "id"=${p.id}`,
    () =>
      db.$executeRaw`UPDATE "pdv_pedido_evento" SET "de"='INVALIDO' WHERE "pedidoId"=${p.id}`,
    () =>
      db.$executeRaw`UPDATE "pdv_pedido_evento" SET "versao"=0 WHERE "pedidoId"=${p.id}`,
  ])
    await assert.rejects(invalido);
  assert.equal((await f.pedido(pendenteId)).versao, 1);
  assert.equal(await f.saldo(), 18);
  assert.equal((await f.caixa()).saldoEsperadoCentavos, 2000);
  assert.equal((await listarPedidos(f.ctx)).pedidos.length, 0);
  assert.equal((await listarAgendamentos(f.ctx)).totalRegistros, 2);
  const antes = await db.pdvVenda.findUniqueOrThrow({
    where: { id: pendenteId },
  });
  assert.equal(
    (antes.entrega as EntregaSnapshot).previstoEm,
    p.agendadoPara!.toISOString(),
  );
  await receberPedido(f.ctx, {
    vendaId: pendenteId,
    versaoFinanceira: 1,
    chave: randomUUID(),
    caixaId: f.caixaId,
    pagamentos: [{ forma: "DINHEIRO", valorCentavos: 1500 }],
  });
  p = await f.pedido(pendenteId);
  assert.equal(p.status, "AGENDADO");
  assert.equal(p.preparoIniciadoEm, null);
  assert.equal(await f.saldo(), 18);
  assert.equal((await f.caixa()).saldoEsperadoCentavos, 3500);
  const reagendamento = {
    pedidoId: p.id,
    versao: p.versao,
    chave: randomUUID(),
    motivo: "Horário fictício ajustado",
    agendamento: agenda(24),
  };
  const reagendado = await reagendarPedido(f.ctx, reagendamento);
  assert.equal(reagendado.status, "AGENDADO");
  const depois = await db.pdvVenda.findUniqueOrThrow({
    where: { id: pendenteId },
  });
  assert.equal(depois.totalCentavos, 1500);
  assert.equal(depois.freteCentavos, 500);
  assert.deepEqual(depois.consumo, antes.consumo);
  assert.deepEqual(depois.itens, antes.itens);
  assert.deepEqual(
    { ...(depois.entrega as EntregaSnapshot), previstoEm: "" },
    { ...(antes.entrega as EntregaSnapshot), previstoEm: "" },
  );
  assert.equal(
    (depois.entrega as EntregaSnapshot).previstoEm,
    reagendado.agendadoPara,
  );
  const leitor = {
    ...f.ctx,
    ehDiretor: false,
    permissoes: new Set(["pdv.ver"]),
  };
  await assert.rejects(
    () => reagendarPedido(leitor, { ...reagendamento, chave: randomUUID() }),
    /permissão/,
  );
  assert.doesNotMatch(
    JSON.stringify(await listarAgendamentos(leitor)),
    /Rua agenda reservada|11900000000|Pessoa agenda reservada/,
  );
  const viaCozinha = await obterDocumentoImpressao(f.ctx, {
    vendaId: pendenteId,
    tipo: "COZINHA",
  });
  assert.deepEqual(viaCozinha.agendamento, {
    para: reagendado.agendadoPara,
    iniciarPreparoEm: reagendado.iniciarPreparoEm,
    preparoIniciadoEm: null,
  });
  assert.doesNotMatch(
    JSON.stringify(viaCozinha),
    /Rua agenda reservada|11900000000|Pessoa agenda reservada/,
  );
  const paga = await f.pedido(pagaId);
  const venceu = new Date(paga.iniciarPreparoEm!.getTime() + 1000);
  await fecharCaixa(f.ctx, {
    caixaId: f.caixaId,
    valorContadoCentavos: 3500,
    observacao: "Fechamento fictício",
  });
  const resultados = await Promise.all([
    processarAgendamentosVencidos(f.escopo, venceu),
    processarAgendamentosVencidos(f.escopo, venceu),
  ]);
  assert.equal(
    resultados.reduce((a, b) => a + b, 0),
    1,
  );
  const iniciou = await f.pedido(pagaId);
  assert.equal(iniciou.status, "COZINHA");
  assert.equal(iniciou.eventos.length, 2);
  assert.equal(iniciou.eventos.at(-1)!.usuarioId, null);
  assert.equal(iniciou.eventos.at(-1)!.operador, "Sistema");
  assert.equal(await processarAgendamentosVencidos(f.escopo, venceu), 0);
  assert.equal((await listarPedidos(f.ctx)).pedidos.length, 1);
  assert.equal(await f.saldo(), 18);
  assert.equal(
    (await db.pdvCaixa.findUniqueOrThrow({ where: { id: f.caixaId } }))
      .saldoFechamentoCentavos,
    3500,
  );
  await assert.rejects(
    () =>
      cancelarVenda(f.ctx, {
        vendaId: pagaId,
        versaoFinanceira: 1,
        motivo: "Caixa pago já fechado",
      }),
    /fechado/,
  );
  const cedo = {
    pedidoId: reagendado.pedidoId,
    versao: reagendado.versao,
    chave: randomUUID(),
    motivo: "Produção antecipada fictícia",
  };
  await iniciarAgendado(f.ctx, cedo);
  assert.equal((await iniciarAgendado(f.ctx, cedo)).status, "COZINHA");
  assert.equal(
    (await reagendarPedido(f.ctx, reagendamento)).status,
    "COZINHA",
    "retry recupera operação anterior mesmo depois de iniciar",
  );
  await assert.rejects(
    () =>
      iniciarAgendado(
        { ...f.ctx, usuario: { ...f.ctx.usuario, id: randomUUID() } },
        cedo,
      ),
    /outra pessoa|outros dados/,
  );
  assert.equal(await f.saldo(), 18);
  const auditorias = await db.auditoria.findMany({
    where: { organizacaoId: f.org.id },
    select: { valoresAntes: true, valoresDepois: true },
  });
  assert.doesNotMatch(
    JSON.stringify(auditorias),
    /Rua agenda reservada|11900000000|Pessoa agenda reservada/,
  );
});

test("worker concorre com reagendar, iniciar, cancelar e fechar sem dupla produção ou efeitos financeiros", async () => {
  for (const operacao of [
    "reagendar",
    "iniciar",
    "cancelar",
    "fechar",
  ] as const) {
    const f = await cenario();
    const entrada = { ...f.entrada(), pagamentoPendente: true, pagamentos: [] };
    const vendaId = await finalizarVenda(f.ctx, entrada);
    const p = await f.pedido(vendaId);
    const agora = new Date(p.iniciarPreparoEm!.getTime() + 1000);
    const comando = {
      pedidoId: p.id,
      versao: p.versao,
      chave: randomUUID(),
      motivo: "Corrida fictícia agendamento",
    };
    const alteracao = () =>
      operacao === "reagendar"
        ? reagendarPedido(f.ctx, { ...comando, agendamento: agenda(24) })
        : operacao === "iniciar"
          ? iniciarAgendado(f.ctx, comando)
          : operacao === "cancelar"
            ? cancelarVenda(f.ctx, {
                vendaId,
                versaoFinanceira: 1,
                pedidoId: p.id,
                versaoPedido: p.versao,
                motivo: comando.motivo,
              })
            : fecharCaixa(f.ctx, {
                caixaId: f.caixaId,
                valorContadoCentavos: 1000,
                observacao: comando.motivo,
              });
    const respostas = await Promise.allSettled([
      processarAgendamentosVencidos(f.escopo, agora),
      alteracao(),
    ]);
    assert.equal(respostas[0].status, "fulfilled");
    const atual = await f.pedido(vendaId);
    const inicios = atual.eventos.filter((e) => e.para === "COZINHA");
    assert.ok(inicios.length <= 1);
    const venda = await db.pdvVenda.findUniqueOrThrow({
      where: { id: vendaId },
    });
    assert.equal(await f.saldo(), venda.status === "CANCELADA" ? 20 : 19);
    assert.deepEqual(venda.pagamentos, []);
    assert.equal(venda.caixaRecebimentoId, null);
    if (operacao === "reagendar" && respostas[1].status === "fulfilled")
      assert.equal(atual.status, "AGENDADO");
    if (operacao === "iniciar") assert.equal(atual.status, "COZINHA");
    if (operacao === "cancelar" && respostas[1].status === "fulfilled")
      assert.equal(atual.status, "CANCELADO");
    if (operacao === "fechar") {
      assert.equal(respostas[1].status, "fulfilled");
      assert.equal(atual.status, "COZINHA");
      assert.equal(
        (await db.pdvCaixa.findUniqueOrThrow({ where: { id: f.caixaId } }))
          .saldoFechamentoCentavos,
        1000,
      );
    }
  }
});

test("worker respeita organização/unidade inativas e rascunho preserva agendamento vencido", async () => {
  for (const inativo of ["org", "unidade"] as const) {
    const f = await cenario();
    const entrada = f.entrada();
    const vendaId = await finalizarVenda(f.ctx, entrada);
    const p = await f.pedido(vendaId);
    if (inativo === "org")
      await db.organizacao.update({
        where: { id: f.org.id },
        data: { ativa: false },
      });
    else
      await db.unidade.update({
        where: { id: f.unidade.id },
        data: { ativa: false },
      });
    assert.equal(
      await processarAgendamentosVencidos(
        f.escopo,
        new Date(p.iniciarPreparoEm!.getTime() + 1000),
      ),
      0,
    );
    assert.equal((await f.pedido(vendaId)).status, "AGENDADO");
    assert.equal(await f.saldo(), 19);
  }
  const f = await cenario();
  const agendamento = {
    paraLocal: "2026-01-01T12:00",
    antecedenciaMinutos: 30,
  };
  const salvo = await salvarCarrinho(f.ctx, {
    id: randomUUID(),
    versao: 0,
    nome: "Agenda vencida fictícia",
    conteudo: {
      modalidade: "RETIRADA",
      itens: f.entrada().itens,
      observacao: "",
      agendamento,
    },
  });
  const retomado = await retomarCarrinho(f.ctx, { id: salvo.id });
  assert.deepEqual(retomado.carrinho.conteudo.agendamento, agendamento);
  await assert.rejects(
    () =>
      finalizarVenda(f.ctx, {
        ...f.entrada(),
        carrinhoId: salvo.id,
        versaoCarrinho: salvo.versao,
        agendamento,
      }),
    /cinco minutos|noventa dias/,
  );
  const depois = await db.pdvCarrinho.findUniqueOrThrow({
    where: { id: salvo.id },
  });
  assert.equal(depois.status, "ATIVO");
  assert.equal(await f.saldo(), 20);
  const imediato = await finalizarVenda(f.ctx, {
    ...f.entrada(),
    agendamento: {
      paraLocal: localSP(new Date(Date.now() + 10 * 60000)),
      antecedenciaMinutos: 30,
    },
  });
  const preparo = await f.pedido(imediato);
  assert.equal(preparo.status, "COZINHA");
  assert.ok(preparo.preparoIniciadoEm);
  assert.equal(preparo.eventos.length, 1);
  assert.equal(await f.saldo(), 19);
});
