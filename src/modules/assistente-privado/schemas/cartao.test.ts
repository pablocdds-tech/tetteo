import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMANDO_DE_LOGIN,
  montarCartao,
  type RegistroParaCartao,
} from "./cartao";

const AGORA = new Date("2026-09-11T18:00:00Z"); // 15:00 em São Paulo
const antes = (minutos: number) => new Date(AGORA.getTime() - minutos * 60_000);

function registro(dados: Partial<RegistroParaCartao> = {}): RegistroParaCartao {
  return {
    chave: "3f9a1c2e4b5d6e7f",
    estado: "concluido",
    demonstracao: false,
    periodoDe: null,
    periodoAte: null,
    fonte: null,
    pendencias: [],
    detalhe: null,
    proximaRotina: null,
    rotinaPausada: null,
    limiteAte: null,
    ocorridoEm: AGORA,
    ...dados,
  };
}

const cartao = (
  verificacao: RegistroParaCartao | null,
  execucoes: RegistroParaCartao[] = [],
) => montarCartao({ verificacao, execucoes, agora: AGORA });

test("nada ainda: diz isso, sem inventar", () => {
  const c = cartao(null);
  assert.equal(c.conexao.texto, "Nunca verificado");
  assert.equal(c.ultimaExecucao.texto, "Nenhuma execução ainda");
  assert.equal(c.proximaRotina.texto, "Nenhuma — só execução manual");
  assert.deepEqual(c.pendencias, []);
  assert.equal(c.demonstracao, false);
});

test("conectado, com a idade da verificação", () => {
  const c = cartao(
    registro({
      chave: "verificacao",
      estado: "conectado",
      ocorridoEm: antes(12),
    }),
  );
  assert.deepEqual(
    [c.conexao.texto, c.conexao.apoio, c.conexao.tom],
    ["Conectado", "verificado há 12 min", "ok"],
  );
});

test("verificação velha vira 'sem notícia'", () => {
  const c = cartao(
    registro({
      chave: "verificacao",
      estado: "conectado",
      ocorridoEm: antes(7 * 60),
    }),
  );
  assert.equal(c.conexao.texto, "Sem notícia desde 11/09 08:00");
  assert.equal(c.conexao.tom, "aviso");
});

test("login expirado mostra o comando e vira pendência", () => {
  const c = cartao(
    registro({
      chave: "verificacao",
      estado: "login_expirado",
      ocorridoEm: antes(1),
    }),
  );
  assert.deepEqual(
    [c.conexao.texto, c.conexao.apoio, c.conexao.tom],
    ["Login expirado — refazer", COMANDO_DE_LOGIN, "ruim"],
  );
  assert.ok(c.pendencias.includes("Refazer o login do ChatGPT na VPS"));
});

test("limite da assinatura, com o horário de volta", () => {
  const c = cartao(
    registro({
      chave: "verificacao",
      estado: "limite",
      ocorridoEm: antes(1),
      limiteAte: new Date("2026-09-11T21:00:00Z"),
    }),
  );
  assert.equal(c.conexao.texto, "Limite da assinatura até 18:00");
});

test("calculado há pouco é 'em andamento'; há muito, 'interrompido'", () => {
  const recente = cartao(null, [
    registro({ estado: "calculado", ocorridoEm: antes(2) }),
  ]);
  assert.deepEqual(
    [recente.ultimaExecucao.texto, recente.ultimaExecucao.tom],
    ["Em andamento", "info"],
  );
  const velho = cartao(null, [
    registro({ estado: "calculado", ocorridoEm: antes(20) }),
  ]);
  assert.deepEqual(
    [velho.ultimaExecucao.texto, velho.ultimaExecucao.tom],
    ["Interrompido", "aviso"],
  );
  assert.equal(
    velho.ultimaExecucao.apoio,
    "há 20 min — números salvos, texto não concluído",
  );
});

test("concluído mostra período, arquivo e quando", () => {
  const c = cartao(null, [
    registro({
      periodoDe: "2026-08-12",
      periodoAte: "2026-09-10",
      fonte: "vendas-30-dias.csv",
      ocorridoEm: antes(5),
      demonstracao: true,
    }),
  ]);
  assert.deepEqual(
    [c.ultimaExecucao.texto, c.ultimaExecucao.apoio, c.ultimaExecucao.tom],
    ["Concluído", "12/08 a 10/09 · vendas-30-dias.csv · há 5 min", "ok"],
  );
  assert.equal(c.demonstracao, true);
});

test("arquivo inválido e acesso negado trazem o motivo", () => {
  const invalido = cartao(null, [
    registro({
      estado: "arquivo_invalido",
      fonte: "vendas.csv",
      detalhe: "Linha 1: faltam colunas",
    }),
  ]);
  assert.equal(invalido.ultimaExecucao.texto, "Arquivo inválido");
  assert.equal(
    invalido.ultimaExecucao.apoio,
    "vendas.csv · agora há pouco — Linha 1: faltam colunas",
  );
  const negado = cartao(null, [
    registro({ estado: "acesso_negado", detalhe: "Pedido de outra loja." }),
  ]);
  assert.deepEqual(
    [negado.ultimaExecucao.texto, negado.ultimaExecucao.tom],
    ["Acesso negado", "ruim"],
  );
});

test("rascunho não conta como execução, mas vira pendência por 7 dias", () => {
  const c = cartao(null, [
    registro({
      chave: "rascunho:aaaaaaaaaaaaaaaa",
      estado: "preparado",
      ocorridoEm: antes(3),
      pendencias: ["Rascunho esperando decisão: Proposta de compra"],
    }),
    registro({
      chave: "rascunho:bbbbbbbbbbbbbbbb",
      estado: "preparado",
      ocorridoEm: antes(8 * 24 * 60),
      pendencias: ["Rascunho esperando decisão: Velho"],
    }),
    registro({ estado: "sem_dados", ocorridoEm: antes(10) }),
  ]);
  assert.equal(c.ultimaExecucao.texto, "Sem dados no período");
  assert.deepEqual(c.pendencias, [
    "Rascunho esperando decisão: Proposta de compra",
  ]);
});

test("próxima rotina: agendada ou pausada", () => {
  const agendada = cartao(
    registro({
      chave: "verificacao",
      estado: "conectado",
      ocorridoEm: antes(1),
      proximaRotina: new Date("2026-09-12T10:00:00Z"),
    }),
  );
  assert.equal(agendada.proximaRotina.texto, "12/09 07:00");
  const pausada = cartao(
    registro({
      chave: "verificacao",
      estado: "conectado",
      ocorridoEm: antes(1),
      proximaRotina: new Date("2026-09-12T10:00:00Z"),
      rotinaPausada: true,
    }),
  );
  assert.deepEqual(
    [pausada.proximaRotina.texto, pausada.proximaRotina.apoio],
    ["Pausada", "seria 12/09 07:00"],
  );
});
