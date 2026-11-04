import type { Prisma } from "@prisma/client";
import { isDemoRecipient } from "@/server/atendimento-canal";
import { safeVirtualCustomerName } from "@/server/atendimento-nome";
import { CrmError, protectIdentity } from "./campaign-domain";

export type NameSource =
  | "CUSTOMER_CORRECTION"
  | "CRM_VERIFIED"
  | "DEVICE_CONTACT"
  | "PROVIDER_CONTACT"
  | "CRM_PHONE_HINT"
  | "WHATSAPP_PROFILE"
  | "HISTORY"
  | "UNKNOWN";
type Hint = { name: string; updatedAt: Date | null };
export type VirtualCustomerNameInput = {
  organizationId: string;
  storeId: string;
  accountId: string;
  senderKey: string;
  channelContact?: Hint & {
    source: "DEVICE_CONTACT" | "PROVIDER_CONTACT";
  };
  whatsappNickname?: Hint;
  historicalName?: Hint;
};
export type VirtualCustomerName = {
  name: string;
  source: NameSource;
  updatedAt: Date | null;
  known: boolean;
  contactId: string | null;
  needsConfirmation: boolean;
  canGreet: boolean;
};
const validTime = (value: Date | null) =>
  value instanceof Date && Number.isFinite(value.getTime()) ? value : null;

/** Receives the sender attested by the channel, never a phone typed in a message. */
export async function resolveVirtualCustomerName(
  tx: Prisma.TransactionClient,
  input: VirtualCustomerNameInput,
): Promise<VirtualCustomerName> {
  const scope = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    accountId: input.accountId,
  };
  const account = await tx.avChannelAccount.findFirst({
    where: {
      id: input.accountId,
      organizationId: input.organizationId,
      storeId: input.storeId,
      store: {
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
    },
    select: { mode: true },
  });
  if (!account)
    throw new CrmError("NOT_FOUND", "Conta indisponível nesta unidade.", 404);
  const demo = account.mode === "DEMO";
  if (
    demo
      ? !isDemoRecipient(input.senderKey)
      : !/^\+[1-9]\d{7,14}$/.test(input.senderKey)
  )
    throw new CrmError(
      "INVALID_SENDER",
      "O canal não informou um remetente confiável.",
      400,
    );
  const identityType = `${demo ? "AV_DEMO" : "AV_CHANNEL"}:${input.accountId}`;
  const identityKeys = [
    {
      type: identityType,
      normalizedHash: protectIdentity(
        input.storeId,
        identityType,
        input.senderKey,
      ).normalizedHash,
    },
    ...(!demo
      ? [input.senderKey, input.senderKey.slice(1)].map((value) => ({
          type: "PHONE",
          normalizedHash: protectIdentity(input.storeId, "PHONE", value)
            .normalizedHash,
        }))
      : []),
  ];
  const [alias, identities, phoneContacts] = await Promise.all([
    tx.avCustomerPreference.findFirst({
      where: {
        ...scope,
        externalCustomerId: input.senderKey,
        key: "name",
        source: "CUSTOMER",
      },
      select: { value: true, updatedAt: true },
    }),
    tx.crmIdentity.findMany({
      where: {
        storeId: input.storeId,
        OR: identityKeys,
        verifiedAt: { lte: new Date() },
        contact: {
          active: true,
          mergedIntoId: null,
          store: { organizacaoId: input.organizationId },
        },
      },
      select: {
        verifiedById: true,
        contact: { select: { id: true, name: true, updatedAt: true } },
      },
      take: 4,
    }),
    demo
      ? Promise.resolve([])
      : tx.crmContact.findMany({
          where: {
            storeId: input.storeId,
            store: { organizacaoId: input.organizationId },
            active: true,
            mergedIntoId: null,
            phone: { in: [input.senderKey, input.senderKey.slice(1)] },
          },
          select: { id: true, name: true, updatedAt: true },
          take: 3,
        }),
  ]);
  const verified = identities
    .filter((identity) => identity.verifiedById.trim())
    .map((identity) => identity.contact);
  const candidates = new Map(
    [...verified, ...phoneContacts].map((contact) => [contact.id, contact]),
  );
  const ambiguous = candidates.size > 1;
  const contact = !ambiguous && verified.length ? verified[0] : null;
  const identity = { known: !!contact, contactId: contact?.id ?? null };
  const result = (
    name: string,
    source: NameSource,
    updatedAt: Date | null,
    needsConfirmation = ambiguous,
  ): VirtualCustomerName => ({
    name,
    source,
    updatedAt: validTime(updatedAt),
    ...identity,
    needsConfirmation,
    canGreet: !needsConfirmation,
  });
  const correctedName = safeVirtualCustomerName(alias?.value);
  if (correctedName)
    return result(
      correctedName,
      "CUSTOMER_CORRECTION",
      alias!.updatedAt,
      false,
    );
  const verifiedName = safeVirtualCustomerName(contact?.name);
  if (verifiedName)
    return result(verifiedName, "CRM_VERIFIED", contact!.updatedAt, false);
  const channelName = safeVirtualCustomerName(input.channelContact?.name);
  if (
    channelName &&
    ["DEVICE_CONTACT", "PROVIDER_CONTACT"].includes(
      input.channelContact?.source ?? "",
    )
  )
    return result(
      channelName,
      input.channelContact!.source,
      input.channelContact!.updatedAt,
    );
  const nickname = safeVirtualCustomerName(input.whatsappNickname?.name);
  if (nickname)
    return result(
      nickname,
      "WHATSAPP_PROFILE",
      input.whatsappNickname!.updatedAt,
    );
  const phoneHint =
    !ambiguous && phoneContacts.length === 1 ? phoneContacts[0] : null;
  const phoneName = safeVirtualCustomerName(phoneHint?.name);
  if (phoneName)
    return result(phoneName, "CRM_PHONE_HINT", phoneHint!.updatedAt, true);
  const historical = safeVirtualCustomerName(input.historicalName?.name);
  if (historical)
    return result(historical, "HISTORY", input.historicalName!.updatedAt);
  return {
    ...identity,
    name: demo
      ? "Visitante · exemplo Kairu"
      : `Cliente •••• ${input.senderKey.slice(-4)}`,
    source: "UNKNOWN",
    updatedAt: null,
    needsConfirmation: ambiguous,
    canGreet: false,
  };
}
