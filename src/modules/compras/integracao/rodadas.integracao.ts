import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { abrirRodadasAgendadas, salvarAgenda } from "../services/agenda";
import {
  enviarRequisicao,
  requisicaoDaLoja,
  salvarItem,
  sugestoesDaLoja,
} from "../services/requisicoes";
import { criarRodada, moverRodada, RodadaMudou } from "../services/rodadas";

import { criarCenario, limparBanco, type Cenario } from "./cenario";

let c: Cenario;

beforeEach(async () => {
  await limparBanco();
  c = await criarCenario();
});

after(async () => {
  await db.$disconnect();
});

const semPrazos = {
  prazoRequisicao: null,
  prazoCotacao: null,
  entregaDe: null,
  entregaAte: null,
  responsavelId: null,
  observacao: null,
};

async function rodadaColetando() {
  const comprador = await c.ctx(c.comprador, null);
  const { id } = await criarRodada(comprador, {
    descricao: "Semana de teste",
    unidadeIds: [c.centro.id, c.sul.id],
    ...semPrazos,
  });
  await moverRodada(comprador, id, { versao: 1, para: "COLETANDO" });
  return { id, comprador };
}

async function pedir(
  quem: { id: string },
  loja: { id: string },
  rodadaId: string,
  itens: [string, string][],
  enviar = true,
) {
  const ctx = await c.ctx(quem, loja);
  const req = (await requisicaoDaLoja(ctx, rodadaId))!;
  for (const [insumoId, quantidade] of itens) {
    await salvarItem(ctx, req.id, {
      insumoId,
      quantidade,
      embalagemPreferida: null,
      observacao: null,
    });
  }
  if (enviar) {
    const atual = (await requisicaoDaLoja(ctx, rodadaId))!;
    await enviarRequisicao(ctx, req.id, atual.versao);
  }
  return { ctx, requisicaoId: req.id };
}

