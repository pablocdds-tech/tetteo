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
export interface ChannelManagement extends AtendimentoChannelAdapter {
  createInstance?(): Promise<void>;
  verify(): Promise<{ connected: boolean }>;
  webhook(url: string, replace: boolean): Promise<void>;
  qr(): Promise<{
    qrDataUrl: string | null;
    expiresAt: string | null;
    status: string;
  }>;
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
