import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { db } from "./db";
import {
  channelRecipientHash,
  decryptChannelValue,
  type ChannelSecrets,
  type EvolutionChannelSettings,
  type MetaChannelSettings,
} from "./atendimento-credenciais";
import type {
  ChannelDelivery,
  LiveChannelConfig,
} from "./atendimento-provedor";
export async function liveChannelConfiguration(
  accountId: string,
): Promise<LiveChannelConfig> {
  const row = await db.avChannelAccount.findUnique({
    where: { id: accountId },
    include: {
      connection: true,
      store: {
        select: {
          ativa: true,
          excluidoEm: true,
          organizacao: { select: { ativa: true, excluidoEm: true } },
        },
      },
    },
  });
  if (
    !row?.connection ||
    !["EVOLUTION", "META"].includes(row.mode) ||
    !row.store.ativa ||
    row.store.excluidoEm ||
    !row.store.organizacao.ativa ||
    row.store.organizacao.excluidoEm
  )
    throw new Error("CHANNEL_UNAVAILABLE");
  const scope = {
      organizationId: row.organizationId,
      storeId: row.storeId,
      accountId: row.id,
    },
    secrets = JSON.parse(
      decryptChannelValue(scope, row.connection.encryptedCredentials),
    ) as ChannelSecrets;
  const base = {
    ...scope,
    revision: row.connection.revision,
    active: row.active,
    name: row.name,
    secrets,
  };
  return row.mode === "META"
    ? {
        ...base,
        provider: "META",
        settings: row.connection.settings as MetaChannelSettings,
      }
    : {
        ...base,
        provider: "EVOLUTION",
        settings: row.connection.settings as EvolutionChannelSettings,
      };
}
export async function channelServiceWindow(
  accountId: string,
  recipient: string,
) {
  const account = await db.avChannelAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  const recipientHash = channelRecipientHash(
    { ...account, accountId },
    recipient,
  );
  const row = await db.avChannelWindow.findUnique({
    where: { accountId_recipientHash: { accountId, recipientHash } },
  });
  return !!row && row.lastInboundAt.getTime() > Date.now() - 24 * 3600000;
}
export async function recordedChannelReceipt(
  accountId: string,
  correlationId: string,
) {
  // A provider ID still proves transport acceptance when its later delivery
  // failed. Delivery status remains authoritative in the test/outbox row.
  if (correlationId.startsWith("test:")) {
    const row = await db.avChannelTest.findFirst({
      where: { id: correlationId.slice(5), accountId },
    });
    return row?.providerId &&
      ["ACCEPTED", "DELIVERED", "READ", "FAILED"].includes(row.state)
      ? { state: "ACCEPTED" as const, providerId: row.providerId }
      : null;
  }
  const row = await db.avMessageOutbox.findFirst({
    where: { id: correlationId, accountId },
  });
  return row?.providerId &&
    ["ACCEPTED", "DELIVERED", "READ", "FAILED"].includes(row.state)
    ? { state: "ACCEPTED" as const, providerId: row.providerId }
    : null;
}
const receiptDigest = (delivery: ChannelDelivery, revision: number) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        revision,
        delivery.providerId,
        delivery.correlationId ?? null,
        delivery.recipient,
        delivery.state,
      ]),
    )
    .digest("hex");
