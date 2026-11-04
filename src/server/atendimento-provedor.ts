import type { AtendimentoChannelAdapter } from "./atendimento-canal";
import type {
  ChannelScope,
  ChannelSecrets,
  EvolutionChannelSettings,
  MetaChannelSettings,
} from "./atendimento-credenciais";
export type LiveChannelConfig = ChannelScope & {
  revision: number;
  name: string;
  active: boolean;
  secrets: ChannelSecrets;
} & (
    | { provider: "EVOLUTION"; settings: EvolutionChannelSettings }
    | { provider: "META"; settings: MetaChannelSettings }
  );
export type ChannelConnectionQr = {
  state: "CONNECTED" | "QR" | "CONNECTING" | "UNAVAILABLE";
  qrDataUrl: string | null;
  expiresAt: string | null;
  status: string;
};
/** Historical data never authorizes an automatic reply or opens a service window. */
export type ChannelHistoryMessage = {
  externalId: string;
  senderKey: string;
  trustedPhone: string;
  fromSelf: boolean;
  kind: "TEXT" | "AUDIO" | "IMAGE";
  text: string;
  occurredAt: string;
  transcriptionCertain: boolean;
  displayName?: string;
};
export type ChannelHistoryQuery = {
  page: number;
  pageSize: number;
  since: string;
  until: string;
};
export type ChannelHistoryPage = {
  messages: ChannelHistoryMessage[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  nextPage: number | null;
  skipped: number;
};
export type ChannelContactName = {
  name: string;
  source: "DEVICE_CONTACT" | "PROVIDER_CONTACT" | "WHATSAPP_PROFILE";
  updatedAt: string | null;
};
export type ChannelContactNamesQuery = { trustedPhone: string };
export type ChannelContactNamesResult = {
  trustedPhone: string;
  names: ChannelContactName[];
};
export interface ChannelManagement extends AtendimentoChannelAdapter {
  createInstance?(): Promise<void>;
  ensureInstance?(): Promise<void>;
  verify(): Promise<{ connected: boolean }>;
  webhook(url: string, replace: boolean): Promise<void>;
  qr(): Promise<ChannelConnectionQr>;
  readHistoryPage?(query: ChannelHistoryQuery): Promise<ChannelHistoryPage>;
  lookupContactNames?(
    query: ChannelContactNamesQuery,
  ): Promise<ChannelContactNamesResult>;
  consultDelivery?(correlationId: string): Promise<ChannelDelivery | null>;
}
export type ChannelManagementFactory = (
  accountId: string,
) => Promise<ChannelManagement>;
export type ChannelDelivery = {
  externalId: string;
  providerId: string;
  correlationId?: string;
  recipient: string;
  state: "ACCEPTED" | "DELIVERED" | "READ" | "FAILED";
};
