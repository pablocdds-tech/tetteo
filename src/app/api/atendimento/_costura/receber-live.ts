import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { verificarPasse } from "@/connectors/whatsapp/passe";
import { permitirTentativa } from "@/core/auth/limites";
import { receiveVirtualInbound } from "@/modules/crm/services/virtual-runtime";
import {
  liveChannelConfiguration,
  recordChannelDelivery,
} from "@/server/atendimento-contas";
import { verifyChannelSignature } from "@/server/atendimento-canal";
import type { LiveChannelConfig } from "@/server/atendimento-provedor";
import type { MetaChannelSettings } from "@/server/atendimento-credenciais";
import {
  ChannelWebhookError,
  normalizeEvolutionWebhook,
  normalizeMetaWebhook,
  readChannelWebhookBody,
  type NormalizedChannelBatch,
} from "@/server/atendimento-webhook-normalizar";
import { db } from "@/server/db";

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function refused(error: unknown) {
  const status =
    error instanceof ChannelWebhookError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : error instanceof Error &&
            "status" in error &&
            typeof error.status === "number"
          ? error.status
          : 503;
  return json(
    {
      error:
        status === 401 || status === 403
          ? "Webhook não autorizado."
          : status === 413
            ? "Evento acima do limite."
            : status >= 500
              ? "O evento não foi confirmado. Repita com o mesmo ID externo."
              : "Evento inválido.",
    },
    status,
  );
}
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
async function configuration(
  accountId: string,
  provider: "META" | "EVOLUTION",
) {
  z.string().uuid().parse(accountId);
  const config = await liveChannelConfiguration(accountId);
  if (config.provider !== provider)
    throw new ChannelWebhookError(404, "Canal não encontrado.");
  return config;
}
async function consume(
  config: LiveChannelConfig,
  batch: NormalizedChannelBatch,
) {
  if (!batch.matched) return 0;
  const current = await db.avChannelConnection.updateMany({
    where: { accountId: config.accountId, revision: config.revision },
    data: { webhookSeenAt: new Date() },
  });
  if (!current.count)
    throw new ChannelWebhookError(503, "O vínculo do canal mudou.");
  let processed = 0;
  for (const delivery of batch.deliveries) {
    await recordChannelDelivery(config, delivery);
    processed++;
  }
  for (const message of batch.messages) {
    await receiveVirtualInbound(config.accountId, message, {
      provider: config.provider,
      revision: config.revision,
    });
    processed++;
  }
  return processed;
}
export async function verifyMetaChannel(request: Request, accountId: string) {
  try {
    const config = await configuration(accountId, "META");
    const url = new URL(request.url),
      token = config.secrets.verifyToken;
    if (!token)
      throw new ChannelWebhookError(503, "Configure o token de verificação.");
    const received = url.searchParams.get("hub.verify_token") ?? "",
      challenge = url.searchParams.get("hub.challenge") ?? "";
    if (
      url.searchParams.get("hub.mode") !== "subscribe" ||
      !challenge ||
      challenge.length > 512 ||
      !equal(received, token)
    )
      throw new ChannelWebhookError(403, "Verificação recusada.");
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return refused(error);
  }
}
/** The callback URL selects an app secret; exact WABA+phone bindings select the accounts. */
export async function receiveMetaChannel(request: Request, accountId: string) {
  try {
    const anchor = await configuration(accountId, "META");
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature))
      throw new ChannelWebhookError(401, "Assinatura ausente.");
    const body = await readChannelWebhookBody(request);
    if (
      !verifyChannelSignature(body, signature, anchor.secrets.appSecret ?? "")
    )
      throw new ChannelWebhookError(401, "Assinatura inválida.");
    if (
      !(await permitirTentativa(
        "av-meta-webhook",
        anchor.accountId,
        600,
        60_000,
      ))
    )
      return json({ error: "Limite de eventos atingido." }, 429);
    const raw = JSON.parse(body);
    if (anchor.provider !== "META")
      throw new ChannelWebhookError(404, "Canal não encontrado.");
    // Validate the envelope before enumerating configured accounts. Never
    // derive a tenant or account from a message, name or supplied phone.
    normalizeMetaWebhook(raw, anchor.settings, { allowUnrelated: true });
    const candidates = await db.avChannelAccount.findMany({
      where: {
        organizationId: anchor.organizationId,
        mode: "META",
        store: { ativa: true, excluidoEm: null },
        connection: { isNot: null },
      },
      select: { id: true, connection: { select: { settings: true } } },
      take: 101,
    });
    if (candidates.length > 100)
      throw new ChannelWebhookError(
        503,
        "O aplicativo precisa dividir o processamento entre callbacks autorizados.",
      );
    const configs = await Promise.allSettled(
      candidates.map((candidate) => liveChannelConfiguration(candidate.id)),
    );
    let processed = 0;
    for (let index = 0; index < configs.length; index++) {
      const resolved = configs[index];
      if (resolved.status !== "fulfilled") {
        const settings = candidates[index].connection?.settings;
        if (
          settings &&
          typeof settings === "object" &&
          !Array.isArray(settings) &&
          typeof settings.phoneNumberId === "string" &&
          typeof settings.businessAccountId === "string" &&
          normalizeMetaWebhook(raw, settings as MetaChannelSettings, {
            allowUnrelated: true,
          }).matched
        )
          throw new ChannelWebhookError(
            503,
            "A configuração da conta não pôde ser lida. Repita o evento após a recuperação.",
          );
        continue;
      }
      const target = resolved.value;
      if (
        target.provider !== "META" ||
        target.organizationId !== anchor.organizationId ||
        !verifyChannelSignature(body, signature, target.secrets.appSecret ?? "")
      )
        continue;
      processed += await consume(
        target,
        normalizeMetaWebhook(raw, target.settings, { allowUnrelated: true }),
      );
    }
    return json({ accepted: true, events: processed });
  } catch (error) {
    return refused(error);
  }
}
export async function receiveEvolutionChannel(
  request: Request,
  accountId: string,
) {
  try {
    const config = await configuration(accountId, "EVOLUTION"),
      secret = config.secrets.webhookSecret;
    if (!secret)
      throw new ChannelWebhookError(
        503,
        "Configure a autenticação do webhook.",
      );
    if (
      !verificarPasse(
        request.headers.get("authorization"),
        [secret],
        new Date(),
      ).ok
    )
      throw new ChannelWebhookError(401, "Passe inválido.");
    if (
      !(await permitirTentativa(
        "av-evolution-webhook",
        config.accountId,
        600,
        60_000,
      ))
    )
      return json({ error: "Limite de eventos atingido." }, 429);
    const body = await readChannelWebhookBody(request);
    if (config.provider !== "EVOLUTION")
      throw new ChannelWebhookError(404, "Canal não encontrado.");
    return json({
      accepted: true,
      events: await consume(
        config,
        normalizeEvolutionWebhook(JSON.parse(body), config.settings),
      ),
    });
  } catch (error) {
    return refused(error);
  }
}
