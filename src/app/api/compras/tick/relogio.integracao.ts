import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { criarSimulador } from "@/connectors/fornecedores/simulador";
import { enfileirar } from "@/modules/compras/services/fila";
import { convidar, revogarLink } from "@/modules/compras/services/solicitacoes";
import {
  criarCenario,
  limparBanco,
  type Cenario,
} from "@/modules/compras/integracao/cenario";
import { rodadaEmCotacao } from "@/modules/compras/integracao/fluxo";
import { db } from "@/server/db";

import { rodarRelogio } from "./relogio";

/**
 * O relógio de ponta a ponta: fila de verdade, banco de verdade, canal
 * SIMULADO com roteiro. Nenhuma mensagem real sai daqui.
 */

process.env.APP_URL ||= "https://app.exemplo.test";

let c: Cenario;

beforeEach(async () => {
  await limparBanco();
  c = await criarCenario();
});

after(async () => {
  await db.$disconnect();
});

const MIN = 60_000;

async function naFila(quantas: number) {
  for (let i = 0; i < quantas; i++) {
    await db.$transaction((tx) =>
      enfileirar(tx, {
        organizacaoId: c.org.id,
        unidadeId: c.centro.id,
        fornecedorId: c.fornecedores.a.id,
        tipo: "PEDIDO",
        referenciaTipo: "Pedido",
        referenciaId: `pedido-${i}`,
        sequencia: 1,
        corpo: `Pedido de teste ${i}`,
        chave: `pedido:pedido-${i}:1`,
        criadoPorId: null,
      }),
    );
  }
}

describe("o relógio", () => {
  test("duas batidas ao mesmo tempo: cada mensagem sai uma vez só", async () => {
    await naFila(6);
    const canal = criarSimulador();
    await Promise.all([
      rodarRelogio(canal, { dono: "replica-a", intervaloMs: 0 }),
      rodarRelogio(canal, { dono: "replica-b", intervaloMs: 0 }),
    ]);
    const chaves = canal.saidas().map((s) => s.chave);
    assert.equal(chaves.length, 6);
    assert.equal(new Set(chaves).size, 6);
    const estados = await db.mensagemAoFornecedor.groupBy({
      by: ["estado"],
      _count: true,
    });
    assert.deepEqual(
      estados.map((e) => e.estado),
      ["ACEITA_PELO_CANAL"],
    );
    assert.ok(
      (await db.mensagemAoFornecedor.findMany()).every((m) => m.simulada),
    );
  });

  test("resposta perdida depois de enviar: não reenvia; o canal confirma na batida seguinte", async () => {
    await naFila(1);
    const canal = criarSimulador({ incertaNaChamada: 1 });

    const primeira = await rodarRelogio(canal, { dono: "r", intervaloMs: 0 });
    assert.equal(primeira.incertas, 1);
    assert.equal(
      (await db.mensagemAoFornecedor.findFirstOrThrow()).estado,
      "INCERTA",
    );

    const segunda = await rodarRelogio(canal, { dono: "r", intervaloMs: 0 });
    assert.equal(segunda.conferidas, 1);
    assert.equal(
      (await db.mensagemAoFornecedor.findFirstOrThrow()).estado,
      "ACEITA_PELO_CANAL",
    );
    assert.equal(
      canal.chamadas(),
      1,
      "a mensagem não pode ter sido mandada duas vezes",
    );
  });

  test("canal fora do ar: espera crescente, e sai na terceira tentativa", async () => {
    await naFila(1);
    const canal = criarSimulador({ falharVezes: 2 });
    const t0 = Date.now();

    await rodarRelogio(canal, {
      dono: "r",
      intervaloMs: 0,
      agora: new Date(t0),
    });
    // Antes do minuto de espera, nada acontece.
    await rodarRelogio(canal, {
      dono: "r",
      intervaloMs: 0,
      agora: new Date(t0 + 30_000),
    });
    assert.equal(canal.chamadas(), 1);

    await rodarRelogio(canal, {
      dono: "r",
      intervaloMs: 0,
      agora: new Date(t0 + 2 * MIN),
    });
    assert.equal(canal.chamadas(), 2);
    await rodarRelogio(canal, {
      dono: "r",
      intervaloMs: 0,
      agora: new Date(t0 + 10 * MIN),
    });
    assert.equal(canal.chamadas(), 3);

    const m = await db.mensagemAoFornecedor.findFirstOrThrow();
    assert.equal(m.estado, "ACEITA_PELO_CANAL");
    assert.equal(m.tentativas, 3);
  });

  test("o convite leva o link só no texto que sai", async () => {
    const r = await rodadaEmCotacao(c);
    await convidar(r.comprador, r.sol(c.fornecedores.a.id).id);
    const canal = criarSimulador();
    await rodarRelogio(canal, { dono: "r", intervaloMs: 0 });

    const [saida] = canal.saidas();
    assert.match(
      saida.texto,
      /https?:\/\/\S+\/fornecedor\/cotacao#[A-Za-z0-9_-]{43}/,
    );
    assert.doesNotMatch(saida.texto, /\{\{LINK\}\}/);
    const guardada = await db.mensagemAoFornecedor.findFirstOrThrow();
    assert.match(guardada.corpo, /\{\{LINK\}\}/);
  });

  test("link revogado antes de sair: o convite não sai", async () => {
    const r = await rodadaEmCotacao(c);
    const a = r.sol(c.fornecedores.a.id);
    await convidar(r.comprador, a.id);
    await revogarLink(r.comprador, a.id, "Mandei para o fornecedor errado");

    const canal = criarSimulador();
    await rodarRelogio(canal, { dono: "r", intervaloMs: 0 });
    assert.equal(canal.saidas().length, 0);
    assert.equal(
      (await db.mensagemAoFornecedor.findFirstOrThrow()).estado,
      "CANCELADA",
    );
  });
});
