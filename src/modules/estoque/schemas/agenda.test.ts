import assert from "node:assert/strict";
import { test } from "node:test";

import {
  prazoAtual,
  proximaCobranca,
  statusDaRotina,
  type Agenda,
} from "./agenda";

/**
 * Datas são onde os bugs se escondem: virada de semana, virada de mês,
 * fevereiro. Cada caso abaixo é um dia em que a tela diria a coisa errada —
 * e uma rotina marcada "em dia" quando está atrasada é uma contagem que
 * ninguém faz.
 */

const diaria: Agenda = {
  recorrencia: "DIARIA",
  diaDaSemana: null,
  diaDoMes: null,
};
const semanalSegunda: Agenda = {
  recorrencia: "SEMANAL",
  diaDaSemana: 1,
  diaDoMes: null,
};
const mensalDia1: Agenda = {
  recorrencia: "MENSAL",
  diaDaSemana: null,
  diaDoMes: 1,
};

// 2026-08-04 é uma terça-feira.
const terca = new Date(2026, 7, 4, 14, 30);
const segunda = new Date(2026, 7, 3);

test("diária: sem contagem hoje é 'aguardando', nunca 'atrasada'", () => {
  assert.equal(statusDaRotina(diaria, null, terca), "aguardando");
  assert.equal(
    statusDaRotina(diaria, new Date(2026, 7, 3, 19), terca),
    "aguardando",
  );
});

test("diária: fechada hoje é 'feita', e a próxima é amanhã", () => {
  const fechadaHoje = new Date(2026, 7, 4, 7, 20);
  assert.equal(statusDaRotina(diaria, fechadaHoje, terca), "feita");
  assert.deepEqual(
    proximaCobranca(diaria, fechadaHoje, terca),
    new Date(2026, 7, 5),
  );
});

test("semanal de segunda, hoje terça: feita ontem conta como 'feita'", () => {
  assert.deepEqual(prazoAtual(semanalSegunda, terca), new Date(2026, 7, 3));
  assert.equal(
    statusDaRotina(semanalSegunda, new Date(2026, 7, 3, 8), terca),
    "feita",
  );
});

test("semanal de segunda, hoje terça: última há duas semanas é 'atrasada'", () => {
  assert.equal(
    statusDaRotina(semanalSegunda, new Date(2026, 6, 20), terca),
    "atrasada",
  );
});

test("semanal no próprio dia: é 'aguardando', não 'atrasada'", () => {
  assert.equal(
    statusDaRotina(semanalSegunda, new Date(2026, 6, 27), segunda),
    "aguardando",
  );
});

test("semanal: o prazo pode cair na semana anterior, cruzando o mês", () => {
  // Sábado 1º de agosto: a segunda vigente é 27 de julho.
  const sabado = new Date(2026, 7, 1);
  assert.deepEqual(prazoAtual(semanalSegunda, sabado), new Date(2026, 6, 27));
});

test("mensal dia 1º: em 4 de agosto sem contagem de agosto é 'atrasada'", () => {
  assert.equal(
    statusDaRotina(mensalDia1, new Date(2026, 6, 1), terca),
    "atrasada",
  );
  assert.equal(
    statusDaRotina(mensalDia1, new Date(2026, 7, 1), terca),
    "feita",
  );
});

test("mensal: antes do dia no mês, o prazo vigente é o do mês passado", () => {
  const mensalDia15: Agenda = {
    recorrencia: "MENSAL",
    diaDaSemana: null,
    diaDoMes: 15,
  };
  assert.deepEqual(prazoAtual(mensalDia15, terca), new Date(2026, 6, 15));
});

test("mensal 'feita': a próxima é no mês seguinte", () => {
  assert.deepEqual(
    proximaCobranca(mensalDia1, new Date(2026, 7, 1), terca),
    new Date(2026, 8, 1),
  );
});

test("dia do mês acima de 28 é travado em 28 — fevereiro existe", () => {
  const mensalDia31: Agenda = {
    recorrencia: "MENSAL",
    diaDaSemana: null,
    diaDoMes: 31,
  };
  const marco = new Date(2026, 2, 3);
  assert.deepEqual(prazoAtual(mensalDia31, marco), new Date(2026, 1, 28));
});
