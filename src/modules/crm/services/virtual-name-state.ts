import type { AvConversation, Prisma } from "@prisma/client";
import { z } from "zod";
import { safeVirtualCustomerName } from "@/server/atendimento-nome";
import type { ChannelContactName } from "@/server/atendimento-provedor";
import { resolveVirtualCustomerName } from "./virtual-customer-name";

const hint = z.object({
  name: z.string(),
  updatedAt: z.string().datetime().nullable(),
});
const cacheSchema = z.object({
  contact: hint
    .extend({ source: z.enum(["DEVICE_CONTACT", "PROVIDER_CONTACT"]) })
    .optional(),
  profile: hint.optional(),
});
type NameCache = z.infer<typeof cacheSchema>;
export function virtualNameCache(value: unknown): NameCache {
  const parsed = cacheSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
const safeTime = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) &&
    date.getTime() <= Date.now() + 300000
    ? date
    : null;
};

/** The caller holds the account/conversation locks. Names never grant identity access. */
export async function applyVirtualCustomerName(
  tx: Prisma.TransactionClient,
  conversation: AvConversation,
  incoming?: { profileName?: string; profileObservedAt?: string },
  contacts?: ChannelContactName[],
) {
  const cache = virtualNameCache(conversation.channelNames);
  const profile = safeVirtualCustomerName(incoming?.profileName);
  const observedAt = safeTime(incoming?.profileObservedAt);
  if (
    profile &&
    observedAt &&
    (!cache.profile?.updatedAt ||
      observedAt > new Date(cache.profile.updatedAt))
  ) {
    cache.profile = { name: profile, updatedAt: observedAt.toISOString() };
  }
  if (contacts !== undefined) {
    const usable = contacts.filter((item) =>
      safeVirtualCustomerName(item.name),
    );
    const contact =
      usable.find((item) => item.source === "DEVICE_CONTACT") ??
      usable.find((item) => item.source === "PROVIDER_CONTACT");
    if (contact && contact.source !== "WHATSAPP_PROFILE")
      cache.contact = {
        name: safeVirtualCustomerName(contact.name)!,
        source: contact.source,
        updatedAt:
          safeTime(contact.updatedAt)?.toISOString() ??
          new Date().toISOString(),
      };
    else delete cache.contact;
    const nick = usable.find((item) => item.source === "WHATSAPP_PROFILE");
    const nickTime = safeTime(nick?.updatedAt);
    if (
      nick &&
      nickTime &&
      (!cache.profile?.updatedAt ||
        nickTime > new Date(cache.profile.updatedAt))
    )
      cache.profile = {
        name: safeVirtualCustomerName(nick.name)!,
        updatedAt: nickTime.toISOString(),
      };
  }
  const resolved = await resolveVirtualCustomerName(tx, {
    organizationId: conversation.organizationId,
    storeId: conversation.storeId,
    accountId: conversation.accountId,
    senderKey: conversation.externalCustomerId,
    ...(cache.contact
      ? {
          channelContact: {
            ...cache.contact,
            updatedAt: safeTime(cache.contact.updatedAt),
          },
        }
      : {}),
    ...(cache.profile
      ? {
          whatsappNickname: {
            ...cache.profile,
            updatedAt: safeTime(cache.profile.updatedAt),
          },
        }
      : {}),
    ...(!conversation.contactId &&
    ["UNKNOWN", "HISTORY"].includes(conversation.nameSource) &&
    safeVirtualCustomerName(conversation.displayName)
      ? {
          historicalName: {
            name: conversation.displayName,
            updatedAt: conversation.nameUpdatedAt ?? conversation.createdAt,
          },
        }
      : {}),
  });
  const usable = resolved.canGreet && !resolved.needsConfirmation;
  const identityChanged = conversation.contactId !== resolved.contactId;
  const changed =
    conversation.displayName !== resolved.name ||
    conversation.nameSource !== resolved.source ||
    conversation.contactId !== resolved.contactId ||
    conversation.nameNeedsConfirmation !== resolved.needsConfirmation ||
    conversation.nameUsableForReservation !== usable;
  await tx.avConversation.update({
    where: {
      id: conversation.id,
      organizationId: conversation.organizationId,
      storeId: conversation.storeId,
      accountId: conversation.accountId,
      externalCustomerId: conversation.externalCustomerId,
    },
    data: {
      displayName: resolved.name,
      nameSource: resolved.source,
      nameUpdatedAt: resolved.updatedAt,
      nameNeedsConfirmation: resolved.needsConfirmation,
      nameUsableForReservation: usable,
      contactId: resolved.contactId,
      channelNames: cache as Prisma.InputJsonValue,
      ...(identityChanged
        ? { version: { increment: 1 }, leaseOwner: null, leaseUntil: null }
        : {}),
    },
  });
  if (changed)
    await tx.avAuditEvent.create({
      data: {
        organizationId: conversation.organizationId,
        storeId: conversation.storeId,
        conversationId: conversation.id,
        actorId: "SYSTEM:CHANNEL_NAMES",
        action: "CUSTOMER_NAME_RESOLVED",
        data: {
          accountId: conversation.accountId,
          source: resolved.source,
          known: resolved.known,
          needsConfirmation: resolved.needsConfirmation,
          identityChanged,
        },
      },
    });
  return resolved;
}

export function virtualNameLookupDue(
  conversation: AvConversation,
  revision: number,
) {
  if (conversation.nameLookupAttempts >= 3)
    return (
      !conversation.nameLookupLastAt ||
      conversation.nameLookupLastAt.getTime() < Date.now() - 15 * 60000
    );
  if (conversation.nameLookupAfter || conversation.nameLookupLeaseOwner)
    return false;
  return (
    conversation.nameLookupRevision !== revision ||
    !conversation.nameLookupLastAt ||
    conversation.nameLookupLastAt.getTime() < Date.now() - 6 * 3600000
  );
}
