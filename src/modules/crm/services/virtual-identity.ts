import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { canonicalHash, CrmError, protectIdentity } from "./campaign-domain";
import {
  authorizeVirtual,
  lockVirtualConversation,
  virtualAudit,
} from "./virtual-runtime";

const bindingSchema = z
  .object({
    storeId: z.string().min(1).max(128),
    conversationId: z.string().uuid(),
    contactId: z.string().uuid(),
    version: z.number().int().positive(),
    requestId: z.string().uuid(),
    confirmedVerified: z.literal(true),
  })
  .strict();
/** Vínculo administrativo explícito; o telefone vem do canal, nunca de uma caixa de texto. */
export async function bindVirtualCustomer(
  context: ContextoSessao,
  raw: unknown,
) {
  const data = bindingSchema.parse(raw);
  const scope = await authorizeVirtual(context, data.storeId, true, true);
  return db.$transaction(async (tx) => {
    await lockVirtualConversation(tx, data.conversationId);
    const conversation = await tx.avConversation.findFirst({
      where: {
        id: data.conversationId,
        organizationId: scope.organizationId,
        storeId: data.storeId,
      },
      include: { account: { select: { mode: true } } },
    });
    if (
      !conversation ||
      !["EVOLUTION", "META"].includes(conversation.account.mode) ||
      !/^\+[1-9]\d{7,14}$/.test(conversation.externalCustomerId)
    )
      throw new CrmError(
        "VERIFIED_CHANNEL_REQUIRED",
        "Selecione uma conversa recebida de um remetente válido no canal real desta unidade.",
        409,
      );
    const evidence = await tx.avInboundEvent.findFirst({
      where: {
        organizationId: scope.organizationId,
        storeId: data.storeId,
        accountId: conversation.accountId,
        senderKey: conversation.externalCustomerId,
        type: "MESSAGE",
        status: "PROCESSED",
      },
      select: { id: true },
    });
    if (!evidence)
      throw new CrmError(
        "VERIFIED_CHANNEL_REQUIRED",
        "O vínculo exige uma mensagem recebida pelo webhook autenticado do canal.",
        409,
      );
    const payloadHash = canonicalHash(data);
    const previous = await tx.avOperatorRequest.findUnique({
      where: {
        conversationId_requestId: {
          conversationId: data.conversationId,
          requestId: data.requestId,
        },
      },
    });
    if (previous) {
      if (
        previous.actorId !== context.usuario.id ||
        previous.hash !== payloadHash
      )
        throw new CrmError(
          "IDEMPOTENCY_CONFLICT",
          "A tentativa já foi usada com outros dados ou por outro operador.",
          409,
        );
      return { success: true, contactId: conversation.contactId };
    }
    if (conversation.version !== data.version)
      throw new CrmError(
        "CONVERSATION_CHANGED",
        "O atendimento mudou. Atualize os dados antes de vincular o cliente.",
        409,
      );
    const contact = await tx.crmContact.findFirst({
      where: {
        id: data.contactId,
        storeId: data.storeId,
        active: true,
        mergedIntoId: null,
        store: { organizacaoId: scope.organizationId },
      },
      select: { id: true, name: true },
    });
    if (!contact)
      throw new CrmError(
        "NOT_FOUND",
        "Cliente indisponível nesta unidade.",
        404,
      );
    const identities = [
      { type: "PHONE", value: conversation.externalCustomerId },
      {
        type: `AV_CHANNEL:${conversation.accountId}`,
        value: conversation.externalCustomerId,
      },
    ];
    const protectedPhone = protectIdentity(
      data.storeId,
      "PHONE",
      conversation.externalCustomerId,
    );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:identity:${data.storeId}:${protectedPhone.normalizedHash}`}))`;
    for (const identity of identities) {
      const protectedValue = protectIdentity(
        data.storeId,
        identity.type,
        identity.value,
      );
      const prior = await tx.crmIdentity.findUnique({
        where: {
          storeId_type_normalizedHash: {
            storeId: data.storeId,
            type: identity.type,
            normalizedHash: protectedValue.normalizedHash,
          },
        },
        select: { id: true, contactId: true },
      });
      if (prior && prior.contactId !== contact.id)
        throw new CrmError(
          "IDENTITY_CONFLICT",
          "O identificador está vinculado a outro cadastro. Use o fluxo de revisão e unificação do CRM antes de continuar.",
          409,
        );
      if (!prior)
        await tx.crmIdentity.create({
          data: {
            storeId: data.storeId,
            contactId: contact.id,
            type: identity.type,
            ...protectedValue,
            verifiedAt: new Date(),
            verifiedById: context.usuario.id,
          },
        });
    }
    const alias = await tx.avCustomerPreference.findUnique({
      where: {
        accountId_externalCustomerId_key: {
          accountId: conversation.accountId,
          externalCustomerId: conversation.externalCustomerId,
          key: "name",
        },
      },
      select: { value: true },
    });
    await tx.avConversation.update({
      where: { id: conversation.id },
      data: {
        contactId: contact.id,
        displayName: alias?.value ?? contact.name,
        version: { increment: 1 },
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    await tx.avAgentRun.updateMany({
      where: { conversationId: conversation.id, status: "RUNNING" },
      data: {
        status: "DISCARDED",
        error: "CUSTOMER_IDENTITY_VERIFIED",
        completedAt: new Date(),
      },
    });
    await tx.avOperatorRequest.create({
      data: {
        organizationId: scope.organizationId,
        storeId: data.storeId,
        conversationId: conversation.id,
        actorId: context.usuario.id,
        requestId: data.requestId,
        hash: payloadHash,
      },
    });
    await virtualAudit(
      tx,
      {
        organizationId: scope.organizationId,
        storeId: data.storeId,
        conversationId: conversation.id,
      },
      context.usuario.id,
      "CUSTOMER_IDENTITY_VERIFIED",
      { contactId: contact.id, accountId: conversation.accountId },
    );
    return { success: true, contactId: contact.id };
  });
}
