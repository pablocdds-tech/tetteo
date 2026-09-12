#!/usr/bin/env node
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { enviarRegistro } from "./registro.mjs";

/**
 * A VERIFICAÇÃO DA CONEXÃO — o que alimenta a linha "Conexão" do cartão.
 *
 * Roda DENTRO do container: pergunta ao próprio OpenClaw o estado do login e
 * do modelo, lê só nomes, estados e horários — nunca token, nunca e-mail — e
 * manda um registro "verificacao" ao Tetteo. Não gasta franquia: não chama
 * o modelo.
 *
 * Tudo que sai por stdout passa pela máscara de e-mail antes de imprimir: se
 * o CLI um dia devolver o perfil OAuth com o e-mail do dono num campo de
 * texto, ele não aparece aqui mesmo assim.
 */

const CLI = "/app/dist/index.js";
const executar = promisify(execFile);

const ehOpenai = (p) =>
  String(p?.provider ?? p?.profileId ?? p?.id ?? "").startsWith("openai");
const lista = (x) => (Array.isArray(x) ? x : []);
const paraIso = (v) => {
  const d = typeof v === "number" ? new Date(v) : v ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Troca todo e-mail por um marcador. Usar antes de logar ou imprimir. */
export function mascararEmail(texto) {
  return String(texto ?? "").replace(RE_EMAIL, "[e-mail oculto]");
}

export function estadoDaVerificacao(status, { gatewayDePe }) {
  if (!gatewayDePe) {
    return {
      estado: "desligado",
      detalhe: "O gateway não respondeu em 127.0.0.1:18789.",
    };
  }
  const auth = status?.auth ?? {};

  const bloqueado = lista(auth.unusableProfiles).find(ehOpenai);
  if (bloqueado) {
    const motivo = String(
      bloqueado.reason ?? bloqueado.disabledReason ?? "",
    ).toLowerCase();
    if (/rate|limit|usage|quota/.test(motivo)) {
      return {
        estado: "limite",
        limiteAte: paraIso(bloqueado.cooldownUntil ?? bloqueado.until),
      };
    }
    if (/auth|expired|revoked|invalid/.test(motivo))
      return { estado: "login_expirado" };
  }

  const oauth = lista(auth.oauth).filter(ehOpenai);
  if (oauth.length === 0)
    return {
      estado: "login_expirado",
      detalhe: "Nenhum login da OpenAI encontrado.",
    };
  if (oauth.every((p) => p.expired === true || p.status === "expired"))
    return { estado: "login_expirado" };

  const rota = lista(auth.modelRouteIssues)[0];
  if (rota) {
    return {
      estado: "modelo_indisponivel",
      detalhe: mascararEmail(
        String(
          rota.message ?? rota.reason ?? "rota do modelo com problema",
        ).slice(0, 300),
      ),
    };
  }
  return { estado: "conectado" };
}

async function principal() {
  const valor = (nome) => {
    const v = process.env[nome];
    return v && !v.startsWith("${") ? v : "";
  };
  const gatewayDePe = await fetch("http://127.0.0.1:18789/healthz", {
    signal: AbortSignal.timeout(5_000),
  })
    .then((r) => r.ok)
    .catch(() => false);

  let status = null;
  try {
    const { stdout } = await executar(
      process.execPath,
      [CLI, "models", "status", "--json"],
      {
        cwd: "/app",
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    status = JSON.parse(stdout);
  } catch {
    status = null;
  }
  const versao = await executar(process.execPath, [CLI, "--version"], {
    cwd: "/app",
    timeout: 30_000,
  })
    .then(({ stdout }) => stdout.trim().split(/\s+/).at(-1))
    .catch(() => null);

  const resultado = estadoDaVerificacao(status ?? {}, { gatewayDePe });
  const modelo =
    status?.defaultModel ??
    status?.model?.primary ??
    status?.resolved?.primary ??
    null;
  const registro = await enviarRegistro({
    url: valor("TETTEO_REGISTRO_URL"),
    segredo: valor("TETTEO_REGISTRO_SEGREDO"),
    corpo: {
      tipo: "verificacao",
      chave: "verificacao",
      estado: resultado.estado,
      ocorridoEm: new Date().toISOString(),
      demonstracao: true,
      avisos: [],
      pendencias: [],
      detalhe: resultado.detalhe ?? null,
      versaoOpenclaw: versao,
      modelo: typeof modelo === "string" ? modelo : null,
      proximaRotina: null,
      rotinaPausada: null,
      limiteAte: resultado.limiteAte ?? null,
    },
  });
  // Última barreira antes da tela do Pablo: mascara a string inteira, não só
  // os campos que hoje parecem arriscados.
  console.log(
    mascararEmail(
      JSON.stringify({ ...resultado, modelo, versao, registro }, null, 2),
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await principal();
