import type {
  ChannelManagement,
  LiveChannelConfig,
} from "@/server/atendimento-provedor";
import type { ChannelSendResult } from "@/server/atendimento-canal";
import { channelHttp, record, string } from "./atendimento-http";
export function metaAttendance(
  config: Extract<LiveChannelConfig, { provider: "META" }>,
): ChannelManagement {
  const { settings, secrets } = config;
  const api = (path: string, body?: unknown) =>
    channelHttp(`https://graph.facebook.com/${settings.apiVersion}/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${secrets.accessToken}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return {
    identify: () => ({
      mode: "META",
      accountKey: config.accountId,
      revision: config.revision,
    }),
    async verify() {
      const result = record(
        await api(
          `${settings.phoneNumberId}?fields=id,display_phone_number,verified_name`,
        ),
      );
      return { connected: result.id === settings.phoneNumberId };
    },
    async webhook() {
      await api(`${settings.businessAccountId}/subscribed_apps`, {});
    },
    async qr() {
      return {
        qrDataUrl: null,
        expiresAt: null,
        status:
          "Configure o callback e o token de verificação no aplicativo Meta.",
      };
    },
    async sendText(input): Promise<ChannelSendResult> {
      if (
        !/^\+[1-9]\d{7,14}$/.test(input.recipient) ||
        !input.text.trim() ||
        input.text.length > 4000
      )
        return { state: "FAILED", error: "INVALID_MESSAGE" };
      try {
        const result = record(
          await api(`${settings.phoneNumberId}/messages`, {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: input.recipient.slice(1),
            type: "text",
            text: { body: input.text, preview_url: false },
            biz_opaque_callback_data: input.correlationId,
          }),
        );
        const messages = Array.isArray(result.messages) ? result.messages : [];
        const id = string(record(messages[0]).id);
        return id
          ? { state: "ACCEPTED", providerId: id }
          : { state: "UNCERTAIN", error: "PROVIDER_ID_MISSING" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        return /^PROVIDER_HTTP_4\d\d$/.test(message)
          ? { state: "FAILED", error: message }
          : { state: "UNCERTAIN", error: "META_SEND_UNCERTAIN" };
      }
    },
    async sendMedia() {
      return { state: "FAILED", error: "MEDIA_NOT_ENABLED" };
    },
    async consultStatus() {
      return {
        state: "UNCERTAIN",
        error: "Aguardando callback autenticado da Meta; não repetir envio.",
      };
    },
  };
}
