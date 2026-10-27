import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { urlPublica } from "@/core/auth/politicas";

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function igual(a: string, b: string) {
  const left = Buffer.from(hash(a)),
    right = Buffer.from(hash(b));
  return timingSafeEqual(left, right);
}
function chave() {
  const secret = process.env.SAIPOS_OPERATIONS_KEY;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret))
    throw new Error(
      "Configure SAIPOS_OPERATIONS_KEY com 64 caracteres hexadecimais.",
    );
  return Buffer.from(secret, "hex");
}
export function cifrar(value: unknown, scope: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", chave(), iv);
  cipher.setAAD(Buffer.from(scope));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decifrar(value: string, scope: string): unknown {
  const [iv, tag, body] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", chave(), iv);
  cipher.setAAD(Buffer.from(scope));
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8"),
  );
}
export function assinatura(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}
export function emitirToken(
  clientId: string,
  secret: string,
  now = Date.now(),
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: clientId,
      aud: "tetteo:saipos:logistics",
      exp: Math.floor(now / 1000) + 3600,
    }),
  ).toString("base64url");
  const content = `${header}.${payload}`;
  return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
}
export function validarToken(
  token: string,
  clientId: string,
  secret: string,
  now = Date.now(),
) {
  try {
    const [header, body, sig, extra] = token.split(".");
    if (
      extra ||
      !igual(
        sig ?? "",
        createHmac("sha256", secret)
          .update(`${header}.${body}`)
          .digest("base64url"),
      )
    )
      return false;
    const h = JSON.parse(Buffer.from(header, "base64url").toString()),
      p = JSON.parse(Buffer.from(body, "base64url").toString());
    return (
      h.alg === "HS256" &&
      p.sub === clientId &&
      p.aud === "tetteo:saipos:logistics" &&
      Number.isInteger(p.exp) &&
      p.exp > now / 1000 &&
      p.exp <= now / 1000 + 3600
    );
  } catch {
    return false;
  }
}

export async function lerCorpo(request: Request, limit = 256000) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new Error("Corpo excede o limite permitido.");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new Error("Corpo excede o limite permitido.");
      chunks.push(part.value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function origemOperacaoValida(request: Request) {
  try {
    return (
      request.headers.get("origin") === urlPublica() &&
      request.headers.get("sec-fetch-site") !== "cross-site"
    );
  } catch {
    return false;
  }
}
