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
 * o CLI devolver o perfil OAuth com o e-mail do dono num campo de texto
 * (como de fato devolve, em `auth.oauth.profiles[].label`/`.profileId` e em
 * `auth.providers[].profiles.labels[]` — Fix round 2), ele não aparece aqui
 * mesmo assim.
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

const LIMITE_DETALHE = 300;

/** Qualquer texto livre do CLI (mensagem de erro, motivo de rota) passa por
 * aqui antes de virar `detalhe`: mascara e-mail e corta o tamanho. */
function textoSeguro(texto) {
  return mascararEmail(String(texto ?? "").trim()).slice(0, LIMITE_DETALHE);
}

function executarModelsStatus() {
  return executar(process.execPath, [CLI, "models", "status", "--json"], {
    cwd: "/app",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function motivoDoErro(erro) {
  if (erro?.code === "ENOENT")
    return "o executável do Node ou do OpenClaw não foi encontrado";
  if (erro?.killed || erro?.signal)
    return "o comando demorou demais e foi encerrado";
  if (typeof erro?.code === "number")
    return `o comando terminou com código ${erro.code}`;
  return "o comando falhou";
}

/**
 * Roda `models status --json` e devolve o status já interpretado — ou, se
 * não deu para rodar o comando ou entender a saída, o motivo em português.
 *
 * NUNCA lança: uma falha aqui é dado para o estado "desligado" (Fix round
 * 1 — antes, isso virava `status = null` e `estadoDaVerificacao` lia o
 * login como vazio, confundindo "não consegui perguntar" com "perguntei e
 * não tem login". São coisas diferentes: a segunda manda o Pablo refazer o
 * login; a primeira manda olhar o container, e refazer o login não ajudaria
 * em nada.
 */
export async function obterStatus(executarFn = executarModelsStatus) {
  let stdout;
  try {
    ({ stdout } = await executarFn());
  } catch (erro) {
    return {
      status: null,
      erroDeExecucao:
        `O comando de verificação (models status --json) não rodou: ` +
        `${motivoDoErro(erro)}. Confira se o OpenClaw está instalado no ` +
        `container e se o comando funciona rodado à mão.`,
    };
  }
  try {
    return { status: JSON.parse(stdout), erroDeExecucao: null };
  } catch {
    return {
      status: null,
      erroDeExecucao:
        "O comando de verificação (models status --json) respondeu, mas a " +
        "saída não é um JSON válido. Rode o comando à mão dentro do " +
        "container para ver o que ele mostra.",
    };
  }
}

// Status conhecidos de um perfil OAuth que NÃO servem para logar, além de
// vencido por tempo (checado à parte, por remainingMs/expiresAt).
const STATUS_OAUTH_RUIM = new Set(["expired", "revoked", "invalid"]);

/**
 * Um perfil está vencido se o próprio status disser isso, ou se o tempo
 * disser (Fix round 2 — a forma real de `models status --json` não marca
 * `expired: true`; ela manda `status: "ok"` mais `remainingMs`/`expiresAt`).
 * `remainingMs` é uma duração, então não depende do relógio da máquina que
 * roda o teste; só cai para `expiresAt` (um instante absoluto) quando
 * `remainingMs` não vem.
 */
function perfilOAuthVencido(perfil) {
  const status = String(perfil?.status ?? "").toLowerCase();
  if (STATUS_OAUTH_RUIM.has(status)) return true;
  if (typeof perfil?.remainingMs === "number") return perfil.remainingMs <= 0;
  if (typeof perfil?.expiresAt === "number")
    return perfil.expiresAt <= Date.now();
  return false;
}

/**
 * O oposto de vencido não é "não vencido" — é uma prova POSITIVA de saúde
 * (Fix round 3). Um status desconhecido, sem `remainingMs`/`expiresAt` que
 * confirmem tempo de sobra, não passa aqui: ele fica na dúvida, e dúvida não
 * é prova. `STATUS_OAUTH_RUIM` é checado primeiro para as duas funções nunca
 * discordarem sobre o mesmo perfil.
 */
function perfilOAuthSaudavel(perfil) {
  const status = String(perfil?.status ?? "").toLowerCase();
  if (STATUS_OAUTH_RUIM.has(status)) return false;
  if (status === "ok") return true;
  if (typeof perfil?.remainingMs === "number") return perfil.remainingMs > 0;
  if (typeof perfil?.expiresAt === "number")
    return perfil.expiresAt > Date.now();
  return false;
}

/**
 * A rota da assinatura para a OpenAI, quando o próprio OpenClaw confirma que
 * ela funciona (Fix round 2). Não é obrigatória: um CLI mais antigo pode não
 * mandar `auth.runtimeAuthRoutes` nenhuma, e isso sozinho não é motivo para
 * dizer que a conexão está ruim — só significa que não há o nome do runtime
 * para mostrar.
 */
function rotaOpenaiUsavel(auth) {
  return lista(auth.runtimeAuthRoutes).find(
    (r) => ehOpenai(r) && String(r?.status ?? "").toLowerCase() === "usable",
  );
}

export function estadoDaVerificacao(
  status,
  { gatewayDePe, erroDeExecucao = null } = {},
) {
  if (!gatewayDePe) {
    return {
      estado: "desligado",
      detalhe: "O gateway não respondeu em 127.0.0.1:18789.",
    };
  }
  // A verificação em si não rodou, ou a resposta não deu para entender: isto
  // é "não consegui perguntar", não "perguntei e não tem login" — o Pablo
  // não resolve isso refazendo o login.
  if (erroDeExecucao) {
    return { estado: "desligado", detalhe: textoSeguro(erroDeExecucao) };
  }
  const auth = status?.auth ?? {};

  // Um motivo de bloqueio RECONHECIDO decide na hora — nem uma rota usável
  // muda isso, porque é um fato explícito, não uma dúvida. Um motivo
  // DESCONHECIDO fica guardado: sozinho ele não prova que está quebrado
  // (pode ser um rótulo novo e inofensivo), mas também não é prova de saúde
  // — só uma rota usável destrava o "conectado" com ele no ar (Fix round 3).
  const bloqueado = lista(auth.unusableProfiles).find(ehOpenai);
  let motivoBloqueio = null;
  if (bloqueado) {
    const motivoOriginal = String(
      bloqueado.reason ?? bloqueado.disabledReason ?? "motivo não informado",
    );
    const motivo = motivoOriginal.toLowerCase();
    if (/rate|limit|usage|quota/.test(motivo)) {
      return {
        estado: "limite",
        limiteAte: paraIso(bloqueado.cooldownUntil ?? bloqueado.until),
      };
    }
    if (/auth|expired|revoked|invalid/.test(motivo))
      return { estado: "login_expirado" };
    motivoBloqueio = motivoOriginal;
  }

  // Fix round 2: `auth.oauth` é um objeto (`{ warnAfterMs, profiles }`), não
  // uma lista — os perfis moram em `auth.oauth.profiles`.
  const perfisOAuth = lista(auth.oauth?.profiles).filter(ehOpenai);
  if (perfisOAuth.length === 0)
    return {
      estado: "login_expirado",
      detalhe: "Nenhum login da OpenAI encontrado.",
    };
  if (perfisOAuth.every(perfilOAuthVencido))
    return { estado: "login_expirado" };

  const rota = lista(auth.modelRouteIssues)[0];
  if (rota) {
    return {
      estado: "modelo_indisponivel",
      detalhe: textoSeguro(
        rota.message ?? rota.reason ?? "rota do modelo com problema",
      ),
    };
  }

  // Nada RECONHECIDO deu problema até aqui — mas isso é só ausência de prova
  // de problema, não prova de saúde (Fix round 3: era exatamente essa
  // lacuna que deixava um status novo, ou um motivo de bloqueio novo, virar
  // "conectado" por omissão). "Conectado" agora exige uma prova POSITIVA: a
  // rota da assinatura confirmando que funciona (o que vale mais que
  // qualquer rótulo de perfil não reconhecido — um sistema são de verdade
  // tem essa rota usável), ou pelo menos um perfil com status
  // reconhecidamente bom, sem um motivo de bloqueio pendente de explicação.
  const rotaUsavel = rotaOpenaiUsavel(auth);
  if (rotaUsavel) {
    return {
      estado: "conectado",
      runtime: rotaUsavel.runtime != null ? String(rotaUsavel.runtime) : null,
    };
  }
  if (perfisOAuth.some(perfilOAuthSaudavel) && !motivoBloqueio) {
    return { estado: "conectado", runtime: null };
  }

  const statusNaoReconhecido = perfisOAuth.find(
    (p) => !perfilOAuthSaudavel(p),
  )?.status;
  const causas = [];
  if (motivoBloqueio)
    causas.push(`o motivo de bloqueio do perfil ("${motivoBloqueio}")`);
  if (statusNaoReconhecido)
    causas.push(`o status do perfil OpenAI ("${statusNaoReconhecido}")`);
  const oQueNaoBateu = causas.length
    ? `${causas.join(" e ")} não é reconhecido`
    : "o estado do perfil não é reconhecido";
  return {
    estado: "login_expirado",
    detalhe: textoSeguro(
      `Não deu para confirmar o login: ${oQueNaoBateu}, e não há confirmação de que a rota da assinatura funciona. Pode ser preciso refazer o login, ou aguardar e verificar de novo.`,
    ),
  };
}

/** 0 só quando está tudo bem; qualquer outro estado é falha para quem só
 * olha o código de saída (`$?`) — o corpo JSON continua sendo o contrato. */
export function codigoDeSaida(estado) {
  return estado === "conectado" ? 0 : 1;
}

/** Monta o objeto final, exatamente como vai para a tela do Pablo — antes
 * da máscara de e-mail, que é aplicada em cima da string inteira por quem
 * chama (`principal`, e o teste que prova que o e-mail não sobrevive). */
export function saidaFinal(resultado, { modelo, versao, registro }) {
  return { ...resultado, modelo, versao, registro };
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

  const { status, erroDeExecucao } = await obterStatus();
  const versao = await executar(process.execPath, [CLI, "--version"], {
    cwd: "/app",
    timeout: 30_000,
  })
    .then(({ stdout }) => stdout.trim().split(/\s+/).at(-1))
    .catch(() => null);

  const resultado = estadoDaVerificacao(status ?? {}, {
    gatewayDePe,
    erroDeExecucao,
  });
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
  process.exitCode = codigoDeSaida(resultado.estado);
  // Última barreira antes da tela do Pablo: mascara a string inteira, não só
  // os campos que hoje parecem arriscados.
  console.log(
    mascararEmail(
      JSON.stringify(
        saidaFinal(resultado, { modelo, versao, registro }),
        null,
        2,
      ),
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await principal();
