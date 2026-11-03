import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
export type ChannelScope = {
  organizationId: string;
  storeId: string;
  accountId: string;
};
export type EvolutionChannelSettings = { url: string; instance: string };
export type MetaChannelSettings = {
  phoneNumberId: string;
  businessAccountId: string;
  apiVersion: string;
};
export type ChannelSecrets = {
  apiKey?: string;
  webhookSecret?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
};
function key() {
  const value =
    process.env.AV_CREDENTIAL_KEY?.trim() || process.env.AUTH_SECRET;
  if (!value || value.length < 32)
    throw new Error("CHANNEL_ENCRYPTION_UNAVAILABLE");
  return createHmac("sha256", value)
    .update("tetteo:severina-channels:v1")
    .digest();
}
const aad = (s: ChannelScope) =>
  Buffer.from(JSON.stringify([s.organizationId, s.storeId, s.accountId]));
export function encryptChannelValue(scope: ChannelScope, text: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(scope));
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function decryptChannelValue(scope: ChannelScope, text: string) {
  try {
    const data = Buffer.from(text, "base64url"),
      cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    cipher.setAAD(aad(scope));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      cipher.update(data.subarray(28)),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("CHANNEL_CREDENTIAL_UNAVAILABLE");
  }
}
export const channelRecipientHash = (scope: ChannelScope, phone: string) =>
  createHmac("sha256", key())
    .update(Buffer.concat([aad(scope), Buffer.from(`:${phone}`)]))
    .digest("hex");
export function allowedEvolutionOrigins() {
  const values = [
    process.env.EVOLUTION_URL || "http://evolution_api:8080",
    ...(process.env.AV_EVOLUTION_ALLOWED_ORIGINS ?? "").split(","),
  ];
  return [
    ...new Set(
      values.filter(Boolean).flatMap((value) => {
        try {
          const url = new URL(value.trim());
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            return [];
          return [url.toString().replace(/\/+$/, "")];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
export function acceptedEvolutionUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    return allowedEvolutionOrigins().includes(
      url.toString().replace(/\/+$/, ""),
    );
  } catch {
    return false;
  }
}
/** Instâncias já usadas por automações internas não podem ser adotadas pelo atendimento. */
export function reservedEvolutionInstance(value: string, instance: string) {
  try {
    const canonical = (url: string) =>
      new URL(url).toString().replace(/\/+$/, "");
    return (
      canonical(value) ===
        canonical(process.env.EVOLUTION_URL ?? "http://evolution_api:8080") &&
      [
        process.env.EVOLUTION_INSTANCIA,
        process.env.COMPRAS_EVOLUTION_INSTANCIA,
      ].some((name) => !!name?.trim() && name.trim() === instance)
    );
  } catch {
    return true;
  }
}
