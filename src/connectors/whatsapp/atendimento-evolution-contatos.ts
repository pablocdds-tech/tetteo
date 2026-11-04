import { z } from "zod";
import type {
  ChannelContactName,
  ChannelContactNamesQuery,
  ChannelContactNamesResult,
  LiveChannelConfig,
} from "@/server/atendimento-provedor";
import { channelHttp, record } from "./atendimento-http";

const querySchema = z
  .object({ trustedPhone: z.string().regex(/^\+[1-9]\d{7,14}$/) })
  .strict();
const providerId = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => !/[\s\x00-\x1f\x7f]/.test(value));
const name = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return candidate &&
    candidate.length <= 160 &&
    !/[\x00-\x1f\x7f]/.test(candidate)
    ? candidate
    : null;
};

/** Only the exact provider instance and direct phone match can supply labels.
 * A label never verifies a CRM identity or grants operator permissions. */
export function normalizeEvolutionContactNames(
  raw: unknown,
  expected: { instanceId: string; trustedPhone: string },
): ChannelContactNamesResult {
  if (
    !querySchema.safeParse({ trustedPhone: expected.trustedPhone }).success ||
    !providerId.safeParse(expected.instanceId).success
  )
    throw new Error("EVOLUTION_CONTACT_QUERY_INVALID");
  if (!Array.isArray(raw) || raw.length > 2)
    throw new Error("EVOLUTION_CONTACT_RESPONSE_INVALID");
  const jid = `${expected.trustedPhone.slice(1)}@s.whatsapp.net`;
  const matching = raw
    .map(record)
    .filter(
      (item) =>
        item.instanceId === expected.instanceId &&
        item.remoteJid === jid &&
        item.isGroup !== true,
    );
  // The 2.3.7 database has a unique (remoteJid, instanceId). Duplicate rows are
  // ambiguous; do not select an arbitrary person's name if a provider drifts.
  if (matching.length > 1)
    throw new Error("EVOLUTION_CONTACT_RESPONSE_INVALID");
  const contact = matching[0],
    names: ChannelContactName[] = [];
  if (contact) {
    const parsed = z.iso
      .datetime({ offset: true })
      .safeParse(contact.updatedAt);
    const updatedAt = parsed.success
      ? new Date(parsed.data).toISOString()
      : null;
    const saved = name(contact.fullName),
      provider = name(contact.pushName);
    if (saved) names.push({ name: saved, source: "DEVICE_CONTACT", updatedAt });
    // Official 2.3.7 stores contact.name/notify together in pushName; this field
    // alone cannot prove whether the label came from the phone's address book.
    if (provider)
      names.push({ name: provider, source: "PROVIDER_CONTACT", updatedAt });
  }
  return { trustedPhone: expected.trustedPhone, names };
}

/** Source 2.3.7: chat.router.ts findContacts and channel.service.ts fetchContacts.
 * The caller supplies a phone already attested by the authenticated channel.
 * Never pass a name or a phone copied from customer message text into this API. */
export async function lookupEvolutionContactNames(
  config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }>,
  input: ChannelContactNamesQuery,
): Promise<ChannelContactNamesResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new Error("EVOLUTION_CONTACT_QUERY_INVALID");
  const headers = {
    apikey: config.secrets.apiKey!,
    "Content-Type": "application/json",
  };
  try {
    const raw = await channelHttp(
      `${config.settings.url}/instance/fetchInstances?instanceName=${encodeURIComponent(config.settings.instance)}`,
      { method: "GET", headers },
    );
    if (!Array.isArray(raw) || raw.length !== 1) throw new Error("binding");
    const instance = record(raw[0]);
    if (
      instance.name !== config.settings.instance ||
      !providerId.safeParse(instance.id).success
    )
      throw new Error("binding");
    const contacts = await channelHttp(
      `${config.settings.url}/chat/findContacts/${encodeURIComponent(config.settings.instance)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          where: {
            remoteJid: `${parsed.data.trustedPhone.slice(1)}@s.whatsapp.net`,
          },
          page: 1,
          offset: 2,
        }),
      },
    );
    return normalizeEvolutionContactNames(contacts, {
      instanceId: String(instance.id),
      trustedPhone: parsed.data.trustedPhone,
    });
  } catch {
    throw new Error("EVOLUTION_CONTACT_LOOKUP_UNAVAILABLE");
  }
}
