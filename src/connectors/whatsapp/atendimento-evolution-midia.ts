import type {
  ChannelMessageMediaQuery,
  LiveChannelConfig,
} from "@/server/atendimento-provedor";
import {
  ChannelMediaError,
  validateVirtualMedia,
  virtualMediaLimit,
} from "@/server/atendimento-midia";

/** Evolution 2.3.7 getBase64FromMediaMessage loads the stored message by key.id.
 * No sender URL, media key, filename or path is accepted by this boundary.
 * https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
 */
export async function readEvolutionMessageMedia(
  config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }>,
  query: ChannelMessageMediaQuery,
) {
  if (
    !/^[\w-]{1,200}$/.test(query.providerMessageId) ||
    !["IMAGE", "AUDIO"].includes(query.kind)
  )
    throw new ChannelMediaError("MEDIA_UNAVAILABLE");
  const maximum = virtualMediaLimit(query.kind),
    base64Limit = Math.ceil(maximum / 3) * 4,
    jsonLimit = base64Limit + 65536;
  try {
    const response = await fetch(
      `${config.settings.url}/chat/getBase64FromMediaMessage/${encodeURIComponent(config.settings.instance)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.secrets.apiKey!,
        },
        body: JSON.stringify({
          message: { key: { id: query.providerMessageId } },
          convertToMp4: false,
        }),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
        cache: "no-store",
      },
    );
    if (!response.ok || !response.body)
      throw new ChannelMediaError("MEDIA_UNAVAILABLE");
    if (Number(response.headers.get("content-length")) > jsonLimit)
      throw new ChannelMediaError("MEDIA_LIMIT");
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > jsonLimit) {
        await reader.cancel();
        throw new ChannelMediaError("MEDIA_LIMIT");
      }
      parts.push(value);
    }
    const raw = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (typeof raw?.base64 !== "string")
      throw new ChannelMediaError("MEDIA_UNAVAILABLE");
    if (raw.base64.length > base64Limit)
      throw new ChannelMediaError("MEDIA_LIMIT");
    if (
      !raw.base64 ||
      raw.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(raw.base64)
    )
      throw new ChannelMediaError("MEDIA_UNAVAILABLE");
    const bytes = Buffer.from(raw.base64, "base64");
    if (bytes.toString("base64") !== raw.base64)
      throw new ChannelMediaError("MEDIA_UNAVAILABLE");
    return validateVirtualMedia(bytes, query.kind, raw.mimetype);
  } catch (error) {
    if (error instanceof ChannelMediaError) throw error;
    // Provider errors can contain access tokens, signed URLs and message content.
    throw new ChannelMediaError("MEDIA_UNAVAILABLE");
  }
}
