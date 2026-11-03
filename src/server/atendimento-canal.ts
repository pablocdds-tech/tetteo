import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type ChannelSendResult =
  | { state: "ACCEPTED"; providerId: string }
  | { state: "UNCERTAIN" | "FAILED"; error: string };
export interface AtendimentoChannelAdapter {
  identify(): {
    mode: "DEMO" | "EVOLUTION" | "META";
    accountKey: string;
    revision?: number;
  };
  sendText(input: {
    recipient: string;
    text: string;
    correlationId: string;
  }): Promise<ChannelSendResult>;
  sendMedia(input: {
    recipient: string;
    mediaId: string;
    correlationId: string;
  }): Promise<ChannelSendResult>;
  consultStatus(correlationId: string): Promise<ChannelSendResult>;
}
export const isDemoRecipient = (value: string) =>
  /^demo:[a-z0-9_-]{1,80}$/.test(value);
/** O adaptador informa o país; números internacionais nunca recebem +55 à força. */
export function normalizeChannelPhone(
  value: string,
  defaultCountry = "55",
): string {
  const compact = value.trim().replace(/[\s().-]/g, "");
  let normalized = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (!normalized.startsWith("+")) {
    if (defaultCountry !== "55" || !/^\d{10,11}$/.test(normalized))
      throw new Error("Informe o telefone com código internacional.");
    normalized = `+55${normalized}`;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(normalized))
    throw new Error("Telefone internacional inválido.");
  return normalized;
}
export function demoChannel(accountKey: string): AtendimentoChannelAdapter {
  const accepted = (id: string): ChannelSendResult => ({
    state: "ACCEPTED",
    providerId: `demo:${createHash("sha256").update(`${accountKey}:${id}`).digest("hex")}`,
  });
  return {
    identify: () => ({ mode: "DEMO", accountKey }),
    async sendText(input) {
      if (!isDemoRecipient(input.recipient))
        return {
          state: "FAILED",
          error: "Demonstração recusa destinatário real.",
        };
      if (!input.text.trim() || input.text.length > 4000)
        return { state: "FAILED", error: "Mensagem vazia ou acima do limite." };
      return accepted(input.correlationId);
    },
    async sendMedia() {
      return {
        state: "FAILED",
        error:
          "Upload de mídia não habilitado na demonstração. Use o catálogo autorizado.",
      };
    },
    async consultStatus(id) {
      return accepted(id);
    },
  };
}
export function verifyChannelSignature(
  body: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature))
    return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export function maskVirtualSecrets(text: string): string {
  return text
    .replace(
      /\b(?:senha|password|token|api[_ -]?key|segredo)\s*(?::|=|é|is)\s*\S+/gi,
      "[credencial removida]",
    )
    .replace(/\bBearer\s+[\w.-]+/gi, "[credencial removida]")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})/g,
      "[credencial removida]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[credencial removida]",
    );
}
