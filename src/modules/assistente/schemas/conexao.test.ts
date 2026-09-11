import assert from "node:assert/strict";
import { test } from "node:test";

import {
  consultaDoEventoDeConexao,
  estadoParaExibir,
  estadoPelaConsulta,
  MOTIVO_CONECTANDO_DEMAIS,
} from "./conexao";

/**
 * A queda de um número por QR Code não avisa: a Evolution reconecta calada, e
 * quando não consegue, fica "conectando" para sempre. Estas regras são o que
 * transforma esse silêncio em um "Atenção" na tela, antes de alguém reclamar
 * que o aviso não chegou.
 */

const AGORA = new Date("2026-09-10T20:00:00-03:00");
const minutosAntes = (m: number) => new Date(AGORA.getTime() - m * 60_000);

test("conectou: vira Conectado a partir de agora", () => {
  const r = estadoPelaConsulta(
    { tipo: "ok", estado: "CONECTADO" },
    {
      estado: "DESCONECTADO",
      estadoDesde: minutosAntes(30),
      motivoAtencao: null,
    },
    AGORA,
  );
  assert.deepEqual(r, {
    estado: "CONECTADO",
    estadoDesde: AGORA,
    motivoAtencao: null,
  });
});

test("continua conectado: o 'desde' não muda", () => {
  const r = estadoPelaConsulta(
    { tipo: "ok", estado: "CONECTADO" },
    { estado: "CONECTADO", estadoDesde: minutosAntes(90), motivoAtencao: null },
    AGORA,
  );
  assert.deepEqual(r.estadoDesde, minutosAntes(90));
});

test("provedor que não responde ou recusa a chave vira Atenção, com o motivo", () => {
  const r = estadoPelaConsulta(
    { tipo: "erro", motivo: "A Evolution não respondeu em 4 s." },
    { estado: "CONECTADO", estadoDesde: minutosAntes(90), motivoAtencao: null },
    AGORA,
  );
  assert.equal(r.estado, "ATENCAO");
  assert.equal(r.motivoAtencao, "A Evolution não respondeu em 4 s.");
});

test("conectando há mais de 5 minutos vira Atenção — e lembra desde quando", () => {
  const r = estadoPelaConsulta(
    { tipo: "ok", estado: "CONECTANDO" },
    { estado: "CONECTANDO", estadoDesde: minutosAntes(6), motivoAtencao: null },
    AGORA,
  );
  assert.deepEqual(r, {
    estado: "ATENCAO",
    estadoDesde: minutosAntes(6),
    motivoAtencao: MOTIVO_CONECTANDO_DEMAIS,
  });

  // Continua conectando: continua Atenção, e o relógio não zera.
  const depois = estadoPelaConsulta(
    { tipo: "ok", estado: "CONECTANDO" },
    r,
    AGORA,
  );
  assert.deepEqual(depois.estadoDesde, minutosAntes(6));
  assert.equal(depois.estado, "ATENCAO");
});

test("conectando há pouco é só Conectando", () => {
  const r = estadoPelaConsulta(
    { tipo: "ok", estado: "CONECTANDO" },
    {
      estado: "DESCONECTADO",
      estadoDesde: minutosAntes(60),
      motivoAtencao: null,
    },
    AGORA,
  );
  assert.deepEqual(r, {
    estado: "CONECTANDO",
    estadoDesde: AGORA,
    motivoAtencao: null,
  });
});

test("o evento de conexão da 2.3.7 vira a mesma consulta", () => {
  assert.deepEqual(consultaDoEventoDeConexao("open"), {
    tipo: "ok",
    estado: "CONECTADO",
  });
  assert.deepEqual(consultaDoEventoDeConexao("connecting"), {
    tipo: "ok",
    estado: "CONECTANDO",
  });
  assert.deepEqual(consultaDoEventoDeConexao("close"), {
    tipo: "ok",
    estado: "DESCONECTADO",
  });
  const recusado = consultaDoEventoDeConexao("refused");
  assert.equal(recusado.tipo, "erro");
});

test("falta de configuração aparece antes de qualquer estado gravado", () => {
  const r = estadoParaExibir(
    { estado: "CONECTADO", vistoEm: AGORA, motivoAtencao: null },
    ["EVOLUTION_API_KEY"],
    AGORA,
  );
  assert.deepEqual(r, {
    estado: "PENDENTE",
    motivo: "Falta configurar no servidor: EVOLUTION_API_KEY.",
  });
});

test("conectado, mas sem notícia há mais de 15 minutos, é Atenção", () => {
  const r = estadoParaExibir(
    { estado: "CONECTADO", vistoEm: minutosAntes(20), motivoAtencao: null },
    [],
    AGORA,
  );
  assert.equal(r.estado, "ATENCAO");
  const recente = estadoParaExibir(
    { estado: "CONECTADO", vistoEm: minutosAntes(2), motivoAtencao: null },
    [],
    AGORA,
  );
  assert.deepEqual(recente, { estado: "CONECTADO", motivo: null });
});
