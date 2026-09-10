import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  aplicarConsulta,
  atualizarDestino,
  definirDestinoDeTeste,
  enfileirar,
  enviarTeste,
  marcarEnviadaAMao,
  marcarResultado,
  painelDeEnvios,
  pausarCanal,
  reivindicar,
  resolverIncerta,
  vencerTravas,
} from "../services/fila";

import { criarCenario, limparBanco, type Cenario } from "./cenario";

let c: Cenario;

beforeEach(async () => {
  await limparBanco();
  c = await criarCenario();
});

after(async () => {
  await db.$disconnect();
});

const SIMULADOR = { nome: "simulador", simulado: true };
const MIN = 60_000;

async function naFila(quantas: number, fornecedorId?: string) {
  const ids: string[] = [];
  for (let i = 0; i < quantas; i++) {
    const m = await db.$transaction((tx) =>
      enfileirar(tx, {
        organizacaoId: c.org.id,
        unidadeId: c.centro.id,
        fornecedorId: fornecedorId ?? c.fornecedores.a.id,
        tipo: "PEDIDO",
        referenciaTipo: "Pedido",
        referenciaId: `pedido-${i}`,
        sequencia: 1,
        corpo: `Pedido de teste ${i}`,
        chave: `pedido:pedido-${i}:1:${fornecedorId ?? "a"}`,
        criadoPorId: null,
      }),
    );
    ids.push(m.id);
  }
  return ids;
}

const estado = async (id: string) =>
  (await db.mensagemAoFornecedor.findUniqueOrThrow({ where: { id } })).estado;

describe("a fila", () => {
  test("enfileirar a mesma chave de novo devolve a primeira", async () => {
    const dados = {
      organizacaoId: c.org.id,
      unidadeId: c.centro.id,
      fornecedorId: c.fornecedores.a.id,
      tipo: "PEDIDO" as const,
      referenciaTipo: "Pedido",
      referenciaId: "p1",
      sequencia: 1,
      corpo: "x",
      chave: "pedido:p1:1",
      criadoPorId: null,
    };
    const um = await db.$transaction((tx) => enfileirar(tx, dados));
    const dois = await db.$transaction((tx) => enfileirar(tx, dados));
    assert.equal(um.id, dois.id);
    assert.equal(await db.mensagemAoFornecedor.count(), 1);
  });

  test("duas réplicas ao mesmo tempo nunca pegam a mesma mensagem", async () => {
    await naFila(10);
    const agora = new Date();
    const [x, y] = await Promise.all([
      reivindicar("replica-1", 8, agora),
      reivindicar("replica-2", 8, agora),
    ]);
    const ids = [...x, ...y].map((m) => m.id);
    assert.equal(ids.length, 10);
    assert.equal(new Set(ids).size, 10);
  });

  test("incerta não volta sozinha para a fila", async () => {
    const [id] = await naFila(1);
    const agora = new Date();
    await reivindicar("r1", 8, agora);
    await marcarResultado(id, "r1", { tipo: "incerta", erro: "tempo esgotado" }, SIMULADOR, agora);
    assert.equal(await estado(id), "INCERTA");
    assert.deepEqual(await reivindicar("r2", 8, new Date(agora.getTime() + 60 * MIN)), []);
  });

  test("recusada antes de sair: espera crescente, e falha de vez na quinta", async () => {
    const [id] = await naFila(1);
    let t = Date.now();
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      const pegas = await reivindicar("r1", 8, new Date(t));
      assert.equal(pegas.length, 1, `tentativa ${tentativa} deveria pegar`);
      await marcarResultado(
        id,
        "r1",
        { tipo: "recusada-antes", erro: "conexão recusada", tentarDeNovo: true },
        SIMULADOR,
        new Date(t),
      );
      t += 30 * MIN;
    }
    const m = await db.mensagemAoFornecedor.findUniqueOrThrow({ where: { id } });
    assert.equal(m.estado, "FALHOU");
    assert.equal(m.tentativas, 5);
  });

  test("número inválido não tenta de novo", async () => {
    const [id] = await naFila(1);
    await reivindicar("r1", 8, new Date());
    await marcarResultado(
      id,
      "r1",
      { tipo: "recusada-antes", erro: "número inexistente", tentarDeNovo: false },
      SIMULADOR,
      new Date(),
    );
    assert.equal(await estado(id), "FALHOU");
  });

  test("trava vencida vira incerta — e o 'aceita' atrasado ainda resolve", async () => {
    const [id] = await naFila(1);
    const agora = Date.now();
    await reivindicar("r1", 8, new Date(agora));
    assert.equal(await vencerTravas(new Date(agora + 3 * MIN)), 1);
    assert.equal(await estado(id), "INCERTA");

    await marcarResultado(id, "r1", { tipo: "aceita", idProvedor: "SIM-1" }, SIMULADOR, new Date());
    const m = await db.mensagemAoFornecedor.findUniqueOrThrow({ where: { id } });
    assert.equal(m.estado, "ACEITA_PELO_CANAL");
    assert.equal(m.idProvedor, "SIM-1");
    assert.equal(m.simulada, true);
  });

  test("conferência do canal: 'não encontrada' volta para a fila; 'aceita' resolve", async () => {
    const [um, dois] = await naFila(2);
    const agora = new Date();
    await reivindicar("r1", 8, agora);
    for (const id of [um, dois]) {
      await marcarResultado(id, "r1", { tipo: "incerta", erro: "?" }, SIMULADOR, agora);
    }
    await aplicarConsulta(um, "nao-encontrada", agora);
    await aplicarConsulta(dois, "aceita", agora);
    assert.equal(await estado(um), "NA_FILA");
    assert.equal(await estado(dois), "ACEITA_PELO_CANAL");
  });

  test("incerta decidida por pessoa exige permissão, e fica auditada", async () => {
    const [id] = await naFila(1);
    await reivindicar("r1", 8, new Date());
    await marcarResultado(id, "r1", { tipo: "incerta", erro: "?" }, SIMULADOR, new Date());

    const gerente = await c.ctx(c.gerenteCentro, c.centro);
    await assert.rejects(() => resolverIncerta(gerente, id, "reenviar"), SemPermissao);

    const comprador = await c.ctx(c.comprador, null);
    await resolverIncerta(comprador, id, "reenviar");
    assert.equal(await estado(id), "NA_FILA");
    const auditoria = await db.auditoria.count({
      where: { entidade: "MensagemAoFornecedor", entidadeId: id },
    });
    assert.equal(auditoria, 1);
  });
});

