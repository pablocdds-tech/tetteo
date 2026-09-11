import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * O PASSE DA EVOLUTION — o mecanismo de autenticação que a 2.3.7 oferece de
 * verdade.
 *
 * Com `headers: { jwt_key: <senha> }` na configuração do webhook, a Evolution
 * retira esse cabeçalho e manda no lugar `Authorization: Bearer <JWT>`:
 * HS256, assinado com a senha, `{iat, exp: iat + 600, app: "evolution",
 * action: "webhook"}` (webhook.controller.ts, `generateJwtToken`, etiqueta
 * 2.3.7).
 *
 * O QUE ELE NÃO É: assinatura do corpo. A 2.3.7 não tem HMAC do conteúdo, e
 * este arquivo não finge ter. O passe prova QUEM chamou; o que protege o
 * conteúdo é o resto da entrada — rede interna, esquema estrito e a trava de
 * duplicata, que também anula um passe reaproveitado dentro dos 10 minutos.
 *
 * Escrito com `node:crypto` em vez de biblioteca: são vinte linhas, e uma
 * dependência nova refaria o `npm ci` inteiro do deploy.
 */

const VALIDADE_DA_EVOLUTION = 600;

/** Relógios de contêineres diferentes nunca batem no segundo. */
const FOLGA_SEGUNDOS = 30;
const FUTURO_ACEITO_SEGUNDOS = 60;

/** A Evolution emite com 10 minutos; um passe de horas não veio dela. */
const PRAZO_MAXIMO_SEGUNDOS = 3600;

function paraBase64Url(texto: string): string {
  return Buffer.from(texto).toString("base64url");
}

function assinatura(base: string, senha: string): string {
  return createHmac("sha256", senha).update(base).digest("base64url");
}

/**
 * Emite um passe igual ao da Evolution 2.3.7. Usado pelo provedor simulado e
 * pelos testes — o Tetteo de produção só VERIFICA.
 */
export function assinarPasse(
  senha: string,
  agora: Date,
  validadeSegundos = VALIDADE_DA_EVOLUTION,
): string {
  const iat = Math.floor(agora.getTime() / 1000);
  const cabecalho = paraBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const corpo = paraBase64Url(
    JSON.stringify({
      iat,
      exp: iat + validadeSegundos,
      app: "evolution",
      action: "webhook",
    }),
  );
  const base = `${cabecalho}.${corpo}`;
  return `${base}.${assinatura(base, senha)}`;
}

function lerParte(parte: string): Record<string, unknown> | null {
  try {
    const lido = JSON.parse(Buffer.from(parte, "base64url").toString("utf8"));
    return lido && typeof lido === "object" && !Array.isArray(lido)
      ? lido
      : null;
  } catch {
    return null;
  }
}

export type VerificacaoDoPasse = { ok: true } | { ok: false; motivo: string };

export function verificarPasse(
  authorization: string | null | undefined,
  senhas: string[],
  agora: Date,
): VerificacaoDoPasse {
  // Sem senha configurada, a porta fica FECHADA. Aberta por falta de
  // configuração seria o defeito que ninguém percebe.
  if (senhas.length === 0)
    return { ok: false, motivo: "sem senha configurada" };

  const partes =
    /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/i.exec(
      (authorization ?? "").trim(),
    );
  if (!partes) return { ok: false, motivo: "passe ausente ou malformado" };

  const [, cabecalhoCodificado, corpoCodificado, assinaturaRecebida] = partes;
  const cabecalho = lerParte(cabecalhoCodificado);
  const corpo = lerParte(corpoCodificado);
  if (!cabecalho || !corpo) return { ok: false, motivo: "passe malformado" };

  // O ataque clássico é dizer "alg: none" e ser acreditado. Só um algoritmo
  // passa, e é o que a Evolution usa.
  if (cabecalho.alg !== "HS256") {
    return { ok: false, motivo: "algoritmo não aceito" };
  }

  const recebida = Buffer.from(assinaturaRecebida, "base64url");
  const base = `${cabecalhoCodificado}.${corpoCodificado}`;
  const confere = senhas.some((senha) => {
    const esperada = Buffer.from(assinatura(base, senha), "base64url");
    return (
      esperada.length === recebida.length && timingSafeEqual(esperada, recebida)
    );
  });
  if (!confere) return { ok: false, motivo: "assinatura não confere" };

  if (corpo.app !== "evolution" || corpo.action !== "webhook") {
    return { ok: false, motivo: "passe de outra origem" };
  }

  const { iat, exp } = corpo;
  if (typeof iat !== "number" || typeof exp !== "number") {
    return { ok: false, motivo: "passe sem prazo" };
  }

  const agoraSegundos = Math.floor(agora.getTime() / 1000);
  if (agoraSegundos > exp + FOLGA_SEGUNDOS) {
    return { ok: false, motivo: "passe vencido" };
  }
  if (iat > agoraSegundos + FUTURO_ACEITO_SEGUNDOS) {
    return { ok: false, motivo: "passe emitido no futuro" };
  }
  if (exp - iat > PRAZO_MAXIMO_SEGUNDOS) {
    return { ok: false, motivo: "prazo longo demais" };
  }

  return { ok: true };
}
