import assert from "node:assert/strict";
import { test } from "node:test";

import {
  codigoDeSaida,
  estadoDaVerificacao,
  mascararEmail,
  obterStatus,
  saidaFinal,
} from "./verificar.mjs";

// Fix round 2: a forma real de `auth.oauth` é `{ warnAfterMs, profiles }`,
// não uma lista — e cada perfil tem `status`/`remainingMs`, não `expired`.
const oauthOk = {
  auth: {
    oauth: {
      profiles: [
        {
          profileId: "openai:conta",
          provider: "openai",
          status: "ok",
          remainingMs: 999_999_999,
        },
      ],
    },
    unusableProfiles: [],
    modelRouteIssues: [],
  },
};

// O e-mail real do dono, para os testes que provam que ele nunca sai — nunca
// o e-mail de verdade, só um valor com a MESMA forma.
const EMAIL_FALSO = "dono@exemplo.com";

// Captura real de `openclaw models status --json` na VPS (Fix round 2), só
// com o e-mail trocado. `auth.oauth.profiles[].label`/`.profileId` e
// `auth.providers[].profiles.labels[]` são os três lugares que carregam o
// e-mail de verdade.
const statusReal = {
  defaultModel: "openai/gpt-5.6-sol",
  resolvedDefault: "openai/gpt-5.6-sol",
  fallbacks: [],
  utilityModel: { ref: "openai/gpt-5.6-luna", source: "provider-default" },
  auth: {
    storePath: "/home/node/.openclaw/state/openclaw.sqlite",
    shellEnvFallback: { enabled: false, appliedKeys: [] },
    providersWithOAuth: ["openai (1)"],
    missingProvidersInUse: [],
    modelRouteIssues: [],
    runtimeAuthRoutes: [
      {
        provider: "openai",
        runtime: "codex",
        authProvider: "openai",
        status: "usable",
        effective: {
          kind: "profiles",
          detail: "~/.openclaw/state/openclaw.sqlite",
        },
      },
    ],
    providers: [
      {
        provider: "openai",
        effective: {
          kind: "profiles",
          detail: "~/.openclaw/state/openclaw.sqlite",
        },
        profiles: {
          count: 1,
          oauth: 1,
          token: 0,
          apiKey: 0,
          labels: [`openai:${EMAIL_FALSO}=OAuth (${EMAIL_FALSO})`],
        },
      },
    ],
    unusableProfiles: [],
    oauth: {
      warnAfterMs: 86_400_000,
      profiles: [
        {
          profileId: `openai:${EMAIL_FALSO}`,
          provider: "openai",
          type: "oauth",
          status: "ok",
          expiresAt: 1_790_041_227_632,
          remainingMs: 825_383_970,
          source: "store",
          label: `openai:${EMAIL_FALSO} (${EMAIL_FALSO})`,
        },
      ],
    },
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
    estadoDaVerificacao(
      { auth: { oauth: { profiles: [] } } },
      { gatewayDePe: true },
    ).estado,
    "login_expirado",
  );
  assert.equal(
    estadoDaVerificacao({ auth: {} }, { gatewayDePe: true }).estado,
    "login_expirado",
  );
  const vencido = {
    auth: {
      oauth: {
        profiles: [
          {
            profileId: "openai:conta",
            provider: "openai",
            status: "expired",
            remainingMs: -1000,
          },
        ],
      },
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

test("Fix round 2 — a forma real de auth.oauth (profiles, não lista) é conectado, não login_expirado", () => {
  const r = estadoDaVerificacao(statusReal, { gatewayDePe: true });
  assert.equal(r.estado, "conectado");
  assert.notEqual(r.estado, "login_expirado");
});

test("Fix round 2 — a rota usável de auth.runtimeAuthRoutes aparece como runtime", () => {
  const r = estadoDaVerificacao(statusReal, { gatewayDePe: true });
  assert.equal(r.runtime, "codex");
});

test("Fix round 2 — sem auth.runtimeAuthRoutes ainda conecta, só sem nome de runtime", () => {
  const semRotas = { ...statusReal.auth, runtimeAuthRoutes: undefined };
  const r = estadoDaVerificacao({ auth: semRotas }, { gatewayDePe: true });
  assert.equal(r.estado, "conectado");
  assert.equal(r.runtime, null);
});

test("Fix round 2 — o e-mail de profileId, label e providers[].profiles.labels não aparece em lugar nenhum da saída", () => {
  const resultado = estadoDaVerificacao(statusReal, { gatewayDePe: true });

  // A função de decisão em si nunca copia profileId/label para o resultado.
  assert.ok(!JSON.stringify(resultado).includes(EMAIL_FALSO));

  // E a saída final, do jeito que principal() manda para a tela do Pablo
  // (resultado + modelo + versão + registro, depois da máscara), também não.
  const saida = saidaFinal(resultado, {
    modelo: statusReal.defaultModel,
    versao: "2026.9.4 (3a9d69d)",
    registro: { enviado: false, motivo: "registro desligado" },
  });
  const impresso = mascararEmail(JSON.stringify(saida, null, 2));
  assert.ok(!impresso.includes(EMAIL_FALSO));
  assert.ok(!impresso.includes("@"));
});