export type ChannelDeliverySource = "WEBHOOK" | "PROVIDER_QUERY";
async function receiptConflict(
  tx: Prisma.TransactionClient,
  config: LiveChannelConfig,
  externalId: string,
  source: ChannelDeliverySource,
) {
  await tx.avAuditEvent.create({
    data: {
      organizationId: config.organizationId,
      storeId: config.storeId,
      actorId:
        source === "WEBHOOK" ? "CHANNEL_WEBHOOK" : "CHANNEL_PROVIDER_QUERY",
      action: "CHANNEL_DELIVERY_CONFLICT",
      data: { accountId: config.accountId, externalId, source },
    },
  });
}
function nextReceiptState(current: string, incoming: ChannelDelivery["state"]) {
  if (["BLOCKED", "DISCARDED", "PENDING"].includes(current)) return null;
  if (current === "READ" || (current === "DELIVERED" && incoming !== "READ"))
    return null;
  if (current === "FAILED" && !["DELIVERED", "READ"].includes(incoming))
    return null;
  return incoming;
}
async function applyStoredDelivery(
  tx: Prisma.TransactionClient,
  config: LiveChannelConfig,
  delivery: ChannelDelivery,
  source: ChannelDeliverySource,
) {
  const scope = {
    organizationId: config.organizationId,
    storeId: config.storeId,
    accountId: config.accountId,
  };
  const testCorrelation = delivery.correlationId?.startsWith("test:");
  if (!delivery.correlationId || testCorrelation) {
    const test = await tx.avChannelTest.findFirst({
      where: {
        ...scope,
        revision: config.revision,
        recipientHash: channelRecipientHash(scope, delivery.recipient),
        ...(testCorrelation
          ? { id: delivery.correlationId!.slice(5) }
          : { providerId: delivery.providerId }),
      },
    });
    if (test) {
      const linked = await tx.avChannelTest.findUnique({
        where: {
          accountId_providerId: {
            accountId: config.accountId,
            providerId: delivery.providerId,
          },
        },
        select: { id: true },
      });
      if (
        (test.providerId && test.providerId !== delivery.providerId) ||
        (linked && linked.id !== test.id)
      ) {
        await receiptConflict(tx, config, delivery.externalId, source);
        return;
      }
      const next = nextReceiptState(test.state, delivery.state);
      if (next) {
        const delivered = ["DELIVERED", "READ"].includes(next);
        await tx.avChannelTest.update({
          where: { id: test.id },
          data: {
            providerId: delivery.providerId,
            state: delivered ? "DELIVERED" : next,
            ...(next !== "FAILED"
              ? { acceptedAt: test.acceptedAt ?? new Date(), error: null }
              : { error: "PROVIDER_DELIVERY_FAILED" }),
            ...(delivered
              ? { deliveredAt: test.deliveredAt ?? new Date() }
              : {}),
          },
        });
      }
      return;
    }
  }
  if (testCorrelation) return;
  const outbox = await tx.avMessageOutbox.findFirst({
    where: {
      ...scope,
      conversation: { externalCustomerId: delivery.recipient },
      ...(delivery.correlationId
        ? { id: delivery.correlationId }
        : { providerId: delivery.providerId }),
    },
  });
  if (!outbox) return;
  const linked = await tx.avMessageOutbox.findUnique({
    where: {
      accountId_providerId: {
        accountId: config.accountId,
        providerId: delivery.providerId,
      },
    },
    select: { id: true },
  });
  if (
    (outbox.providerId && outbox.providerId !== delivery.providerId) ||
    (linked && linked.id !== outbox.id)
  ) {
    await receiptConflict(tx, config, delivery.externalId, source);
    return;
  }
  const next = nextReceiptState(outbox.state, delivery.state);
  if (!next) return;
  await tx.avMessageOutbox.update({
    where: { id: outbox.id },
    data: {
      providerId: delivery.providerId,
      state: next,
      ...(next !== "FAILED"
        ? { acceptedAt: outbox.acceptedAt ?? new Date(), error: null }
        : { error: "PROVIDER_DELIVERY_FAILED" }),
      ...(["DELIVERED", "READ"].includes(next)
        ? { deliveredAt: outbox.deliveredAt ?? new Date() }
        : {}),
    },
  });
}
/** Authenticated webhook or response to a server query bound to this account. */
export async function recordChannelDelivery(
  config: LiveChannelConfig,
  delivery: ChannelDelivery,
  source: ChannelDeliverySource = "WEBHOOK",
) {
  const scope = {
    organizationId: config.organizationId,
    storeId: config.storeId,
    accountId: config.accountId,
  };
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${config.accountId}`}))`;
    const connection = await tx.avChannelConnection.findFirst({
      where: { ...scope, account: { mode: config.provider } },
    });
    if (connection?.revision !== config.revision) return;
    if (source === "WEBHOOK")
      await tx.avChannelConnection.update({
        where: { accountId: config.accountId },
        data: { webhookSeenAt: new Date() },
      });
    const previous = await tx.avInboundEvent.findUnique({
      where: {
        accountId_externalId: {
          accountId: config.accountId,
          externalId: delivery.externalId,
        },
      },
    });
    const digest = receiptDigest(delivery, config.revision);
    if (previous) {
      if ((previous.payload as { digest?: string }).digest !== digest)
        await receiptConflict(tx, config, delivery.externalId, source);
      return;
    }
    await tx.avInboundEvent.create({
      data: {
        ...scope,
        externalId: delivery.externalId,
        type: "DELIVERY",
        senderKey: delivery.recipient,
        payload: {
          providerId: delivery.providerId,
          correlationId: delivery.correlationId ?? null,
          deliveryState: delivery.state,
          recipient: delivery.recipient,
          revision: config.revision,
          digest,
          source,
        },
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });
    if (source === "PROVIDER_QUERY")
      await tx.avAuditEvent.create({
        data: {
          organizationId: config.organizationId,
          storeId: config.storeId,
          actorId: "CHANNEL_PROVIDER_QUERY",
          action: "CHANNEL_DELIVERY_QUERY_RECORDED",
          data: {
            accountId: config.accountId,
            externalId: delivery.externalId,
            providerId: delivery.providerId,
            revision: config.revision,
            reportedState: delivery.state,
            source,
          },
        },
      });
    await applyStoredDelivery(tx, config, delivery, source);
  });
}

/** Callback may precede the send HTTP response and lack the opaque reference.
 * Reconcile only durable authenticated events from this exact revision after
 * the provider ID is associated. This never sends a message. */
export async function reconcileStoredChannelDeliveries(
  accountId: string,
  providerId: string,
) {
  const config = await liveChannelConfiguration(accountId);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${accountId}`}))`;
    const current = await tx.avChannelConnection.findUnique({
      where: { accountId },
    });
    if (current?.revision !== config.revision) return;
    const events = await tx.avInboundEvent.findMany({
      where: {
        accountId,
        organizationId: config.organizationId,
        storeId: config.storeId,
        type: "DELIVERY",
        status: "PROCESSED",
        payload: { path: ["providerId"], equals: providerId },
      },
      orderBy: { receivedAt: "asc" },
      take: 100,
    });
    for (const event of events) {
      const payload = event.payload as {
        revision?: number;
        providerId?: string;
        correlationId?: string | null;
        recipient?: string;
        deliveryState?: ChannelDelivery["state"];
        digest?: string;
        source?: ChannelDeliverySource;
      };
      if (
        payload.revision !== config.revision ||
        payload.providerId !== providerId ||
        !payload.recipient ||
        !payload.deliveryState ||
        !["ACCEPTED", "DELIVERED", "READ", "FAILED"].includes(
          payload.deliveryState,
        )
      )
        continue;
      const delivery: ChannelDelivery = {
        externalId: event.externalId,
        providerId,
        recipient: payload.recipient,
        state: payload.deliveryState,
        ...(payload.correlationId
          ? { correlationId: payload.correlationId }
          : {}),
      };
      if (payload.digest !== receiptDigest(delivery, config.revision)) continue;
      await applyStoredDelivery(
        tx,
        config,
        delivery,
        payload.source === "PROVIDER_QUERY" ? "PROVIDER_QUERY" : "WEBHOOK",
      );
    }
  });
}
