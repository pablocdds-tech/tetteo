import { createHash } from "node:crypto";
import { z } from "zod";
import { contextoDeFundo } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { ChannelSendResult } from "@/server/atendimento-canal";
import type { ChannelManagementFactory } from "@/server/atendimento-provedor";
import {
  channelRecipientHash,
  decryptChannelValue,
  encryptChannelValue,
} from "@/server/atendimento-credenciais";
import {
  authorizeVirtual,
  lockVirtualConversation,
  type VirtualTx,
} from "./virtual-runtime";
import { CrmError } from "./campaign-domain";
import { virtualGreetingPrefix } from "./virtual-greeting";
import { reconcileStoredChannelDeliveries } from "@/server/atendimento-contas";

const schema = z
  .object({
    phase: z.enum(["prepare", "send_input", "reply", "reconcile", "status"]),
    organizationId: z.string().min(1),
    storeId: z.string().min(1),
    accountId: z.string().uuid(),
    actorId: z.string().min(1),
    testerInstanceId: z.string().min(1),
    originTestId: z.string().uuid(),
    requestId: z.string().uuid(),
  })
  .strict();
export type GreetingProbeRequest = z.infer<typeof schema>;
export type GreetingProbeDependencies = {
  attestPair(
    input: GreetingProbeRequest,
  ): Promise<{ testerPhone: string; servicePhone: string; revision: number }>;
  sendInput(input: {
    testerInstanceId: string;
    recipient: string;
    text: "Oi";
    correlationId: string;
  }): Promise<ChannelSendResult>;
  managementFor: ChannelManagementFactory;
};
export type GreetingProbeStatus = {
  requestId: string;
  state: string;
  testId: string | null;
  delivered: boolean;
  observed: boolean;
  nameSource: string | null;
};
type Evidence = Record<string, unknown>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(code: string): never {
  throw new CrmError(
    code,
    "O teste de saudação não está autorizado neste estado. Nenhuma ativação foi realizada.",
    409,
  );
}
const scope = (r: GreetingProbeRequest) => ({
  organizationId: r.organizationId,
  storeId: r.storeId,
  accountId: r.accountId,
});
const findEvidence = (tx: VirtualTx, r: GreetingProbeRequest, action: string) =>
  tx.avAuditEvent.findFirst({
    where: {
      organizationId: r.organizationId,
      storeId: r.storeId,
      action: `GREETING_PROBE_${action}`,
      AND: [
        { data: { path: ["accountId"], equals: r.accountId } },
        { data: { path: ["requestId"], equals: r.requestId } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
const audit = (
  tx: VirtualTx,
  r: GreetingProbeRequest,
  action: string,
  data: Evidence = {},
) =>
  tx.avAuditEvent.create({
    data: {
      organizationId: r.organizationId,
      storeId: r.storeId,
      actorId: r.actorId,
      action: `GREETING_PROBE_${action}`,
      data: JSON.parse(
        JSON.stringify({ ...scope(r), requestId: r.requestId, ...data }),
      ),
    },
  });
const lock = (tx: VirtualTx, r: GreetingProbeRequest) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:greeting-probe:${r.accountId}:${r.requestId}`}))`;

async function authorize(
  r: GreetingProbeRequest,
  deps: GreetingProbeDependencies,
) {
  const ctx = await contextoDeFundo(r.actorId, r.storeId);
  const actor = await db.usuario.findFirst({
    where: { id: r.actorId, status: "ATIVO", excluidoEm: null },
    select: { id: true },
  });
  if (!ctx || !actor || ctx.organizacao.id !== r.organizationId)
    fail("PROBE_FORBIDDEN");
  await authorizeVirtual(ctx, r.storeId, true, true);
  const pair = await deps.attestPair(r);
  if (
    !/^\+[1-9]\d{7,14}$/.test(pair.testerPhone) ||
    !/^\+[1-9]\d{7,14}$/.test(pair.servicePhone) ||
    pair.testerPhone === pair.servicePhone
  )
    fail("PROBE_PAIR_INVALID");
  const account = await db.avChannelAccount.findFirst({
    where: {
      id: r.accountId,
      organizationId: r.organizationId,
      storeId: r.storeId,
      mode: "EVOLUTION",
      active: false,
    },
    include: { connection: true },
  });
  if (
    !account?.connection ||
    account.connection.revision !== pair.revision ||
    account.connection.verifiedRevision !== pair.revision ||
    account.connection.connectionState !== "VERIFIED" ||
    !account.connection.verifiedAt
  )
    fail("PROBE_CHANNEL_NOT_PAUSED");
  const prior = await db.avChannelTest.findFirst({
    where: {
      ...scope(r),
      id: r.originTestId,
      revision: pair.revision,
      state: "DELIVERED",
      deliveredAt: { not: null },
      observedAt: { not: null },
    },
  });
  if (
    !prior ||
    decryptChannelValue(scope(r), prior.encryptedRecipient) !==
      pair.testerPhone ||
    prior.recipientHash !== channelRecipientHash(scope(r), pair.testerPhone)
  )
    fail("PROBE_ORIGIN_REQUIRED");
  return pair;
}

async function status(r: GreetingProbeRequest): Promise<GreetingProbeStatus> {
  const claim = await findEvidence(db, r, "REPLY_CLAIMED");
  const data = claim?.data as Evidence | undefined;
  const test =
    typeof data?.testId === "string"
      ? await db.avChannelTest.findFirst({
          where: { ...scope(r), id: data.testId },
        })
      : null;
  const input = await findEvidence(db, r, "INPUT_RESULT");
  const inputClaim = input ? null : await findEvidence(db, r, "INPUT_CLAIMED");
  return {
    requestId: r.requestId,
    state:
      test?.state ??
      (input
        ? String((input.data as Evidence).state)
        : inputClaim
          ? "INPUT_UNCERTAIN"
          : "PREPARED"),
    testId: test?.id ?? null,
    delivered: !!test?.deliveredAt,
    observed: !!test?.observedAt,
    nameSource: typeof data?.nameSource === "string" ? data.nameSource : null,
  };
}

/** Private diagnostic only. Never runs the general queue, changes active, or consumes messages. */
export async function runVirtualGreetingProbe(
  raw: unknown,
  deps: GreetingProbeDependencies,
): Promise<GreetingProbeStatus> {
  const r = schema.parse(raw),
    pair = await authorize(r, deps);
  const binding = {
    actorId: r.actorId,
    testerInstanceId: r.testerInstanceId,
    originTestId: r.originTestId,
    revision: pair.revision,
    testerHash: channelRecipientHash(scope(r), pair.testerPhone),
    serviceHash: channelRecipientHash(scope(r), pair.servicePhone),
  };
  let prepared = await findEvidence(db, r, "PREPARED");
  if (r.phase === "prepare") {
    await db.$transaction(async (tx) => {
      await lock(tx, r);
      if (await findEvidence(tx, r, "PREPARED")) return;
      await audit(tx, r, "PREPARED", {
        ...binding,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });
    });
    prepared = await findEvidence(db, r, "PREPARED");
  }
  const evidence = prepared?.data as Evidence | undefined;
  if (
    !prepared ||
    hash(binding) !==
      hash(
        Object.fromEntries(Object.keys(binding).map((k) => [k, evidence?.[k]])),
      )
  )
    fail("PROBE_BINDING_CHANGED");
  if (r.phase === "status" || r.phase === "prepare") return status(r);
  if (
    r.phase !== "reconcile" &&
    (typeof evidence?.expiresAt !== "string" ||
      new Date(evidence.expiresAt).getTime() <= Date.now())
  ) {
    const prior = await findEvidence(
      db,
      r,
      r.phase === "reply" ? "REPLY_CLAIMED" : "INPUT_CLAIMED",
    );
    if (prior) return status(r);
    fail("PROBE_EXPIRED");
  }
  if (r.phase === "send_input") {
    const fresh = await db.$transaction(async (tx) => {
      await lock(tx, r);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${r.accountId}`}))`;
      if (await findEvidence(tx, r, "INPUT_CLAIMED")) return false;
      const attempts = await tx.avAuditEvent.count({
        where: {
          organizationId: r.organizationId,
          storeId: r.storeId,
          action: "GREETING_PROBE_INPUT_CLAIMED",
          createdAt: { gte: new Date(Date.now() - 3600000) },
          data: { path: ["accountId"], equals: r.accountId },
        },
      });
      if (attempts >= 3) fail("TEST_RATE_LIMIT");
      await audit(tx, r, "INPUT_CLAIMED");
      return true;
    });
    if (fresh) {
      let result: ChannelSendResult;
      try {
        const freshPair = await authorize(r, deps);
        if (
          freshPair.revision !== pair.revision ||
          freshPair.testerPhone !== pair.testerPhone ||
          freshPair.servicePhone !== pair.servicePhone ||
          new Date(String(evidence!.expiresAt)).getTime() <= Date.now()
        )
          fail("PROBE_PAIR_CHANGED");
        result = await deps.sendInput({
          testerInstanceId: r.testerInstanceId,
          recipient: pair.servicePhone,
          text: "Oi",
          correlationId: r.requestId,
        });
      } catch {
        result = { state: "UNCERTAIN", error: "PROBE_INPUT_UNCERTAIN" };
      }
      await audit(db, r, "INPUT_RESULT", {
        state: result.state,
        ...(result.state === "ACCEPTED"
          ? { providerId: result.providerId }
          : {}),
      });
    }
    return status(r);
  }
  const adapter = await deps.managementFor(r.accountId),
    identity = adapter.identify();
  if (
    identity.mode !== "EVOLUTION" ||
    identity.accountKey !== r.accountId ||
    identity.revision !== pair.revision
  )
    fail("PROBE_ADAPTER_CHANGED");
  if (r.phase === "reconcile") {
    const current = await status(r);
    if (current.testId) {
      const test = await db.avChannelTest.findFirst({
        where: { ...scope(r), id: current.testId },
      });
      if (test?.providerId)
        await reconcileStoredChannelDeliveries(r.accountId, test.providerId);
      if (!(await status(r)).delivered)
        await adapter.consultStatus(`test:${current.testId}`);
    }
    return status(r);
  }
  const previous = await status(r);
  if (previous.testId) return previous;
  const inputClaim = await findEvidence(db, r, "INPUT_CLAIMED");
  if (!inputClaim) fail("PROBE_INPUT_REQUIRED");
  const inputResult = await findEvidence(db, r, "INPUT_RESULT");
  const expectedId = (inputResult?.data as Evidence | undefined)?.providerId;
  const messages = await db.avMessage.findMany({
    where: {
      ...scope(r),
      source: "LIVE",
      author: "CUSTOMER",
      direction: "INBOUND",
      processedAt: null,
      text: `Oi\n\nProtocolo: SV-${r.requestId}`,
      ...(typeof expectedId === "string"
        ? { externalId: `message:${expectedId}` }
        : {}),
      createdAt: {
        gte: new Date(inputClaim.createdAt.getTime() - 1000),
        lte: new Date(String(evidence!.expiresAt)),
      },
      conversation: { externalCustomerId: pair.testerPhone },
    },
    take: 2,
  });
  if (messages.length !== 1 || !messages[0].externalId)
    fail("PROBE_INPUT_NOT_UNIQUE");
  const message = messages[0],
    externalId = messages[0].externalId!;
  const inbound = await db.avInboundEvent.findFirst({
    where: {
      ...scope(r),
      externalId,
      type: "MESSAGE",
      status: "PROCESSED",
      senderKey: pair.testerPhone,
      receivedAt: { gte: inputClaim.createdAt },
    },
  });
  const payload = inbound?.payload as Evidence | undefined;
  if (
    !inbound ||
    payload?.fromSelf !== false ||
    payload?.group !== false ||
    payload?.text !== message.text
  )
    fail("PROBE_INPUT_NOT_AUTHENTIC");
  const readConversation = async (tx: VirtualTx) => {
    const c = await tx.avConversation.findFirst({
      where: {
        ...scope(r),
        id: message.conversationId,
        externalCustomerId: pair.testerPhone,
      },
    });
    const last = await tx.avMessage.findFirst({
      where: { ...scope(r), conversationId: message.conversationId },
      orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
      select: { id: true },
    });
    if (
      !c ||
      last?.id !== message.id ||
      c.assignedToId ||
      c.optedOut ||
      c.leaseOwner ||
      !["OPEN", "WAITING_CUSTOMER"].includes(c.status) ||
      !c.nameUsableForReservation ||
      c.nameNeedsConfirmation ||
      c.nameLookupRevision !== pair.revision
    )
      fail("PROBE_CONVERSATION_CHANGED");
    if (
      (await tx.avAgentPause.count({
        where: {
          conversationId: c.id,
          OR: [{ resumedAt: null }, { createdAt: { gte: inbound.receivedAt } }],
        },
      })) ||
      (await tx.avEscalation.count({
        where: { conversationId: c.id, status: { not: "RESOLVED" } },
      })) ||
      (await tx.avMessageOutbox.count({
        where: { conversationId: c.id, createdAt: { gte: message.createdAt } },
      }))
    )
      fail("PROBE_HUMAN_CONTROL");
    if (
      await tx.avInboundEvent.count({
        where: {
          ...scope(r),
          type: "MESSAGE",
          receivedAt: { gte: inbound.receivedAt },
          OR: [
            { senderKey: pair.testerPhone },
            { senderKey: { startsWith: "unresolved:" } },
          ],
          AND: [
            { payload: { path: ["fromSelf"], equals: true } },
            { payload: { path: ["group"], equals: false } },
          ],
        },
      })
    )
      fail("PROBE_HUMAN_REPLY");
    const prefix = virtualGreetingPrefix(c.displayName, true);
    if (!prefix) fail("PROBE_NAME_UNAVAILABLE");
    return {
      conversation: c,
      text: `${prefix}Sou a Severina. Este é um teste de saudação entre os números da operação.`,
    };
  };
  const created = await db.$transaction(async (tx) => {
    await lock(tx, r);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:account:${r.accountId}`}))`;
    await lockVirtualConversation(tx, message.conversationId);
    if (await findEvidence(tx, r, "REPLY_CLAIMED")) return null;
    const account = await tx.avChannelAccount.findFirst({
      where: {
        organizationId: r.organizationId,
        storeId: r.storeId,
        id: r.accountId,
        active: false,
        connection: {
          is: {
            revision: pair.revision,
            verifiedRevision: pair.revision,
            connectionState: "VERIFIED",
          },
        },
      },
      select: { id: true },
    });
    if (!account) fail("PROBE_CHANNEL_CHANGED");
    const checked = await readConversation(tx);
    if (
      (await tx.avChannelTest.count({
        where: {
          accountId: r.accountId,
          createdAt: { gte: new Date(Date.now() - 3600000) },
        },
      })) >= 3
    )
      fail("TEST_RATE_LIMIT");
    const test = await tx.avChannelTest.create({
      data: {
        ...scope(r),
        actorId: r.actorId,
        requestId: r.requestId,
        revision: pair.revision,
        recipientHash: binding.testerHash,
        encryptedRecipient: encryptChannelValue(scope(r), pair.testerPhone),
      },
    });
    await audit(tx, r, "REPLY_CLAIMED", {
      testId: test.id,
      inboundMessageId: message.id,
      conversationId: message.conversationId,
      version: checked.conversation.version,
      nameSource: checked.conversation.nameSource,
      nameHash: hash(checked.conversation.displayName),
    });
    const consumed = await tx.avMessage.updateMany({
      where: {
        ...scope(r),
        id: message.id,
        externalId: message.externalId,
        processedAt: null,
        source: "LIVE",
        conversation: { version: checked.conversation.version },
      },
      data: { processedAt: new Date() },
    });
    if (consumed.count)
      await audit(tx, r, "INPUT_CONSUMED", {
        messageId: message.id,
        conversationId: message.conversationId,
        version: checked.conversation.version,
      });
    return { test, ...checked };
  });
  if (!created) return status(r);
  // Recheck the exact snapshot immediately before dispatch; a timeout never resends.
  try {
    const freshPair = await authorize(r, deps);
    const checked = await readConversation(db);
    if (
      freshPair.revision !== pair.revision ||
      freshPair.testerPhone !== pair.testerPhone ||
      freshPair.servicePhone !== pair.servicePhone ||
      new Date(String(evidence!.expiresAt)).getTime() <= Date.now() ||
      checked.conversation.version !== created.conversation.version ||
      checked.text !== created.text
    )
      fail("PROBE_CONVERSATION_CHANGED");
  } catch {
    await db.avChannelTest.updateMany({
      where: { id: created.test.id, state: "SENDING" },
      data: { state: "FAILED", error: "PROBE_DISPATCH_FENCED" },
    });
    await audit(db, r, "REPLY_BLOCKED", { testId: created.test.id });
    return status(r);
  }
  let result: ChannelSendResult;
  try {
    result = await adapter.sendText({
      recipient: pair.testerPhone,
      text: created.text,
      correlationId: `test:${created.test.id}`,
    });
  } catch {
    result = { state: "UNCERTAIN", error: "PROBE_REPLY_UNCERTAIN" };
  }
  await db.avChannelTest.updateMany({
    where: { id: created.test.id, state: "SENDING" },
    data:
      result.state === "ACCEPTED"
        ? {
            state: "ACCEPTED",
            providerId: result.providerId,
            acceptedAt: new Date(),
          }
        : {
            state: result.state,
            error:
              result.state === "FAILED"
                ? "PROBE_REPLY_FAILED"
                : "PROBE_REPLY_UNCERTAIN",
          },
  });
  if (result.state === "ACCEPTED")
    await reconcileStoredChannelDeliveries(r.accountId, result.providerId);
  await audit(db, r, "REPLY_RESULT", {
    testId: created.test.id,
    state: result.state,
  });
  return status(r);
}
