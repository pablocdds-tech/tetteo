import { z } from "zod";
import { contextoDeFundo, type ContextoSessao } from "@/core/sessao/nucleo";
import { permitirTentativa } from "@/core/auth/limites";
import { db } from "@/server/db";
import type { ChannelManagementFactory } from "@/server/atendimento-provedor";
import {
  ChannelMediaError,
  validateVirtualMedia,
} from "@/server/atendimento-midia";
import { CrmError } from "./campaign-domain";
import { authorizeVirtual, virtualAudit } from "./virtual-runtime";

const requestSchema = z
  .object({
    storeId: z.string().min(1).max(128),
    messageId: z.string().uuid(),
  })
  .strict();
const unavailable = () =>
  new CrmError(
    "MEDIA_UNAVAILABLE",
    "O WhatsApp não disponibilizou este arquivo. Ele pode ter expirado; peça o reenvio.",
    502,
  );

/** Media is read only on the operator's request, even while the AI is paused. */
export async function readVirtualMessageMedia(
  context: ContextoSessao,
  raw: unknown,
  factory: ChannelManagementFactory,
) {
  const data = requestSchema.parse(raw),
    scope = await authorizeVirtual(context, data.storeId);
  const message = await db.avMessage.findFirst({
    where: {
      id: data.messageId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      conversation: {
        organizationId: scope.organizationId,
        storeId: scope.storeId,
      },
    },
    select: {
      id: true,
      accountId: true,
      conversationId: true,
      kind: true,
      externalId: true,
      conversation: {
        select: { account: { select: { mode: true, connection: true } } },
      },
    },
  });
  if (!message)
    throw new CrmError("NOT_FOUND", "Arquivo indisponível nesta unidade.", 404);
  if (
    !["AUDIO", "IMAGE"].includes(message.kind) ||
    !message.externalId?.startsWith("message:")
  )
    throw new CrmError(
      "MEDIA_UNSUPPORTED",
      "Esta mensagem não possui áudio ou imagem disponível.",
      415,
    );
  const account = message.conversation.account,
    connection = account.connection;
  if (account.mode !== "EVOLUTION")
    throw new CrmError(
      "MEDIA_UNSUPPORTED",
      "A leitura de arquivos ainda não está disponível nesta conexão.",
      415,
    );
  if (
    !connection ||
    connection.connectionState !== "VERIFIED" ||
    connection.verifiedRevision !== connection.revision ||
    !connection.verifiedAt
  )
    throw new CrmError(
      "MEDIA_CONNECTION_REQUIRED",
      "Reconecte e confira este WhatsApp para abrir o arquivo.",
      409,
    );
  if (
    !(await permitirTentativa(
      "av-media-user",
      `${scope.organizationId}:${context.usuario.id}`,
      20,
      60_000,
    )) ||
    !(await permitirTentativa(
      "av-media-account",
      message.accountId,
      60,
      60_000,
    ))
  )
    throw new CrmError(
      "MEDIA_RATE_LIMIT",
      "Aguarde um minuto antes de abrir mais arquivos.",
      429,
    );
  try {
    const adapter = await factory(message.accountId),
      identity = adapter.identify();
    if (
      identity.accountKey !== message.accountId ||
      identity.mode !== account.mode ||
      identity.revision !== connection.revision
    )
      throw new CrmError(
        "MEDIA_CONFIGURATION_CHANGED",
        "A conexão mudou. Atualize a conversa.",
        409,
      );
    if (!adapter.readMessageMedia)
      throw new CrmError(
        "MEDIA_UNSUPPORTED",
        "Esta conexão não oferece a leitura deste arquivo.",
        415,
      );
    const kind = message.kind as "AUDIO" | "IMAGE";
    const downloaded = await adapter.readMessageMedia({
      providerMessageId: message.externalId.slice("message:".length),
      kind,
    });
    // Recheck access and the exact account revision after the network request.
    // Revocation while downloading never returns the previously fetched bytes.
    const currentContext = await contextoDeFundo(
      context.usuario.id,
      data.storeId,
    );
    const actor = await db.usuario.findFirst({
      where: { id: context.usuario.id, status: "ATIVO", excluidoEm: null },
      select: { id: true },
    });
    if (
      !actor ||
      !currentContext ||
      currentContext.organizacao.id !== scope.organizationId
    )
      throw new CrmError(
        "FORBIDDEN",
        "Sem acesso ao atendimento desta unidade.",
        403,
      );
    await authorizeVirtual(currentContext, data.storeId);
    const current = await db.avChannelConnection.findFirst({
      where: {
        accountId: message.accountId,
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        revision: connection.revision,
        verifiedRevision: connection.revision,
        connectionState: "VERIFIED",
        verifiedAt: { not: null },
      },
      select: { accountId: true },
    });
    if (!current)
      throw new CrmError(
        "MEDIA_CONFIGURATION_CHANGED",
        "A conexão mudou. Atualize a conversa.",
        409,
      );
    const media = validateVirtualMedia(
      downloaded.bytes,
      kind,
      downloaded.contentType,
    );
    await db.$transaction((tx) =>
      virtualAudit(
        tx,
        { ...scope, conversationId: message.conversationId },
        context.usuario.id,
        "MESSAGE_MEDIA_READ",
        {
          messageId: message.id,
          revision: connection.revision,
          contentType: media.contentType,
          bytes: media.bytes.length,
        },
      ),
    );
    return media;
  } catch (error) {
    if (error instanceof CrmError) throw error;
    if (
      error instanceof Error &&
      error.message === "CHANNEL_CONFIGURATION_CHANGED"
    )
      throw new CrmError(
        "MEDIA_CONFIGURATION_CHANGED",
        "A conexão mudou. Atualize a conversa.",
        409,
      );
    if (error instanceof ChannelMediaError && error.code === "MEDIA_LIMIT")
      throw new CrmError(
        "MEDIA_LIMIT",
        "Arquivo acima do limite: imagens até 5 MB e áudios até 16 MB.",
        413,
      );
    if (error instanceof ChannelMediaError && error.code === "MEDIA_TYPE")
      throw new CrmError(
        "MEDIA_TYPE",
        "O arquivo não é uma imagem ou áudio compatível. Vídeos e documentos ainda não são suportados aqui.",
        415,
      );
    throw unavailable();
  }
}
