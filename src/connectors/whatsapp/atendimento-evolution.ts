import type {
  ChannelManagement,
  LiveChannelConfig,
} from "@/server/atendimento-provedor";
import type { ChannelSendResult } from "@/server/atendimento-canal";
import { channelHttp, record, string } from "./atendimento-http";
export function evolutionAttendance(
  config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }>,
  lookup?: (id: string) => Promise<{ recipient: string; sentAt: Date } | null>,
): ChannelManagement {
  const { settings, secrets } = config,
    instance = encodeURIComponent(settings.instance);
  const api = (path: string, body?: unknown) =>
    channelHttp(`${settings.url}/${path}/${instance}`, {
      method: body ? "POST" : "GET",
      headers: { apikey: secrets.apiKey!, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const recent = new Map<string, { recipient: string; sentAt: Date }>();
  return {
    identify: () => ({
      mode: "EVOLUTION",
      accountKey: config.accountId,
      revision: config.revision,
    }),
    async createInstance() {
      await channelHttp(`${settings.url}/instance/create`, {
        method: "POST",
        headers: {
          apikey: secrets.apiKey!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instanceName: settings.instance,
          integration: "WHATSAPP-BAILEYS",
          qrcode: false,
        }),
      });
    },
    async verify() {
      const response = record(await api("instance/connectionState"));
      return { connected: record(response.instance).state === "open" };
    },
    async webhook(url, replace) {
      const existing = record(await api("webhook/find"));
      const current = record(existing.webhook ?? existing);
      if (
        current.enabled &&
        typeof current.url === "string" &&
        current.url !== url &&
        !replace
      )
        throw new Error("EXISTING_WEBHOOK_CONFIRMATION_REQUIRED");
      await api("webhook/set", {
        webhook: {
          enabled: true,
          url,
          headers: { jwt_key: secrets.webhookSecret },
          byEvents: false,
          base64: false,
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "SEND_MESSAGE",
            "CONNECTION_UPDATE",
          ],
        },
      });
    },
    async qr() {
      const result = record(await api("instance/connect"));
      const base64 = string(result.base64);
      const valid =
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(base64) &&
        base64.length < 500000 &&
        Buffer.from(base64.slice("data:image/png;base64,".length), "base64")
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      return {
        qrDataUrl: valid ? base64 : null,
        expiresAt: valid ? new Date(Date.now() + 45000).toISOString() : null,
        status: valid
          ? "Leia com o número desta conta de atendimento."
          : "QR indisponível. Confira o estado da instância.",
      };
    },
    async sendText(input): Promise<ChannelSendResult> {
      if (
        !/^\+[1-9]\d{7,14}$/.test(input.recipient) ||
        !input.text.trim() ||
        input.text.length > 4000
      )
        return { state: "FAILED", error: "INVALID_MESSAGE" };
      recent.set(input.correlationId, {
        recipient: input.recipient,
        sentAt: new Date(),
      });
      try {
        const result = record(
          await api("message/sendText", {
            number: input.recipient.slice(1),
            text: `${input.text}\n\nProtocolo: SV-${input.correlationId}`,
            linkPreview: false,
          }),
        );
        const id = string(record(result.key).id);
        return id
          ? { state: "ACCEPTED", providerId: id }
          : { state: "UNCERTAIN", error: "PROVIDER_ID_MISSING" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        return /^PROVIDER_HTTP_4\d\d$/.test(message)
          ? { state: "FAILED", error: message }
          : { state: "UNCERTAIN", error: "EVOLUTION_SEND_UNCERTAIN" };
      }
    },
    async sendMedia() {
      return { state: "FAILED", error: "MEDIA_NOT_ENABLED" };
    },
    async consultStatus(correlationId) {
      const context =
        recent.get(correlationId) ?? (await lookup?.(correlationId));
      if (!context)
        return { state: "UNCERTAIN", error: "RECONCILIATION_CONTEXT_REQUIRED" };
      try {
        const result = record(
          await api("chat/findMessages", {
            where: {
              key: {
                fromMe: true,
                remoteJid: `${context.recipient.slice(1)}@s.whatsapp.net`,
              },
              messageTimestamp: {
                gte: new Date(context.sentAt.getTime() - 60000).toISOString(),
                lte: new Date(context.sentAt.getTime() + 600000).toISOString(),
              },
            },
            page: 1,
            offset: 50,
          }),
        );
        const records = record(result.messages).records;
        if (!Array.isArray(records))
          return { state: "UNCERTAIN", error: "RECEIPT_NOT_FOUND" };
        const found = records.filter((raw) => {
          const item = record(raw),
            key = record(item.key),
            message = record(item.message),
            timestamp = Number(item.messageTimestamp) * 1000;
          return (
            Number.isFinite(timestamp) &&
            timestamp >= context.sentAt.getTime() - 60000 &&
            timestamp <= context.sentAt.getTime() + 600000 &&
            key.fromMe === true &&
            key.remoteJid === `${context.recipient.slice(1)}@s.whatsapp.net` &&
            (
              string(message.conversation) ||
              string(record(message.extendedTextMessage).text)
            ).endsWith(`Protocolo: SV-${correlationId}`)
          );
        });
        return found.length === 1 && string(record(record(found[0]).key).id)
          ? {
              state: "ACCEPTED",
              providerId: string(record(record(found[0]).key).id),
            }
          : { state: "UNCERTAIN", error: "RECEIPT_NOT_FOUND" };
      } catch {
        return { state: "UNCERTAIN", error: "STATUS_UNAVAILABLE" };
      }
    },
  };
}
