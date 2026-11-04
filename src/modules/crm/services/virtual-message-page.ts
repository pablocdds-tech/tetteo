import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { VirtualMessagesPage } from "../virtual-types";
import { authorizeVirtual } from "./virtual-runtime";
import { CrmError } from "./campaign-domain";

const cursorSchema = z
  .object({ at: z.iso.datetime(), sequence: z.number().int().positive() })
  .strict();
export function virtualMessageCursor(message: {
  createdAt: Date;
  sequence: number;
}) {
  return Buffer.from(
    JSON.stringify({
      at: message.createdAt.toISOString(),
      sequence: message.sequence,
    }),
  ).toString("base64url");
}

export async function getVirtualMessagePage(
  context: ContextoSessao,
  storeId: string,
  conversationId: string,
  before: string,
): Promise<VirtualMessagesPage> {
  const scope = await authorizeVirtual(context, storeId);
  const conversation = await db.avConversation.findFirst({
    where: {
      id: conversationId,
      organizationId: scope.organizationId,
      storeId,
    },
    select: { accountId: true },
  });
  if (!conversation)
    throw new CrmError(
      "NOT_FOUND",
      "Conversa indisponível nesta unidade.",
      404,
    );
  let cursor: z.infer<typeof cursorSchema>;
  try {
    z.string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/)
      .parse(before);
    cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(before, "base64url").toString("utf8")),
    );
  } catch {
    throw new CrmError(
      "INVALID_CURSOR",
      "Atualize a conversa para carregar o histórico anterior.",
      400,
    );
  }
  const full = {
    organizationId: scope.organizationId,
    storeId,
    accountId: conversation.accountId,
    conversationId,
  };
  const rows = await db.avMessage.findMany({
    where: {
      ...full,
      OR: [
        { createdAt: { lt: new Date(cursor.at) } },
        { createdAt: new Date(cursor.at), sequence: { lt: cursor.sequence } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
    take: 201,
  });
  const page = rows.slice(0, 200);
  const outgoingIds = page
    .filter(
      (message) =>
        message.direction === "OUTBOUND" &&
        message.source === "LIVE" &&
        message.externalId,
    )
    .map((message) => message.externalId!);
  const receipts = outgoingIds.length
    ? await db.avMessageOutbox.findMany({
        where: { ...full, providerId: { in: outgoingIds } },
        select: { providerId: true, state: true },
      })
    : [];
  return {
    messages: page.reverse().map((message) => ({
      id: message.id,
      text: message.text,
      direction: message.direction,
      author: message.author,
      kind: message.kind,
      source: message.source as "LIVE" | "HISTORY",
      status:
        message.source === "HISTORY"
          ? "HISTORY"
          : message.direction === "INBOUND"
            ? "RECEIVED"
            : (receipts.find(
                (receipt) => receipt.providerId === message.externalId,
              )?.state ?? "ACCEPTED"),
      createdAt: message.createdAt.toISOString(),
    })),
    olderCursor: rows.length > 200 ? virtualMessageCursor(rows[199]) : null,
  };
}
