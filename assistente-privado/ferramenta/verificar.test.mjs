import assert from "node:assert/strict";
import { test } from "node:test";

import { estadoDaVerificacao, mascararEmail } from "./verificar.mjs";

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
