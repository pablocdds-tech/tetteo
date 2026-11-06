import { z } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { readVirtualMessageMedia } from "@/modules/crm/services/virtual-media";
import { CrmError } from "@/modules/crm/services/campaign-domain";
import { managementFor } from "../_costura/providers";

export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const json = (error: string, status: number, code?: string) =>
  Response.json({ error, ...(code ? { code } : {}) }, { status, headers });

export async function GET(request: Request) {
  try {
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return json(
        "Abra o arquivo dentro do atendimento.",
        403,
        "MEDIA_CROSS_SITE",
      );
    const context = await obterContexto();
    if (!context) return json("Entre no sistema para abrir o arquivo.", 401);
    const url = new URL(request.url);
    const media = await readVirtualMessageMedia(
      context,
      {
        storeId: url.searchParams.get("storeId"),
        messageId: url.searchParams.get("messageId"),
      },
      managementFor,
    );
    const disposition =
      url.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(new Uint8Array(media.bytes), {
      headers: {
        ...headers,
        "Content-Type": media.contentType,
        "Content-Length": String(media.bytes.length),
        "Content-Disposition": `${disposition}; filename="severina.${media.extension}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        "Identificador do arquivo inválido.",
        400,
        "INVALID_MEDIA_REQUEST",
      );
    if (error instanceof CrmError)
      return json(error.message, error.status, error.code);
    return json(
      "Não foi possível abrir o arquivo. Tente novamente em instantes.",
      503,
      "MEDIA_UNAVAILABLE",
    );
  }
}
