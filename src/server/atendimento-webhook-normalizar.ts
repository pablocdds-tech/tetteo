import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  EvolutionChannelSettings,
  MetaChannelSettings,
} from "./atendimento-credenciais";
import type { ChannelDelivery } from "./atendimento-provedor";

export class ChannelWebhookError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type NormalizedCustomerMessage = {
  externalId: string;
  senderKey: string;
  type: "MESSAGE";
  text: string;
  kind: "TEXT" | "AUDIO" | "IMAGE";
  transcriptionCertain: boolean;
  fromSelf: boolean;
  group: boolean;
  occurredAt?: string;
  trustedPhone?: string;
  profileName?: string;
  profileObservedAt?: string;
};
export type NormalizedChannelBatch = {
  messages: NormalizedCustomerMessage[];
  deliveries: ChannelDelivery[];
  matched: boolean;
};
const object = z.record(z.string(), z.unknown());
const id = z.string().min(1).max(200);
const e164 = (value: unknown): string | null =>
  typeof value === "string" && /^\+?[1-9]\d{7,14}$/.test(value)
    ? `+${value.replace(/^\+/, "")}`
    : null;
const record = (value: unknown): Record<string, unknown> => object.parse(value);
function timestamp(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : null;
  if (numeric === null || !Number.isFinite(numeric) || numeric <= 0)
    return undefined;
  const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
function profileName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name && name.length <= 160 && !/[\x00-\x1f\x7f]/.test(name)
    ? name
    : undefined;
}
function metaProfileName(
  contacts: unknown,
  sender: string | null,
): string | undefined {
  if (!sender || !Array.isArray(contacts) || contacts.length > 100)
    return undefined;
  const matches = contacts.filter((value) => {
    const parsed = object.safeParse(value);
    return parsed.success && e164(parsed.data.wa_id) === sender;
  });
  if (matches.length !== 1) return undefined;
  const contact = object.parse(matches[0]);
  const profile = object.safeParse(contact.profile);
  return profile.success ? profileName(profile.data.name) : undefined;
}
const correlation = (value: unknown) =>
  typeof value === "string" &&
  /^(?:test:)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    value,
  )
    ? value
    : undefined;
const eventHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function list(value: unknown, max = 100): unknown[] {
  return z
    .array(z.unknown())
    .max(max)
    .parse(value ?? []);
}
function normalizedContent(type: unknown, message: Record<string, unknown>) {
  if (type === "text")
    return {
      kind: "TEXT" as const,
      text: z.string().max(16384).parse(record(message.text).body),
      transcriptionCertain: true,
    };
  if (type === "audio")
    return {
      kind: "AUDIO" as const,
      text: "[Áudio recebido sem transcrição confiável]",
      transcriptionCertain: false,
    };
  if (["image", "video", "document", "sticker"].includes(String(type)))
    return {
      kind: "IMAGE" as const,
      text: "[Anexo recebido; conferência humana necessária]",
      transcriptionCertain: false,
    };
  if (type === "button")
    return {
      kind: "TEXT" as const,
      text: z.string().max(4096).parse(record(message.button).text),
      transcriptionCertain: true,
    };
  if (type === "interactive") {
    const interactive = record(message.interactive);
    const selected = interactive.button_reply ?? interactive.list_reply;
    if (selected)
      return {
        kind: "TEXT" as const,
        text: z.string().max(4096).parse(record(selected).title),
        transcriptionCertain: true,
      };
  }
  return null;
}
/** Unrelated bindings are skipped only by the authenticated same-organization dispatcher. */
export function normalizeMetaWebhook(
  raw: unknown,
  settings: MetaChannelSettings,
  options: { allowUnrelated?: boolean } = {},
): NormalizedChannelBatch {
  const body = record(raw);
  if (body.object !== "whatsapp_business_account")
    throw new ChannelWebhookError(400, "Objeto do webhook inválido.");
  const result: NormalizedChannelBatch = {
    messages: [],
    deliveries: [],
    matched: false,
  };
  for (const entryValue of list(body.entry, 20)) {
    const entry = record(entryValue);
    if (entry.id !== settings.businessAccountId) {
      if (options.allowUnrelated) continue;
      throw new ChannelWebhookError(
        403,
        "Conta do provedor não corresponde ao vínculo.",
      );
    }
    for (const changeValue of list(entry.changes, 30)) {
      const change = record(changeValue);
      if (change.field !== "messages") continue;
      const value = record(change.value),
        metadata = record(value.metadata);
      if (metadata.phone_number_id !== settings.phoneNumberId) {
        if (options.allowUnrelated) continue;
        throw new ChannelWebhookError(
          403,
          "Número do provedor não corresponde ao vínculo.",
        );
      }
      result.matched = true;
      for (const item of list(value.messages)) {
        const message = record(item),
          content = normalizedContent(message.type, message);
        if (!content) continue;
        const sender = e164(message.from),
          name = metaProfileName(value.contacts, sender),
          observedAt = timestamp(message.timestamp);
        result.messages.push({
          externalId: `message:${id.parse(message.id)}`,
          senderKey: sender ?? "unresolved:meta",
          type: "MESSAGE",
          ...content,
          fromSelf: false,
          group: false,
          ...(sender ? { trustedPhone: sender } : {}),
          ...(observedAt ? { occurredAt: observedAt } : {}),
          ...(name
            ? {
                profileName: name,
                ...(observedAt ? { profileObservedAt: observedAt } : {}),
              }
            : {}),
        });
      }
      for (const item of list(value.statuses)) {
        const status = record(item),
          recipient = e164(status.recipient_id);
        const state = (
          {
            sent: "ACCEPTED",
            delivered: "DELIVERED",
            read: "READ",
            failed: "FAILED",
          } as const
        )[String(status.status) as "sent" | "delivered" | "read" | "failed"];
        if (!recipient || !state) continue;
        const providerId = id.parse(status.id),
          opaque = correlation(status.biz_opaque_callback_data);
        result.deliveries.push({
          externalId: `status:${providerId}:${String(status.status)}:${eventHash({ recipient, state, timestamp: status.timestamp ?? null }).slice(0, 20)}`,
          providerId,
          recipient,
          state,
          ...(opaque ? { correlationId: opaque } : {}),
        });
      }
    }
  }
  return result;
}
function phoneFromJid(value: unknown): string | null {
  if (typeof value !== "string" || !value.endsWith("@s.whatsapp.net"))
    return null;
  return e164(value.slice(0, -15).split(":")[0]);
}
function evolutionText(value: Record<string, unknown>): string | undefined {
  if (typeof value.conversation === "string")
    return z.string().max(16384).parse(value.conversation);
  if (value.extendedTextMessage)
    return z.string().max(16384).parse(record(value.extendedTextMessage).text);
  if (value.buttonsResponseMessage)
    return z
      .string()
      .max(4096)
      .parse(record(value.buttonsResponseMessage).selectedDisplayText);
  if (value.listResponseMessage)
    return z.string().max(4096).parse(record(value.listResponseMessage).title);
  return undefined;
}
export function normalizeEvolutionWebhook(
  raw: unknown,
  settings: EvolutionChannelSettings,
): NormalizedChannelBatch {
  const body = record(raw);
  if (body.instance !== settings.instance)
    throw new ChannelWebhookError(
      403,
      "Instância do provedor não corresponde ao vínculo.",
    );
  const event = z.string().max(100).parse(body.event),
    result: NormalizedChannelBatch = {
      messages: [],
      deliveries: [],
      matched: true,
    };
  if (
    ![
      "messages.upsert",
      "messages.update",
      "send.message",
      "connection.update",
    ].includes(event)
  )
    return result;
  const data = record(body.data);
  if (event === "messages.upsert") {
    const key = record(data.key),
      message = record(data.message ?? {}),
      external = id.parse(key.id),
      remote = typeof key.remoteJid === "string" ? key.remoteJid : "";
    const group = remote.endsWith("@g.us"),
      fromSelf = z.boolean().parse(key.fromMe),
      sender =
        phoneFromJid(remote) ??
        (remote.endsWith("@lid") ? phoneFromJid(key.remoteJidAlt) : null);
    // LID digits are not telephone digits. Without a transport-verified PN,
    // preserve the event as unresolved and let the runtime refuse attribution.
    let content: {
      kind: "TEXT" | "AUDIO" | "IMAGE";
      text: string;
      transcriptionCertain: boolean;
    } | null = null;
    const text = evolutionText(message);
    if (text !== undefined)
      content = { kind: "TEXT", text, transcriptionCertain: true };
    else if (message.audioMessage)
      content = {
        kind: "AUDIO",
        text: "[Áudio recebido sem transcrição confiável]",
        transcriptionCertain: false,
      };
    else if (
      message.imageMessage ||
      message.videoMessage ||
      message.documentMessage ||
      message.stickerMessage
    )
      content = {
        kind: "IMAGE",
        text: "[Anexo recebido; conferência humana necessária]",
        transcriptionCertain: false,
      };
    const name =
      !fromSelf && !group && sender ? profileName(data.pushName) : undefined;
    const observedAt = timestamp(data.messageTimestamp);
    if (content)
      result.messages.push({
        externalId: `message:${external}`,
        senderKey: sender ?? "unresolved:evolution",
        type: "MESSAGE",
        ...content,
        fromSelf,
        group,
        ...(sender ? { trustedPhone: sender } : {}),
        ...(observedAt ? { occurredAt: observedAt } : {}),
        ...(name
          ? {
              profileName: name,
              ...(observedAt ? { profileObservedAt: observedAt } : {}),
            }
          : {}),
      });
  } else if (event === "messages.update") {
    const key = data.key ? record(data.key) : {},
      recipient = phoneFromJid(data.remoteJid ?? key.remoteJid);
    const state = (
      {
        SERVER_ACK: "ACCEPTED",
        DELIVERY_ACK: "DELIVERED",
        READ: "READ",
        PLAYED: "READ",
        ERROR: "FAILED",
      } as const
    )[
      String(data.status) as
        "SERVER_ACK" | "DELIVERY_ACK" | "READ" | "PLAYED" | "ERROR"
    ];
    if (recipient && state && (data.fromMe === true || key.fromMe === true)) {
      const providerId = id.parse(data.keyId ?? key.id);
      result.deliveries.push({
        externalId: `status:${providerId}:${String(data.status)}:${eventHash({ recipient, state }).slice(0, 20)}`,
        providerId,
        recipient,
        state,
      });
    }
  } else if (event === "send.message") {
    const key = record(data.key),
      recipient = phoneFromJid(key.remoteJid ?? data.remoteJid);
    if (recipient && key.fromMe === true) {
      const providerId = id.parse(key.id),
        message = record(data.message ?? {}),
        text = evolutionText(message) ?? "",
        marker = text.match(/Protocolo: SV-((?:test:)?[a-f0-9-]{36})\s*$/i),
        opaque = correlation(marker?.[1]);
      result.deliveries.push({
        externalId: `sent:${providerId}`,
        providerId,
        recipient,
        state: "ACCEPTED",
        ...(opaque ? { correlationId: opaque } : {}),
      });
    }
  }
  return result;
}
export async function readChannelWebhookBody(
  request: Request,
  limit = 256 * 1024,
): Promise<string> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ChannelWebhookError(415, "Envie JSON.");
  if (Number(request.headers.get("content-length")) > limit)
    throw new ChannelWebhookError(413, "Evento acima do limite.");
  const reader = request.body?.getReader();
  if (!reader) throw new ChannelWebhookError(400, "Corpo ausente.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ChannelWebhookError(413, "Evento acima do limite.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
