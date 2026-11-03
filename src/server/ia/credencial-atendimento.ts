import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

type Scope = { organizationId: string; storeId: string };
function key() {
  const secret =
    process.env.AV_CREDENTIAL_KEY?.trim() || process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("MODEL_ENCRYPTION_UNAVAILABLE");
  return createHmac("sha256", secret)
    .update("tetteo:customer-service-model:v1")
    .digest();
}
const aad = (scope: Scope) =>
  Buffer.from(JSON.stringify(["GEMINI", scope.organizationId, scope.storeId]));
export function encryptVirtualCredential(scope: Scope, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(scope));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString(
    "base64url",
  );
}
export function decryptVirtualCredential(scope: Scope, encrypted: string) {
  try {
    const bytes = Buffer.from(encrypted, "base64url");
    if (bytes.length < 29) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      bytes.subarray(0, 12),
    );
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      decipher.update(bytes.subarray(12, -16)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("MODEL_CREDENTIAL_UNAVAILABLE");
  }
}
