import { z } from "zod";
import { readSignedDemoWebhook } from "@/server/atendimento-webhook";
import { receiveVirtualInbound } from "@/modules/crm/services/virtual-runtime";
import { CrmError } from "@/modules/crm/services/campaign-domain";
import { permitirTentativa } from "@/core/auth/limites";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const data = await readSignedDemoWebhook(
      request,
      process.env.AV_DEMO_WEBHOOK_SECRET ?? "",
    );
    if (
      !(await permitirTentativa(
        "atendimento-webhook",
        data.accountId,
        120,
        60_000,
      ))
    )
      return Response.json(
        { error: "Limite de eventos atingido." },
        { status: 429 },
      );
    const result = await receiveVirtualInbound(data.accountId, data.event);
    // Acknowledges durable ingestion only. Model and tool execution run later.
    return Response.json(
      { accepted: true, duplicate: result.duplicate },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CrmError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : error instanceof Error &&
              "status" in error &&
              typeof error.status === "number"
            ? error.status
            : 503;
    return Response.json(
      {
        error:
          status === 401
            ? "Webhook não autorizado."
            : status < 500
              ? "Evento inválido ou acima do limite."
              : "Evento não confirmado. Repita com o mesmo ID externo.",
      },
      { status },
    );
  }
}
