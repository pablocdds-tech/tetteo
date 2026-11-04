import { z } from "zod";
import type {
  ChannelHistoryMessage,
  ChannelHistoryPage,
  ChannelHistoryQuery,
  LiveChannelConfig,
} from "@/server/atendimento-provedor";
import { channelHttp, record } from "./atendimento-http";

const querySchema = z
  .object({
    page: z.number().int().min(1).max(10000),
    pageSize: z.number().int().min(1).max(100),
    since: z.iso.datetime({ offset: true }),
    until: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (value) =>
      new Date(value.since).getTime() <= new Date(value.until).getTime(),
  );
const providerId = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => !/[\s\x00-\x1f\x7f]/.test(value));
const metadata = z.object({
  total: z.number().int().min(0).max(1_000_000_000),
  pages: z.number().int().min(0).max(1_000_000_000),
  currentPage: z.number().int().min(1).max(10000),
  records: z.array(z.unknown()).max(100),
});
const phoneFromJid = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^([1-9]\d{7,14})@s\.whatsapp\.net$/);
  return match ? `+${match[1]}` : null;
};
function sourceTime(value: unknown): number | null {
  let numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,16}$/.test(value)
        ? Number(value)
        : NaN;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const long = record(value);
    if (
      Number.isInteger(long.low) &&
      Number.isInteger(long.high) &&
      Number(long.high) >= 0
    ) {
      const complete =
        (BigInt(Number(long.high)) << 32n) + BigInt(Number(long.low) >>> 0);
      if (complete <= BigInt(Number.MAX_SAFE_INTEGER))
        numeric = Number(complete);
    }
  }
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  return Number.isSafeInteger(millis) &&
    Number.isFinite(new Date(millis).getTime())
    ? millis
    : null;
}
function messageContent(
  raw: unknown,
): Pick<
  ChannelHistoryMessage,
  "kind" | "text" | "transcriptionCertain"
> | null {
  let message = record(raw);
  // Unwrap only known transport containers, never quoted messages or instructions.
  for (let depth = 0; depth < 3; depth++) {
    const wrapped =
      record(message.ephemeralMessage).message ??
      record(message.documentWithCaptionMessage).message;
    if (!wrapped) break;
    message = record(wrapped);
  }
  const candidate =
    message.conversation ??
    record(message.extendedTextMessage).text ??
    record(message.buttonsResponseMessage).selectedDisplayText ??
    record(message.listResponseMessage).title;
  if (typeof candidate === "string") {
    if (
      !candidate.trim() ||
      candidate.length > 16384 ||
      candidate.includes("\0")
    )
      return null;
    return { kind: "TEXT", text: candidate, transcriptionCertain: true };
  }
  if (message.audioMessage)
    return {
      kind: "AUDIO",
      text: "[Áudio do histórico; sem transcrição confirmada]",
      transcriptionCertain: false,
    };
  const media =
    message.imageMessage ??
    message.videoMessage ??
    message.documentMessage ??
    message.stickerMessage ??
    message.ptvMessage;
  if (media) {
    const caption = record(media).caption;
    const text =
      typeof caption === "string" && caption.trim()
        ? `[Anexo do histórico; arquivo não importado]\n${caption}`
        : "[Anexo do histórico; arquivo não importado]";
    return text.length <= 16384 && !text.includes("\0")
      ? { kind: "IMAGE", text, transcriptionCertain: false }
      : null;
  }
  return null;
}

/** Pure parser: only transport-verified phone metadata identifies the peer. */
export function normalizeEvolutionHistoryMessage(
  raw: unknown,
  expected: { instanceId: string; since: string; until: string },
): ChannelHistoryMessage | null {
  const item = record(raw),
    key = record(item.key);
  if (
    item.instanceId !== expected.instanceId ||
    typeof key.fromMe !== "boolean"
  )
    return null;
  const id = providerId.safeParse(key.id);
  if (!id.success || typeof key.remoteJid !== "string") return null;
  const sender =
    phoneFromJid(key.remoteJid) ??
    (key.remoteJid.endsWith("@lid") ? phoneFromJid(key.remoteJidAlt) : null);
  if (!sender) return null;
  const time = sourceTime(item.messageTimestamp);
  if (
    time === null ||
    time < new Date(expected.since).getTime() ||
    time > new Date(expected.until).getTime()
  )
    return null;
  const content = messageContent(item.message);
  if (!content) return null;
  const hint =
    !key.fromMe && typeof item.pushName === "string"
      ? item.pushName.trim()
      : "";
  return {
    externalId: `message:${id.data}`,
    senderKey: sender,
    trustedPhone: sender,
    fromSelf: key.fromMe,
    ...content,
    occurredAt: new Date(time).toISOString(),
    ...(hint && hint.length <= 100 && !/[\x00-\x1f\x7f]/.test(hint)
      ? { displayName: hint }
      : {}),
  };
}

/** Evolution 2.3.7 reads stored messages with page/offset (not take/skip).
 * Source: src/api/services/channel.service.ts fetchMessages, lines 560–641.
 * These requests do not synchronize, mark read, reconnect, or send messages. */
export async function readEvolutionHistoryPage(
  config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }>,
  input: ChannelHistoryQuery,
): Promise<ChannelHistoryPage> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new Error("EVOLUTION_HISTORY_QUERY_INVALID");
  const query = parsed.data;
  const headers = {
    apikey: config.secrets.apiKey!,
    "Content-Type": "application/json",
  };
  try {
    const instances = await channelHttp(
      `${config.settings.url}/instance/fetchInstances?instanceName=${encodeURIComponent(config.settings.instance)}`,
      { method: "GET", headers },
    );
    if (!Array.isArray(instances) || instances.length !== 1)
      throw new Error("invalid instance binding");
    const instance = record(instances[0]);
    if (
      instance.name !== config.settings.instance ||
      !providerId.safeParse(instance.id).success
    )
      throw new Error("invalid instance binding");
    const raw = record(
      await channelHttp(
        `${config.settings.url}/chat/findMessages/${encodeURIComponent(config.settings.instance)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            where: { messageTimestamp: { gte: query.since, lte: query.until } },
            page: query.page,
            offset: query.pageSize,
          }),
        },
      ),
    );
    if (raw.error === true) throw new Error("provider rejected history");
    const page = metadata.parse(raw.messages);
    const expectedCount = Math.min(
      query.pageSize,
      Math.max(0, page.total - (query.page - 1) * query.pageSize),
    );
    if (
      page.currentPage !== query.page ||
      page.pages !== Math.ceil(page.total / query.pageSize) ||
      page.records.length !== expectedCount
    )
      throw new Error("invalid pagination");
    const messages: ChannelHistoryMessage[] = [];
    const ids = new Set<string>();
    for (const item of page.records) {
      const normalized = normalizeEvolutionHistoryMessage(item, {
        instanceId: String(instance.id),
        since: query.since,
        until: query.until,
      });
      if (!normalized || ids.has(normalized.externalId)) continue;
      ids.add(normalized.externalId);
      messages.push(normalized);
    }
    return {
      messages,
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      pages: page.pages,
      nextPage: query.page < page.pages ? query.page + 1 : null,
      skipped: page.records.length - messages.length,
    };
  } catch {
    // Provider responses may contain tokens, phone numbers and message bodies.
    throw new Error("EVOLUTION_HISTORY_UNAVAILABLE");
  }
}
