import assert from "node:assert/strict";
import { test } from "node:test";

import {
  codigoDeSaida,
  estadoDaVerificacao,
  mascararEmail,
  obterStatus,
} from "./verificar.mjs";

const oauthOk = {
  auth: {
    oauth: [{ profileId: "openai:conta", provider: "openai", expired: false }],
    unusableProfiles: [],
    modelRouteIssues: [],
  },
};

test("gateway fora do ar é desligado, antes de tudo", () => {
  assert.equal(
    estadoDaVerificacao(oauthOk, { gatewayDePe: false }).estado,
    "desligado",
  );
});

test("login OAuth válido e sem problema de rota é conectado", () => {
  assert.equal(
    estadoDaVerificacao(oauthOk, { gatewayDePe: true }).estado,
    "conectado",
  );
});

test("sem login da OpenAI, ou login vencido, é login_expirado", () => {
  assert.equal(
    estadoDaVerificacao({ auth: { oauth: [] } }, { gatewayDePe: true }).estado,
    "login_expirado",
  );
  const vencido = {
    auth: {
      oauth: [{ profileId: "openai:conta", provider: "openai", expired: true }],
    },
  };
  assert.equal(
    estadoDaVerificacao(vencido, { gatewayDePe: true }).estado,
    "login_expirado",
  );
});

test("perfil em espera por limite de uso é limite, com o horário", () => {
  const limite = {
    auth: {
      ...oauthOk.auth,
      unusableProfiles: [
        {
          profileId: "openai:conta",
          provider: "openai",
          reason: "rate_limit",
          cooldownUntil: 1789412400000,
        },
      ],
    },
  };
  const r = estadoDaVerificacao(limite, { gatewayDePe: true });
  assert.equal(r.estado, "limite");
  assert.equal(r.limiteAte, new Date(1789412400000).toISOString());
});

test("problema na rota do modelo é modelo_indisponivel", () => {
  const rota = {
    auth: {
      ...oauthOk.auth,
      modelRouteIssues: [{ message: "runtime indisponível" }],
    },
  };
  assert.equal(
    estadoDaVerificacao(rota, { gatewayDePe: true }).estado,
    "modelo_indisponivel",
  );
});

test("mascararEmail troca o e-mail por um marcador, nunca o mostra", () => {
  const linha =
    "Profiles: openai/oauth (pablocdds@gmail.com) — 0 api-key, Shell env: off";
  const mascarada = mascararEmail(linha);
  assert.ok(!mascarada.includes("pablocdds@gmail.com"));
  assert.ok(!mascarada.includes("@"));
  assert.match(mascarada, /\[e-mail oculto\]/);
});

test("falha ao RODAR a verificação não pode virar login_expirado (é desligado)", () => {
  const r = estadoDaVerificacao(
    {},
    {
      gatewayDePe: true,
      erroDeExecucao:
        "O comando de verificação (models status --json) não rodou: o executável não foi encontrado.",
    },
  );
  assert.equal(r.estado, "desligado");
  assert.notEqual(r.estado, "login_expirado");
  assert.match(r.detalhe, /comando de verifica/i);
});

test("mensagem de rota com e-mail embutido não vaza no detalhe", () => {
  const rota = {
    auth: {
      ...oauthOk.auth,
      modelRouteIssues: [
        {
          message:
            "runtime indisponível para o perfil pablocdds@gmail.com (openai)",
        },
      ],
    },
  };
  const r = estadoDaVerificacao(rota, { gatewayDePe: true });
  assert.equal(r.estado, "modelo_indisponivel");
  assert.ok(!r.detalhe.includes("pablocdds@gmail.com"));
  assert.ok(!r.detalhe.includes("@"));
});

test("obterStatus: comando que lança (CLI ausente, corrompido etc.) vira desligado, nunca login_expirado", async () => {
  const erroDeExecucao = new Error("spawn node ENOENT");
  erroDeExecucao.code = "ENOENT";
  const { status, erroDeExecucao: motivo } = await obterStatus(async () => {
    throw erroDeExecucao;
  });
  assert.equal(status, null);
  assert.match(motivo, /comando de verifica/i);
  assert.doesNotMatch(motivo, /login/i);

  const r = estadoDaVerificacao(status ?? {}, {
    gatewayDePe: true,
    erroDeExecucao: motivo,
  });
  assert.equal(r.estado, "desligado");
  assert.notEqual(r.estado, "login_expirado");
  assert.match(r.detalhe, /comando de verifica/i);
});

test("obterStatus: saída que não é JSON válido também vira desligado, nunca login_expirado", async () => {
  const { status, erroDeExecucao: motivo } = await obterStatus(async () => ({
    stdout: "isto não é JSON {",
  }));
  assert.equal(status, null);
  assert.match(motivo, /comando de verifica/i);
  assert.doesNotMatch(motivo, /login/i);

  const r = estadoDaVerificacao(status ?? {}, {
    gatewayDePe: true,
    erroDeExecucao: motivo,
  });
  assert.equal(r.estado, "desligado");
  assert.notEqual(r.estado, "login_expirado");
  assert.match(r.detalhe, /comando de verifica/i);
});

test("obterStatus: e-mail que vazasse na mensagem de erro do comando não sobrevive ao detalhe", async () => {
  const erroComEmail = new Error(
    "Command failed: falha para o perfil pablocdds@gmail.com",
  );
  const { erroDeExecucao: motivo } = await obterStatus(async () => {
    throw erroComEmail;
  });
  const r = estadoDaVerificacao(
    {},
    { gatewayDePe: true, erroDeExecucao: motivo },
  );
  assert.ok(!r.detalhe.includes("pablocdds@gmail.com"));
  assert.ok(!r.detalhe.includes("@"));
});

test("obterStatus: status válido passa direto, sem erroDeExecucao", async () => {
  const { status, erroDeExecucao } = await obterStatus(async () => ({
    stdout: JSON.stringify(oauthOk),
  }));
  assert.deepEqual(status, oauthOk);
  assert.equal(erroDeExecucao, null);
});

test("codigoDeSaida: 0 só para conectado, 1 para qualquer outro estado", () => {
  assert.equal(codigoDeSaida("conectado"), 0);
  for (const estado of [
    "login_expirado",
    "limite",
    "modelo_indisponivel",
    "desligado",
  ]) {
    assert.equal(codigoDeSaida(estado), 1, estado);
  }
});
