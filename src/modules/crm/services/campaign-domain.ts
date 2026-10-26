import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
} from "node:crypto";

export const RULE_VERSION = "retention-1.2.0";
export const SEGMENTS = [
  "NEW",
  "VIP",
  "REGULAR",
  "OCCASIONAL",
  "AT_RISK",
  "LOST",
  "UNKNOWN",
] as const;
export type RetentionSegment = (typeof SEGMENTS)[number];
export type Arm = "CONTROL" | "TREATMENT";

export class CrmError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

export function retentionSegment(
  visits: number,
  lastVisitAt: Date | null,
  asOf: Date,
): RetentionSegment {
  if (!Number.isSafeInteger(visits) || visits < 0)
    throw new CrmError(
      "INVALID_VISITS",
      "Quantidade de visitas inválida.",
      400,
    );
  if (!visits) return "NEW";
  const days = lastVisitAt
    ? Math.floor((asOf.getTime() - lastVisitAt.getTime()) / 86_400_000)
    : NaN;
  if (!Number.isFinite(days) || days < 0) return "UNKNOWN";
  if (visits >= 8 && days <= 30) return "VIP";
  if (visits >= 3 && days <= 45) return "REGULAR";
  if (days <= 60) return "OCCASIONAL";
  if (days <= 90) return "AT_RISK";
  return "LOST";
}

export function assignArm(
  contactId: string,
  experimentId: string,
  salt: string,
): Arm {
  const hash = createHash("sha256")
    .update(JSON.stringify([salt, experimentId, contactId]))
    .digest();
  return hash.readUInt32BE(0) / 4_294_967_296 < 0.2 ? "CONTROL" : "TREATMENT";
}

export function canonicalHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object" && !(v instanceof Date)
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function protectIdentity(storeId: string, type: string, value: string) {
  // Separate the encryption key from Auth.js using a stable purpose-specific
  // derivation. An explicit CRM key takes precedence for independent rotation.
  const authSecret = process.env.AUTH_SECRET;
  const secret =
    process.env.CRM_IDENTITY_KEY ??
    (authSecret
      ? createHmac("sha256", authSecret)
          .update("tetteo:crm-identities:v1")
          .digest("hex")
      : undefined);
  if (!secret || !/^[a-f\d]{64}$/i.test(secret))
    throw new CrmError(
      "IDENTITY_KEY_MISSING",
      "Configure a chave privada de identidade no servidor.",
      503,
    );
  const key = Buffer.from(secret, "hex");
  const normalizedHash = createHmac("sha256", key)
    .update(JSON.stringify([storeId, type, value.trim()]))
    .digest("hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value.trim(), "utf8"),
    cipher.final(),
  ]);
  return {
    normalizedHash,
    encryptedValue: Buffer.concat([
      iv,
      cipher.getAuthTag(),
      encrypted,
    ]).toString("base64"),
  };
}

// Operational days are local midnight in São Paulo, using [start, end).
// Business dates are supported from 2020; São Paulo has UTC-03 in this range.
export function operationalDate(value: string): Date {
  if (!/^20[2-9]\d-\d{2}-\d{2}$/.test(value))
    throw new CrmError(
      "INVALID_DATE",
      "Informe uma data operacional válida (AAAA-MM-DD).",
      400,
    );
  const date = new Date(`${value}T00:00:00-03:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new CrmError("INVALID_DATE", "Data operacional inválida.", 400);
  return date;
}

export type GroupResult = {
  assigned: number;
  returned: number;
  visits: number;
  netRevenueCents: number | null;
  simulated: number;
  uncertain: number;
  blocked: number;
  failed: number;
  contaminated: number;
};
export function compareGroups(
  treatment: GroupResult,
  control: GroupResult,
  costCents: number,
) {
  for (const group of [treatment, control]) {
    if (
      !Number.isSafeInteger(group.assigned) ||
      group.assigned < 0 ||
      !Number.isSafeInteger(group.returned) ||
      group.returned < 0 ||
      group.returned > group.assigned ||
      (group.netRevenueCents !== null &&
        !Number.isSafeInteger(group.netRevenueCents))
    )
      throw new CrmError(
        "INVALID_RESULT",
        "A amostra ou os valores do resultado são inválidos.",
      );
  }
  if (!Number.isSafeInteger(costCents) || costCents < 0)
    throw new CrmError(
      "INVALID_COST",
      "O custo precisa ser informado em centavos inteiros.",
    );
  const treatmentRate = treatment.assigned
    ? treatment.returned / treatment.assigned
    : null;
  const controlRate = control.assigned
    ? control.returned / control.assigned
    : null;
  const available =
    treatmentRate !== null &&
    controlRate !== null &&
    treatment.netRevenueCents !== null &&
    control.netRevenueCents !== null;
  let incrementalRevenueCents: number | null = null;
  if (available) {
    const denominator = BigInt(control.assigned);
    const numerator =
      BigInt(treatment.netRevenueCents!) * denominator -
      BigInt(control.netRevenueCents!) * BigInt(treatment.assigned);
    let rounded = numerator / denominator;
    const remainder = numerator % denominator;
    // Nearest cent, with exact half ties toward +infinity, matching Math.round.
    if (remainder * 2n >= denominator) rounded++;
    if (remainder * 2n < -denominator) rounded--;
    incrementalRevenueCents = Number(rounded);
    if (
      !Number.isSafeInteger(incrementalRevenueCents) ||
      !Number.isSafeInteger(incrementalRevenueCents - costCents)
    )
      throw new CrmError(
        "MONEY_RANGE",
        "Resultado fora do limite de centavos representáveis com segurança.",
      );
  }
  return {
    treatmentRate,
    controlRate,
    upliftPoints:
      treatmentRate !== null && controlRate !== null
        ? Math.round((treatmentRate - controlRate) * 10_000) / 100
        : null,
    incrementalRevenueCents,
    contributionAfterCampaignCents:
      incrementalRevenueCents === null
        ? null
        : incrementalRevenueCents - costCents,
    costCents,
    conclusion: "descriptive_only" as const,
  };
}
