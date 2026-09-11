import assert from "node:assert/strict";
import { test } from "node:test";

import { ehModeloDeFechamento, linhasDoFechamento } from "./fato-de-fechamento";

/**
 * O FATO QUE O CHECKLISTS DECLARA à Severina: "um fechamento foi concluído".
 *
 * Quem sabe o que é um fechamento é o Checklists — a Severina só recebe as
 * linhas prontas e as põe no aviso. O fuso é o da loja, não o do servidor: o
 * fechamento das 23h41 não pode chegar ao gerente como "02h41".
 */

test("reconhece o modelo de fechamento pelo nome, sem ligar para maiúsculas", () => {
  assert.equal(ehModeloDeFechamento("Fechamento da Pizzaria"), true);
  assert.equal(ehModeloDeFechamento("FECHAMENTO"), true);
  assert.equal(ehModeloDeFechamento("Checklist de fechamentos"), true);
  assert.equal(ehModeloDeFechamento("Abertura da Pizzaria"), false);
  assert.equal(ehModeloDeFechamento("Limpeza semanal"), false);
});

test("as linhas do aviso, no fuso da loja", () => {
  assert.deepEqual(
    linhasDoFechamento({
      loja: "Loja Centro (ensaio)",
      modelo: "Fechamento da Pizzaria",
      fechadaEm: new Date("2026-09-11T02:41:00Z"),
      fuso: "America/Sao_Paulo",
      quem: "Ana Ensaio",
      pontuacao: 91.7,
      naoConformes: 2,
    }),
    [
      "Loja: Loja Centro (ensaio)",
      "Checklist: Fechamento da Pizzaria",
      "Concluído em 10/09 às 23:41 por Ana Ensaio",
      "Nota: 91,7% · 2 itens fora do padrão",
    ],
  );
});

test("tudo no padrão, e um item só no singular", () => {
  const base = {
    loja: "Loja Centro (ensaio)",
    modelo: "Fechamento",
    fechadaEm: new Date("2026-09-11T02:41:00Z"),
    fuso: "America/Sao_Paulo",
    quem: null,
  };
  assert.equal(
    linhasDoFechamento({ ...base, pontuacao: 100, naoConformes: 0 })[3],
    "Nota: 100% · tudo no padrão",
  );
  assert.equal(
    linhasDoFechamento({ ...base, pontuacao: 95, naoConformes: 1 })[3],
    "Nota: 95% · 1 item fora do padrão",
  );
  assert.equal(
    linhasDoFechamento({ ...base, pontuacao: 95, naoConformes: 1 })[2],
    "Concluído em 10/09 às 23:41",
  );
});

/** Checklist só de temperatura não tem nota — e inventar uma seria mentira. */
test("sem nota, diz que só há registros", () => {
  assert.equal(
    linhasDoFechamento({
      loja: "Loja Centro (ensaio)",
      modelo: "Fechamento",
      fechadaEm: new Date("2026-09-11T02:41:00Z"),
      fuso: "America/Sao_Paulo",
      quem: "Ana Ensaio",
      pontuacao: null,
      naoConformes: 0,
    })[3],
    "Sem nota (só registros)",
  );
});
