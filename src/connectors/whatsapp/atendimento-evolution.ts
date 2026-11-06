import type {
  ChannelDelivery,
  ChannelManagement,
  LiveChannelConfig,
} from "@/server/atendimento-provedor";
import { createHash } from "node:crypto";
import type { ChannelSendResult } from "@/server/atendimento-canal";
import { channelHttp, record, string } from "./atendimento-http";
import { readEvolutionHistoryPage } from "./atendimento-evolution-historico";
import { lookupEvolutionContactNames } from "./atendimento-evolution-contatos";
import { readEvolutionMessageMedia } from "./atendimento-evolution-midia";
export function evolutionAttendance(
  config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }>,
  lookup?: (id: string) => Promise<{
    recipient: string;
    sentAt: Date;
    providerId?: string;
  } | null>,
): ChannelManagement {
  const { settings, secrets } = config,
    instance = encodeURIComponent(settings.instance);
  const api = (path: string, body?: unknown) =>
    channelHttp(`${settings.url}/${path}/${instance}`, {
      method: body ? "POST" : "GET",
      headers: { apikey: secrets.apiKey!, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const recent = new Map<
    string,
    { recipient: string; sentAt: Date; providerId?: string }
  >();
  type FoundReceipt = {
    item: Record<string, unknown>;
    providerId: string;
    recipient: string;
  };
  type ReceiptLookup =
    { found: FoundReceipt; error?: never } | { found: null; error: string };
  const pendingQueries = new Map<string, Promise<ReceiptLookup>>();
  const findOutgoing = async (
    correlationId: string,
  ): Promise<ReceiptLookup> => {
    const pending = pendingQueries.get(correlationId);
    if (pending) return pending;
    const query = (async (): Promise<ReceiptLookup> => {
      try {
        const context =
          recent.get(correlationId) ?? (await lookup?.(correlationId));
        if (
          !context ||
          !/^\+[1-9]\d{7,14}$/.test(context.recipient) ||
          !Number.isFinite(context.sentAt.getTime()) ||
          !/^(?:test:)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            correlationId,
          )
        )
          return { found: null, error: "RECONCILIATION_CONTEXT_REQUIRED" };
        const result = record(
          await api("chat/findMessages", {
            where: {
              key: {
                fromMe: true,
                remoteJid: `${context.recipient.slice(1)}@s.whatsapp.net`,
                ...(context.providerId ? { id: context.providerId } : {}),
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
        if (!Array.isArray(records) || records.length > 50)
          return { found: null, error: "RECEIPT_NOT_FOUND" };
        const found = records.map(record).filter((item) => {
          const key = record(item.key),
            message = record(item.message),
            timestamp = Number(item.messageTimestamp) * 1000,
            providerId = string(key.id);
          return (
            Number.isFinite(timestamp) &&
            timestamp >= context.sentAt.getTime() - 60000 &&
            timestamp <= context.sentAt.getTime() + 600000 &&
            key.fromMe === true &&
            key.remoteJid === `${context.recipient.slice(1)}@s.whatsapp.net` &&
            /^[^\s\x00-\x1f\x7f]{1,200}$/.test(providerId) &&
            (!context.providerId || providerId === context.providerId) &&
            (
              string(message.conversation) ||
              string(record(message.extendedTextMessage).text)
            ).endsWith(`Protocolo: SV-${correlationId}`)
          );
        });
        return found.length === 1
          ? {
              found: {
                item: found[0],
                providerId: string(record(found[0].key).id),
                recipient: context.recipient,
              },
            }
          : { found: null, error: "RECEIPT_NOT_FOUND" };
      } catch {
        return { found: null, error: "STATUS_UNAVAILABLE" };
      }
    })();
    pendingQueries.set(correlationId, query);
    try {
      return await query;
    } finally {
      if (pendingQueries.get(correlationId) === query)
        pendingQueries.delete(correlationId);
    }
  };
  const createInstance = async () => {
    const response = record(
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
      }),
    );
    if (response.error === true)
      throw new Error("EVOLUTION_INSTANCE_CREATE_FAILED");
  };
  return {
    identify: () => ({
      mode: "EVOLUTION",
      accountKey: config.accountId,
      revision: config.revision,
    }),
    createInstance,
    readHistoryPage: (query) => readEvolutionHistoryPage(config, query),
    readMessageMedia: (query) => readEvolutionMessageMedia(config, query),
    lookupContactNames: (query) => lookupEvolutionContactNames(config, query),
    async ensureInstance() {
      try {
        const response = record(await api("instance/connectionState"));
        if (
          response.error === true ||
          !["open", "connecting", "close"].includes(
            string(record(response.instance).state),
          )
        )
          throw new Error("EVOLUTION_INSTANCE_STATE_UNAVAILABLE");
      } catch (error) {
        // Only a definite absence authorizes creation. Timeouts are reconciled by
        // another state lookup on the next explicit request, never a blind POST.
        if (!(error instanceof Error) || error.message !== "PROVIDER_HTTP_404")
          throw error;
        await createInstance();
      }
    },
    async verify() {
      const response = record(await api("instance/connectionState"));
      if (response.error === true)
        throw new Error("EVOLUTION_CONNECTION_REJECTED");
      return { connected: record(response.instance).state === "open" };
    },
    async webhook(url, replace) {
      const existing = record(await api("webhook/find"));
      const current = record(existing.webhook ?? existing);
      if (existing.error === true || current.error === true)
        throw new Error("EVOLUTION_WEBHOOK_LOOKUP_REJECTED");
      if (
        typeof current.url === "string" &&
        current.url.trim() &&
        current.url !== url &&
        !replace
      )
        throw new Error("EXISTING_WEBHOOK_CONFIRMATION_REQUIRED");
      const applied = record(
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
        }),
      );
      if (applied.error === true)
        throw new Error("EVOLUTION_WEBHOOK_SET_REJECTED");
    },
    async qr() {
      const result = record(await api("instance/connect"));
      if (result.error === true) throw new Error("EVOLUTION_QR_REJECTED");
      const state = string(record(result.instance).state);
      if (state === "open")
        return {
          state: "CONNECTED",
          qrDataUrl: null,
          expiresAt: null,
          status:
            "Número conectado. A ativação do atendimento é feita depois do teste.",
        };
      const base64 = string(result.base64);
      const valid =
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(base64) &&
        base64.length < 500000 &&
        Buffer.from(base64.slice("data:image/png;base64,".length), "base64")
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      return {
        state: valid
          ? "QR"
          : state === "connecting"
            ? "CONNECTING"
            : "UNAVAILABLE",
        qrDataUrl: valid ? base64 : null,
        expiresAt: valid ? new Date(Date.now() + 45000).toISOString() : null,
        status: valid
          ? "Leia com o número desta conta de atendimento."
          : state === "connecting"
            ? "Preparando a conexão. Aguarde alguns segundos."
            : "O QR ainda não ficou pronto. Tente gerar um novo código em alguns segundos.",
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
        if (id) recent.get(input.correlationId)!.providerId = id;
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
      const result = await findOutgoing(correlationId);
      return result.found
        ? { state: "ACCEPTED", providerId: result.found.providerId }
        : { state: "UNCERTAIN", error: result.error };
    },
    async consultDelivery(correlationId): Promise<ChannelDelivery | null> {
      const result = await findOutgoing(correlationId);
      if (!result.found) return null;
      const { item, providerId, recipient } = result.found;
      // MessageUpdate belongs to this exact outgoing message. Its remoteJid may
      // be a LID; phone attribution comes only from the validated parent PN.
      const statuses = new Set(
        (Array.isArray(item.MessageUpdate) ? item.MessageUpdate : []).map(
          (update) => record(update).status,
        ),
      );
      const state: ChannelDelivery["state"] =
        statuses.has("READ") || statuses.has("PLAYED")
          ? "READ"
          : statuses.has("DELIVERY_ACK")
            ? "DELIVERED"
            : statuses.has("ERROR")
              ? "FAILED"
              : "ACCEPTED";
      const digest = createHash("sha256")
        .update(
          JSON.stringify([
            config.revision,
            correlationId,
            providerId,
            recipient,
            state,
          ]),
        )
        .digest("hex");
      return {
        externalId: `query:${digest}`,
        providerId,
        correlationId,
        recipient,
        state,
      };
    },
  };
}
