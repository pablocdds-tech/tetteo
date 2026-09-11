import assert from "node:assert/strict";
import { test } from "node:test";

import { corpoDoRegistro } from "./registro";

const execucao = {
  tipo: "execucao",
  chave: "3f9a1c2e4b5d6e7f",
  estado: "concluido",
  ocorridoEm: "2026-09-11T15:00:00.000Z",
  demonstracao: true,
  periodo: { de: "2026-08-12", ate: "2026-09-10" },
  fonte: "vendas-30-dias.csv",
  indicadores: {
    totalCentavos: 4823050,
    pedidos: 1204,
    ticketCentavos: 4006,
    diasComVenda: 29,
    diasNoPeriodo: 30,
    ultimaData: "2026-09-10",
    desatualizado: false,
  },
  avisos: [],
  pendencias: [],
};

test("aceita o que a ferramenta manda", () => {
  assert.equal(corpoDoRegistro.safeParse(execucao).success, true);
});

test("aceita a verificação de conexão", () => {
  const r = corpoDoRegistro.safeParse({
    tipo: "verificacao",
    chave: "verificacao",
    estado: "conectado",
    ocorridoEm: "2026-09-11T15:00:00Z",
    versaoOpenclaw: "2026.9.4",
    modelo: "openai/gpt-5.6-sol",
  });
  assert.equal(r.success, true);
});

test("recusa campo a mais: não cabe um pedido escondido no recado", () => {
  assert.equal(
    corpoDoRegistro.safeParse({ ...execucao, pedido: { itens: [] } }).success,
    false,
  );
  assert.equal(
    corpoDoRegistro.safeParse({
      tipo: "verificacao",
      chave: "verificacao",
      estado: "conectado",
      ocorridoEm: "2026-09-11T15:00:00Z",
      pedido: { itens: [] },
    }).success,
    false,
  );
});

test("recusa estado que não existe, chave estranha e fonte com caminho", () => {
  assert.equal(
    corpoDoRegistro.safeParse({ ...execucao, estado: "executado" }).success,
    false,
  );
  assert.equal(
    corpoDoRegistro.safeParse({ ...execucao, chave: "../../x" }).success,
    false,
  );
  assert.equal(
    corpoDoRegistro.safeParse({ ...execucao, fonte: "/etc/passwd" }).success,
    false,
  );
});

test("ticket pode ser nulo; pedidos não pode ser negativo", () => {
  const semTicket = {
    ...execucao,
    indicadores: { ...execucao.indicadores, ticketCentavos: null, pedidos: 0 },
  };
  assert.equal(corpoDoRegistro.safeParse(semTicket).success, true);
  const negativo = {
    ...execucao,
    indicadores: { ...execucao.indicadores, pedidos: -1 },
  };
  assert.equal(corpoDoRegistro.safeParse(negativo).success, false);
});

test("data e hora precisa ser data e hora", () => {
  assert.equal(
    corpoDoRegistro.safeParse({ ...execucao, ocorridoEm: "ontem" }).success,
    false,
  );
  assert.equal(
    corpoDoRegistro.safeParse({
      ...execucao,
      ocorridoEm: "2026-02-31T10:00:00Z",
    }).success,
    false,
  );
});

test("período e última data precisam ser dias que existem", () => {
  const periodoImpossivel = {
    ...execucao,
    periodo: { de: "2026-13-45", ate: "2026-01-01" },
  };
  assert.equal(corpoDoRegistro.safeParse(periodoImpossivel).success, false);
  const ultimaImpossivel = {
    ...execucao,
    indicadores: { ...execucao.indicadores, ultimaData: "2026-02-30" },
  };
  assert.equal(corpoDoRegistro.safeParse(ultimaImpossivel).success, false);
  // 2026 não é bissexto; 2024 é.
  assert.equal(
    corpoDoRegistro.safeParse({
      ...execucao,
      periodo: { de: "2026-02-29", ate: "2026-03-01" },
    }).success,
    false,
  );
  assert.equal(
    corpoDoRegistro.safeParse({
      ...execucao,
      periodo: { de: "2024-02-29", ate: "2024-03-01" },
    }).success,
    true,
  );
});
