import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  conferir,
  type Informado,
  type LinhaParaConferir,
} from "./recebimento";

// Molho em caixa de 12 × 900 g (10,8 kg) a R$ 95,40; pedido de 2 caixas.
const molho: LinhaParaConferir = {
  itemDePedidoId: "molho",
  insumoId: "insumo-molho",
  nome: "Molho de tomate",
  unidade: "KG",
  fator: 108_000n,
  fracionavel: false,
  pedido: 21_600n,
  recebidoAntes: 0n,
  precoEmbalagem: 9540n,
};
// Mussarela a granel, R$ 32 o kg; pedido de 10 kg.
const mussarela: LinhaParaConferir = {
  itemDePedidoId: "mussarela",
  insumoId: "insumo-mussarela",
  nome: "Mussarela",
  unidade: "KG",
  fator: 10_000n,
  fracionavel: true,
  pedido: 10_000n,
  recebidoAntes: 0n,
  precoEmbalagem: 3200n,
};

const inf = (
  itemDePedidoId: string,
  boas: bigint,
  resto: Partial<Informado> = {},
): Informado => ({
  itemDePedidoId,
  boas,
  avariadas: 0n,
  decisaoExcedente: null,
  substitutoInsumoId: null,
  decisaoSubstituicao: null,
  lote: null,
  validade: null,
  observacao: null,
  fotoIds: [],
  ...resto,
});

describe("conferência do recebimento", () => {
  test("parcial: entra o que chegou, convertido pelo fator; o resto fica pendente", () => {
    const r = conferir(
      [molho, mussarela],
      [inf("molho", 1000n), inf("mussarela", 6500n)],
    );
    assert.ok(r.ok);
    const m = r.entradas.find((e) => e.itemDePedidoId === "molho")!;
    assert.equal(m.quantidadeBoa, 10_800n); // 1 caixa = 10,8 kg
    assert.equal(m.valorTotal, 9540n);
    assert.equal(
      r.entradas.find((e) => e.itemDePedidoId === "mussarela")!.valorTotal,
      20_800n,
    );
    assert.equal(r.completo, false);
    assert.deepEqual(r.divergencias, []);
  });

  test("tudo recebido: completo", () => {
    const r = conferir(
      [molho, mussarela],
      [inf("molho", 2000n), inf("mussarela", 10_000n)],
    );
    assert.ok(r.ok && r.completo);
  });

  test("o que já tinha chegado conta para completar", () => {
    const r = conferir(
      [{ ...molho, recebidoAntes: 10_800n }],
      [inf("molho", 1000n)],
    );
    assert.ok(r.ok && r.completo);
  });

  test("excedente sem decisão não passa", () => {
    const r = conferir([molho], [inf("molho", 3000n)]);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.erros[0].mensagem : "", /10,8 kg a mais/);
  });

  test("excedente aceito entra inteiro e abre divergência com o valor", () => {
    const r = conferir(
      [molho],
      [inf("molho", 3000n, { decisaoExcedente: "ACEITAR" })],
    );
    assert.ok(r.ok);
    assert.equal(r.entradas[0].quantidadeBoa, 32_400n);
    assert.equal(r.divergencias[0].tipo, "EXCEDENTE");
    assert.equal(r.divergencias[0].impacto, 9540n);
  });

  test("excedente recusado: só o pedido entra; o resto volta na porta", () => {
    const r = conferir(
      [molho],
      [inf("molho", 3000n, { decisaoExcedente: "RECUSAR" })],
    );
    assert.ok(r.ok);
    assert.equal(r.entradas[0].quantidadeBoa, 21_600n);
    assert.equal(r.entradas[0].quantidadeRecusada, 10_800n);
    assert.equal(r.completo, true);
  });

  test("avariado não entra no estoque, e não cumpre o pedido", () => {
    const r = conferir([molho], [inf("molho", 1000n, { avariadas: 1000n })]);
    assert.ok(r.ok);
    assert.equal(r.entradas[0].quantidadeBoa, 10_800n);
    assert.equal(r.entradas[0].quantidadeAvariada, 10_800n);
    assert.equal(r.completo, false);
    assert.equal(r.divergencias[0].tipo, "AVARIA");
    assert.equal(r.divergencias[0].impacto, 9540n);
  });

  test("substituição sem decisão não passa; aceita, entra como o que veio", () => {
    const sem = conferir(
      [molho],
      [inf("molho", 2000n, { substitutoInsumoId: "outro" })],
    );
    assert.equal(sem.ok, false);

    const aceita = conferir(
      [molho],
      [
        inf("molho", 2000n, {
          substitutoInsumoId: "outro",
          decisaoSubstituicao: "ACEITAR",
        }),
      ],
    );
    assert.ok(aceita.ok);
    assert.equal(aceita.entradas[0].insumoId, "outro");
    assert.equal(aceita.divergencias[0].tipo, "SUBSTITUICAO");

    const recusada = conferir(
      [molho],
      [
        inf("molho", 2000n, {
          substitutoInsumoId: "outro",
          decisaoSubstituicao: "RECUSAR",
        }),
      ],
    );
    assert.ok(recusada.ok);
    assert.equal(recusada.entradas[0].quantidadeBoa, 0n);
    assert.equal(recusada.completo, false);
  });

  test("item de outro pedido é recusado; conferência vazia também", () => {
    assert.equal(conferir([molho], [inf("intruso", 1000n)]).ok, false);
    assert.equal(conferir([molho], [inf("molho", 0n)]).ok, false);
  });
});
