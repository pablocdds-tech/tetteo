import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const emailDeLogin = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const senhaNova = z
  .string()
  .min(12, "Use pelo menos 12 caracteres.")
  .refine(
    (valor) => Buffer.byteLength(valor, "utf8") <= 72,
    "Use uma senha de até 72 bytes (acentos e emojis ocupam mais espaço).",
  );
export const tokenDeRecuperacao = z.string().regex(/^[a-f0-9]{64}$/);
export const VALIDADE_RECUPERACAO_MS = 30 * 60_000;

export function hashSegredo(valor: string) {
  return createHash("sha256").update(valor).digest("hex");
}

export function criarTokenRecuperacao(agora = new Date()) {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashSegredo(token),
    expiraEm: new Date(agora.getTime() + VALIDADE_RECUPERACAO_MS),
  };
}

export function googleConfigurado() {
  return Boolean(
    process.env.AUTH_GOOGLE_ID?.trim() &&
    process.env.AUTH_GOOGLE_SECRET?.trim(),
  );
}

export function urlPublica() {
  const url = new URL(process.env.APP_URL ?? "");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password
  ) {
    throw new Error("APP_URL deve usar HTTPS (ou HTTP em localhost).");
  }
  return url.origin;
}

export function recuperacaoConfigurada() {
  if (
    !process.env.RESEND_API_KEY?.trim() ||
    !process.env.AUTH_EMAIL_FROM?.trim()
  )
    return false;
  try {
    urlPublica();
    return true;
  } catch {
    return false;
  }
}

export function identidadeGoogle(perfil: {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}) {
  const email = emailDeLogin.safeParse(perfil.email);
  if (
    perfil.email_verified !== true ||
    !email.success ||
    typeof perfil.sub !== "string" ||
    !perfil.sub ||
    perfil.sub.length > 255
  )
    return null;
  return {
    subject: perfil.sub,
    email: email.data,
    nome:
      typeof perfil.name === "string" && perfil.name.trim()
        ? perfil.name.trim().slice(0, 120)
        : email.data.split("@")[0],
  };
}