describe("o destino", () => {
  test("fornecedor sem autorização: bloqueada, e o painel diz por quê", async () => {
    await db.fornecedor.update({
      where: { id: c.fornecedores.b.id },
      data: { autorizadoMensagens: false },
    });
    const [id] = await naFila(1, c.fornecedores.b.id);
    assert.equal(await estado(id), "BLOQUEADA");

    const comprador = await c.ctx(c.comprador, null);
    const painel = await painelDeEnvios(comprador);
    const m = painel.mensagens.find((x) => x.id === id)!;
    assert.match(m.motivoBloqueio ?? "", /não autorizou/);
    assert.deepEqual(await reivindicar("r1", 8, new Date()), []);
  });

  test("telefone mudou com a mensagem na fila: ela NÃO segue sozinha", async () => {
    const [id] = await naFila(1);
    await db.fornecedor.update({
      where: { id: c.fornecedores.a.id },
      data: { telefonePedidos: "5500000000099" },
    });

    const comprador = await c.ctx(c.comprador, null);
    const antes = (await painelDeEnvios(comprador)).mensagens.find((m) => m.id === id)!;
    assert.equal(antes.destino, "5500000000001");
    assert.equal(antes.destinoMudou, true);

    await atualizarDestino(comprador, id);
    const depois = await db.mensagemAoFornecedor.findUniqueOrThrow({ where: { id } });
    assert.equal(depois.destino, "5500000000099");
    assert.equal(depois.estado, "NA_FILA");
  });

  test("teste só vai para o número de teste", async () => {
    const comprador = await c.ctx(c.comprador, null);
    await assert.rejects(() => enviarTeste(comprador, "oi"), /número de teste/);

    // Configurar o número de teste é do Diretor.
    await assert.rejects(
      () => definirDestinoDeTeste(comprador, "(84) 99999-0000"),
      SemPermissao,
    );
    const diretor = await c.ctx(c.diretor, null);
    await definirDestinoDeTeste(diretor, "(84) 99999-0000");

    const id = await enviarTeste(comprador, "oi");
    const m = await db.mensagemAoFornecedor.findUniqueOrThrow({ where: { id } });
    assert.equal(m.destino, "5584999990000");
    assert.equal(m.fornecedorId, null);
    assert.equal(m.ehTeste, true);
  });
});

describe("o canal", () => {
  test("pausado: o relógio não pega nada; despausado, pega", async () => {
    await naFila(2);
    const comprador = await c.ctx(c.comprador, null);
    await assert.rejects(() => pausarCanal(comprador, true, null), /por que/);
    await pausarCanal(comprador, true, "Número em manutenção");
    assert.deepEqual(await reivindicar("r1", 8, new Date()), []);
    await pausarCanal(comprador, false, null);
    assert.equal((await reivindicar("r1", 8, new Date())).length, 2);
  });

  test("enviada à mão cancela o que ia sair — o fornecedor não recebe duas vezes", async () => {
    const [id] = await naFila(1);
    const comprador = await c.ctx(c.comprador, null);
    await marcarEnviadaAMao(comprador, id);
    const m = await db.mensagemAoFornecedor.findUniqueOrThrow({ where: { id } });
    assert.equal(m.estado, "CANCELADA");
    assert.ok(m.enviadaAMaoEm);
    assert.deepEqual(await reivindicar("r1", 8, new Date()), []);
  });
});