describe("rodada", () => {
  test("gerente de loja não cria rodada", async () => {
    const gerente = await c.ctx(c.gerenteCentro, c.centro);
    await assert.rejects(
      () =>
        criarRodada(gerente, {
          descricao: "x",
          unidadeIds: [c.centro.id],
          ...semPrazos,
        }),
      SemPermissao,
    );
  });

  test("duas transições com a mesma versão: uma passa, a outra é recusada", async () => {
    const comprador = await c.ctx(c.comprador, null);
    const { id } = await criarRodada(comprador, {
      descricao: "Corrida",
      unidadeIds: [c.centro.id],
      ...semPrazos,
    });

    const resultado = await Promise.allSettled([
      moverRodada(comprador, id, { versao: 1, para: "COLETANDO" }),
      moverRodada(comprador, id, { versao: 1, para: "COLETANDO" }),
    ]);

    assert.equal(resultado.filter((r) => r.status === "fulfilled").length, 1);
    const recusa = resultado.find((r) => r.status === "rejected");
    assert.ok(recusa && recusa.reason instanceof RodadaMudou);

    const rodada = await db.rodadaDeCompra.findUniqueOrThrow({ where: { id } });
    assert.equal(rodada.estado, "COLETANDO");
    assert.equal(rodada.versao, 2);
  });

  test("consolida só o que foi enviado, e o fornecedor fixo vira compra direcionada", async () => {
    await db.fornecedorInsumo.createMany({
      data: [
        {
          organizacaoId: c.org.id,
          fornecedorId: c.fornecedores.c.id,
          insumoId: c.insumos.mussarela.id,
          nomeEmbalagem: "Peça",
          fixo: true,
          chaveFixo: `${c.org.id}:${c.insumos.mussarela.id}`,
        },
        {
          organizacaoId: c.org.id,
          fornecedorId: c.fornecedores.a.id,
          insumoId: c.insumos.molho.id,
          nomeEmbalagem: "Caixa",
        },
        {
          organizacaoId: c.org.id,
          fornecedorId: c.fornecedores.b.id,
          insumoId: c.insumos.molho.id,
          nomeEmbalagem: "Caixa",
        },
        {
          organizacaoId: c.org.id,
          fornecedorId: c.fornecedores.a.id,
          insumoId: c.insumos.mussarela.id,
          nomeEmbalagem: "Caixa",
        },
      ],
    });

    const { id, comprador } = await rodadaColetando();
    await pedir(c.gerenteCentro, c.centro, id, [
      [c.insumos.mussarela.id, "10"],
      [c.insumos.molho.id, "4,5"],
    ]);
    await pedir(c.gerenteSul, c.sul, id, [[c.insumos.mussarela.id, "5"]]);

    await moverRodada(comprador, id, { versao: 2, para: "COTANDO" });

    const itens = await db.itemDaRodada.findMany({
      where: { rodadaId: id },
      include: { insumo: { select: { nome: true } } },
    });
    const porNome = new Map(itens.map((i) => [i.insumo.nome, i]));
    assert.equal(porNome.get("Mussarela")?.quantidadeTotal.toString(), "15");
    assert.equal(porNome.get("Molho de tomate")?.quantidadeTotal.toString(), "4.5");
    assert.equal(porNome.get("Mussarela")?.modo, "DIRECIONADO");
    assert.equal(porNome.get("Mussarela")?.fornecedorFixoId, c.fornecedores.c.id);

    const solicitacoes = await db.solicitacaoDeCotacao.findMany({
      where: { rodadaId: id },
      include: {
        itens: { include: { itemDaRodada: { include: { insumo: true } } } },
      },
    });
    const de = (fornecedorId: string) =>
      solicitacoes
        .find((s) => s.fornecedorId === fornecedorId)
        ?.itens.map((i) => `${i.itemDaRodada.insumo.nome}${i.direcionado ? "*" : ""}`)
        .sort();

    // A mussarela fixa vai SÓ para o fixo — e marcada. O fornecedor A também
    // vende mussarela, mas não recebe o item: não há disputa aberta nele.
    assert.deepEqual(de(c.fornecedores.c.id), ["Mussarela*"]);
    assert.deepEqual(de(c.fornecedores.a.id), ["Molho de tomate"]);
    assert.deepEqual(de(c.fornecedores.b.id), ["Molho de tomate"]);
  });

  test("loja que não enviou fica de fora, e a auditoria diz qual", async () => {
    const { id, comprador } = await rodadaColetando();
    await pedir(c.gerenteCentro, c.centro, id, [[c.insumos.mussarela.id, "10"]]);
    await pedir(c.gerenteSul, c.sul, id, [[c.insumos.oleo.id, "2"]], false);

    await moverRodada(comprador, id, { versao: 2, para: "COTANDO" });

    const itens = await db.itemDaRodada.findMany({ where: { rodadaId: id } });
    assert.equal(itens.length, 1);
    assert.equal(itens[0].insumoId, c.insumos.mussarela.id);

    const registro = await db.auditoria.findFirstOrThrow({
      where: { entidade: "RodadaDeCompra", entidadeId: id },
      orderBy: { quando: "desc" },
    });
    const depois = registro.valoresDepois as { lojasSemEnvio: string[] };
    assert.deepEqual(depois.lojasSemEnvio, [c.sul.id]);
  });

  test("reabrir sem motivo é recusado", async () => {
    const { id, comprador } = await rodadaColetando();
    await pedir(c.gerenteCentro, c.centro, id, [[c.insumos.mussarela.id, "10"]]);
    await moverRodada(comprador, id, { versao: 2, para: "COTANDO" });
    await moverRodada(comprador, id, { versao: 3, para: "REVISAO" });
    await assert.rejects(
      () => moverRodada(comprador, id, { versao: 4, para: "COTANDO" }),
      /motivo/,
    );
    await moverRodada(comprador, id, {
      versao: 4,
      para: "COTANDO",
      motivo: "Fornecedor B mandou preço novo",
    });
    const rodada = await db.rodadaDeCompra.findUniqueOrThrow({ where: { id } });
    assert.equal(rodada.motivoUltimaReabertura, "Fornecedor B mandou preço novo");
  });
});

