import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classificarEdicoes,
  mesmaQuantidade,
  type ValorNoBanco,
} from "./edicao-de-contagem";

/**
 * Duas pessoas, uma folha. O que vale quando as duas salvam.
 */

const ANA = "usuario-ana";
const AS_10H05 = new Date("2026-09-10T13:05:00.000Z");

function banco(
  linhas: Record<string, number | null>,
  por: string | null = ANA,
): Map<string, ValorNoBanco> {
  return new Map(
    Object.entries(linhas).map(([insumoId, quantidade]) => [
      insumoId,
      {
        quantidade,
        contadoPorId: quantidade === null ? null : por,
        contadoEm: quantidade === null ? null : AS_10H05,
      },
    ]),
  );
}

test("campo que eu não mexi NUNCA é gravado — é isso que protege a contagem da Ana", () => {
  // Abri a folha com a mussarela em branco. A Ana contou 12 kg e salvou.
  // Eu salvo a minha folha sem ter tocado nesse campo.
  const { gravar, conflitos } = classificarEdicoes(
    [{ insumoId: "mussarela", valor: null, base: null }],
    banco({ mussarela: 12 }),
  );

  assert.deepEqual(gravar, []);
  assert.deepEqual(conflitos, []);
});

test("mexi, e ninguém mudou nada desde que a folha abriu: grava", () => {
  const { gravar, conflitos } = classificarEdicoes(
    [{ insumoId: "farinha", valor: 175, base: null }],
    banco({ farinha: null }),
  );

  assert.deepEqual(gravar, [{ insumoId: "farinha", valor: 175, base: null }]);
  assert.deepEqual(conflitos, []);
});

test("mexi, mas a Ana gravou outro número nesse meio tempo: conflito, e NÃO grava", () => {
  const { gravar, conflitos } = classificarEdicoes(
    [{ insumoId: "mussarela", valor: 8, base: null }],
    banco({ mussarela: 12 }),
  );

  assert.deepEqual(gravar, []);
  assert.deepEqual(conflitos, [
    {
      insumoId: "mussarela",
      tentado: 8,
      noBanco: 12,
      contadoPorId: ANA,
      contadoEm: AS_10H05,
    },
  ]);
});

test("as duas pessoas chegaram ao mesmo número: não é conflito, e não reescreve", () => {
  const { gravar, conflitos } = classificarEdicoes(
    [{ insumoId: "mussarela", valor: 12, base: null }],
    banco({ mussarela: 12 }),
  );

  assert.deepEqual(gravar, []);
  assert.deepEqual(conflitos, []);
});

test("apagar a minha própria contagem é permitido — em branco é uma decisão válida", () => {
  const { gravar, conflitos } = classificarEdicoes(
    [{ insumoId: "oregano", valor: null, base: 2.4 }],
    banco({ oregano: 2.4 }),
  );

  assert.deepEqual(gravar, [{ insumoId: "oregano", valor: null, base: 2.4 }]);
  assert.deepEqual(conflitos, []);
});

test("apagar um campo que outra pessoa corrigiu depois é conflito", () => {
  const { gravar, conflitos } = classificarEdicoes(
    [{ insumoId: "oregano", valor: null, base: 2.4 }],
    banco({ oregano: 3 }),
  );

  assert.deepEqual(gravar, []);
  assert.equal(conflitos.length, 1);
  assert.equal(conflitos[0].tentado, null);
  assert.equal(conflitos[0].noBanco, 3);
});

test("uma folha com as três situações separa cada linha no seu lugar", () => {
  const { gravar, conflitos } = classificarEdicoes(
    [
      { insumoId: "mussarela", valor: null, base: null }, // não mexi
      { insumoId: "farinha", valor: 175, base: 150 }, // mexi, banco igual
      { insumoId: "calabresa", valor: 3, base: null }, // mexi, banco mudou
    ],
    banco({ mussarela: 12, farinha: 150, calabresa: 3.5 }),
  );

  assert.deepEqual(
    gravar.map((g) => g.insumoId),
    ["farinha"],
  );
  assert.deepEqual(
    conflitos.map((c) => c.insumoId),
    ["calabresa"],
  );
});

test("insumo que não é desta contagem é ignorado", () => {
  const { gravar, conflitos } = classificarEdicoes(
    [{ insumoId: "intruso", valor: 5, base: null }],
    banco({ mussarela: null }),
  );

  assert.deepEqual(gravar, []);
  assert.deepEqual(conflitos, []);
});

test("12,5 e 12,500 são o mesmo número — a coluna guarda três casas", () => {
  assert.equal(mesmaQuantidade(12.5, 12.5), true);
  assert.equal(mesmaQuantidade(12.5, 12.5004), true);
  assert.equal(mesmaQuantidade(12.5, 12.501), false);
});

test("em branco não é zero, nem aqui", () => {
  // "Acabou" e "não contei" são fatos diferentes. Se a regra os confundisse,
  // apagar um "0" legítimo passaria sem conflito.
  assert.equal(mesmaQuantidade(null, 0), false);
  assert.equal(mesmaQuantidade(0, null), false);
  assert.equal(mesmaQuantidade(null, null), true);
  assert.equal(mesmaQuantidade(0, 0), true);
});
