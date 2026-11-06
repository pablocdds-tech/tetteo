import { db } from "@/server/db";
import {
  demoChannel,
  type ChannelSendResult,
} from "@/server/atendimento-canal";
import {
  liveChannelConfiguration,
  recordedChannelReceipt,
  channelServiceWindow,
  recordChannelDelivery,
} from "@/server/atendimento-contas";
import {
  decryptChannelValue,
  acceptedEvolutionUrl,
  reservedEvolutionInstance,
} from "@/server/atendimento-credenciais";
import { privateVirtualModelConfiguration } from "@/server/ia/modelo-atendimento-config";
import type { ChannelManagementFactory } from "@/server/atendimento-provedor";
import type { VirtualChannelFactory } from "@/modules/crm/services/virtual-runtime";
import { approvedVirtualKnowledge } from "@/modules/crm/services/virtual-knowledge";
import { metaAttendance } from "@/connectors/whatsapp/atendimento-meta";
import { evolutionAttendance } from "@/connectors/whatsapp/atendimento-evolution";

export const managementFor: ChannelManagementFactory = async (accountId) => {
  const config = await liveChannelConfiguration(accountId);
  if (
    config.provider === "EVOLUTION" &&
    (!acceptedEvolutionUrl(config.settings.url) ||
      reservedEvolutionInstance(config.settings.url, config.settings.instance))
  )
    throw new Error("CHANNEL_ORIGIN_REVOKED");
  const adapter =
    config.provider === "META"
      ? metaAttendance(config)
      : evolutionAttendance(config, async (id) => {
          if (id.startsWith("test:")) {
            const test = await db.avChannelTest.findFirst({
              where: { id: id.slice(5), accountId, revision: config.revision },
            });
            return test
              ? {
                  recipient: decryptChannelValue(
                    config,
                    test.encryptedRecipient,
                  ),
                  sentAt: test.createdAt,
                  ...(test.providerId ? { providerId: test.providerId } : {}),
                }
              : null;
          }
          const out = await db.avMessageOutbox.findFirst({
            where: { id, accountId },
            include: { conversation: { select: { externalCustomerId: true } } },
          });
          return out
            ? {
                recipient: out.conversation.externalCustomerId,
                sentAt: out.createdAt,
                ...(out.providerId ? { providerId: out.providerId } : {}),
              }
            : null;
        });
  const guard = async () => {
    const row = await db.avChannelConnection.findUnique({
      where: { accountId },
    });
    return row?.revision === config.revision;
  };
  return {
    ...adapter,
    ...(adapter.readMessageMedia
      ? {
          async readMessageMedia(
            query: Parameters<NonNullable<typeof adapter.readMessageMedia>>[0],
          ) {
            if (!(await guard()))
              throw new Error("CHANNEL_CONFIGURATION_CHANGED");
            const media = await adapter.readMessageMedia!(query);
            if (!(await guard()))
              throw new Error("CHANNEL_CONFIGURATION_CHANGED");
            return media;
          },
        }
      : {}),
    async sendText(input) {
      if (!(await guard()))
        return { state: "FAILED", error: "CHANNEL_CONFIGURATION_CHANGED" };
      return adapter.sendText(input);
    },
    async consultStatus(id) {
      const recorded = await recordedChannelReceipt(accountId, id);
      if (!(await guard()))
        return { state: "UNCERTAIN", error: "CHANNEL_CONFIGURATION_CHANGED" };
      if (adapter.consultDelivery) {
        try {
          const delivery = await adapter.consultDelivery(id);
          if (!(await guard()))
            return {
              state: "UNCERTAIN",
              error: "CHANNEL_CONFIGURATION_CHANGED",
            };
          if (delivery) {
            await recordChannelDelivery(config, delivery, "PROVIDER_QUERY");
            return (
              (await recordedChannelReceipt(accountId, id)) ?? {
                state: "UNCERTAIN",
                error: "RECEIPT_NOT_CORRELATED",
              }
            );
          }
        } catch {
          // A failed lookup does not erase an already accepted transmission.
        }
        return recorded ?? { state: "UNCERTAIN", error: "STATUS_UNAVAILABLE" };
      }
      return recorded ?? adapter.consultStatus(id);
    },
  };
};
export const channelFor: VirtualChannelFactory = async (accountId) => {
  const account = await db.avChannelAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  if (account.mode === "DEMO") return demoChannel(accountId);
  const config = await liveChannelConfiguration(accountId),
    adapter = await managementFor(accountId);
  const ready = async (
    recipient: string,
    correlationId: string,
  ): Promise<ChannelSendResult | null> => {
    const current = await db.avChannelAccount.findUnique({
      where: { id: accountId },
      include: { connection: true },
    });
    if (
      !current?.active ||
      current.connection?.revision !== config.revision ||
      current.connection?.verifiedRevision !== config.revision ||
      current.connection?.connectionState !== "VERIFIED"
    )
      return { state: "FAILED", error: "CHANNEL_NOT_ACTIVE" };
    const outgoing = await db.avMessageOutbox.findFirst({
      where: {
        id: correlationId,
        accountId,
        conversation: { externalCustomerId: recipient },
      },
      select: { author: true },
    });
    if (!outgoing)
      return { state: "FAILED", error: "OUTBOX_CORRELATION_REQUIRED" };
    if (outgoing.author !== "HUMAN") {
      const model = await privateVirtualModelConfiguration(config);
      if (!model.enabled || !model.configured)
        return { state: "FAILED", error: "MODEL_CONFIGURATION_MISSING" };
      if (
        !(await db.$transaction((tx) =>
          approvedVirtualKnowledge(tx, config, new Date()),
        ))
      )
        return { state: "FAILED", error: "KNOWLEDGE_NOT_CURRENT" };
    }
    if (
      config.provider === "META" &&
      !(await channelServiceWindow(accountId, recipient))
    )
      return { state: "FAILED", error: "CUSTOMER_WINDOW_EXPIRED" };
    return null;
  };
  return {
    ...adapter,
    async sendText(input) {
      return (
        (await ready(input.recipient, input.correlationId)) ??
        adapter.sendText(input)
      );
    },
    async sendMedia() {
      return { state: "FAILED", error: "MEDIA_NOT_ENABLED" };
    },
  };
};