describe("requisição da loja", () => {
  test("uma loja não mexe na requisição da outra", async () => {
    const { id } = await rodadaColetando();
    const centro = await c.ctx(c.gerenteCentro, c.centro);
    const reqCentro = (await requisicaoDaLoja(centro, id))!;

    const sul = await c.ctx(c.gerenteSul, c.sul);
    await assert.rejects(
      () =>
        salvarItem(sul, reqCentro.id, {
          insumoId: c.insumos.mussarela.id,
          quantidade: "99",
          embalagemPreferida: null,
          observacao: null,
        }),
      /não encontrada nesta loja/,
    );
    assert.equal(await db.itemDeRequisicao.count(), 0);
  });

  test("enviada não aceita item novo", async () => {
    const { id } = await rodadaColetando();
    const { ctx, requisicaoId } = await pedir(c.gerenteCentro, c.centro, id, [
      [c.insumos.mussarela.id, "10"],
    ]);
    await assert.rejects(
      () =>
        salvarItem(ctx, requisicaoId, {
          insumoId: c.insumos.molho.id,
          quantidade: "2",
          embalagemPreferida: null,
          observacao: null,
        }),
      /já foi enviada/,
    );
  });

  test("vazio e zero não são quantidade", async () => {
    const { id } = await rodadaColetando();
    const ctx = await c.ctx(c.gerenteCentro, c.centro);
    const req = (await requisicaoDaLoja(ctx, id))!;
    for (const quantidade of ["", "0", "0,000"]) {
      await assert.rejects(
        () =>
          salvarItem(ctx, req.id, {
            insumoId: c.insumos.mussarela.id,
            quantidade,
            embalagemPreferida: null,
            observacao: null,
          }),
        /maior que zero/,
      );
    }
  });

  test("envio depois da consolidação é recusado", async () => {
    const { id, comprador } = await rodadaColetando();
    await pedir(c.gerenteCentro, c.centro, id, [[c.insumos.mussarela.id, "10"]]);
    const { ctx, requisicaoId } = await pedir(
      c.gerenteSul,
      c.sul,
      id,
      [[c.insumos.oleo.id, "2"]],
      false,
    );
    await moverRodada(comprador, id, { versao: 2, para: "COTANDO" });

    const atual = (await requisicaoDaLoja(ctx, id))!;
    await assert.rejects(
      () => enviarRequisicao(ctx, requisicaoId, atual.versao),
      /já terminou/,
    );
  });

  test("a sugestão é calculada no servidor, com a conta", async () => {
    await db.posicaoEstoque.create({
      data: {
        unidadeId: c.centro.id,
        localId: c.locais.depositoCentro.id,
        insumoId: c.insumos.mussarela.id,
        quantidade: "3.5",
      },
    });
    await rodadaColetando();
    const ctx = await c.ctx(c.gerenteCentro, c.centro);
    const linhas = await sugestoesDaLoja(ctx);

    const mussarela = linhas.find((l) => l.insumoId === c.insumos.mussarela.id)!;
    assert.equal(mussarela.sugestao.quantidade, "11.500");
    assert.equal(mussarela.sugestao.formula, "mínimo 15 kg – disponível 3,5 kg = 11,5 kg");

    // Nunca contado no Centro: sem sugestão, com alerta — não zero.
    const molho = linhas.find((l) => l.insumoId === c.insumos.molho.id)!;
    assert.equal(molho.sugestao.quantidade, null);
    assert.equal(molho.disponivel, null);
    assert.ok(molho.sugestao.alertas.length > 0);
  });
});

describe("agenda", () => {
  test("uma rodada por semana, mesmo com dois relógios ao mesmo tempo", async () => {
    const comprador = await c.ctx(c.comprador, null);
    const { id: agendaId } = await salvarAgenda(comprador, {
      nome: "Compra semanal",
      diaDaSemana: 1,
      horaAbertura: "07:00",
      horasParaRequisicao: 24,
      horasParaCotacao: 48,
      entregaDeDias: 2,
      entregaAteDias: 3,
      unidadeIds: [c.centro.id, c.sul.id],
      ativa: true,
    });

    const quinta = new Date("2026-09-10T15:00:00Z");
    const [a, b] = await Promise.all([
      abrirRodadasAgendadas(quinta),
      abrirRodadasAgendadas(quinta),
    ]);
    assert.equal(a + b, 1);

    const rodadas = await db.rodadaDeCompra.findMany({
      include: { _count: { select: { requisicoes: true } } },
    });
    assert.equal(rodadas.length, 1);
    assert.equal(rodadas[0].ocorrencia, "2026-W37");
    assert.equal(rodadas[0].estado, "COLETANDO");
    assert.equal(rodadas[0]._count.requisicoes, 2);

    // Mudar o dia no meio da semana não abre a segunda rodada da semana.
    await salvarAgenda(comprador, {
      id: agendaId,
      nome: "Compra semanal",
      diaDaSemana: 3,
      horaAbertura: "07:00",
      horasParaRequisicao: 24,
      horasParaCotacao: 48,
      entregaDeDias: 2,
      entregaAteDias: 3,
      unidadeIds: [c.centro.id, c.sul.id],
      ativa: true,
    });
    assert.equal(await abrirRodadasAgendadas(quinta), 0);
    assert.equal(await db.rodadaDeCompra.count(), 1);

    // Na semana seguinte, sim.
    assert.equal(await abrirRodadasAgendadas(new Date("2026-09-17T15:00:00Z")), 1);
  });

  test("antes da hora não abre", async () => {
    const comprador = await c.ctx(c.comprador, null);
    await salvarAgenda(comprador, {
      nome: "Sexta",
      diaDaSemana: 5,
      horaAbertura: "07:00",
      horasParaRequisicao: 24,
      horasParaCotacao: 48,
      entregaDeDias: 2,
      entregaAteDias: 3,
      unidadeIds: [c.centro.id],
      ativa: true,
    });
    assert.equal(await abrirRodadasAgendadas(new Date("2026-09-10T15:00:00Z")), 0);
  });
});
