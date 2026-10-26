import { z } from "zod";
import { configOperacao } from "@/connectors/saipos/operacao-config";
import {
  emitirToken,
  igual,
  lerCorpo,
  validarToken,
} from "@/connectors/saipos/operacao-seguranca";
import { escopoMaquina } from "@/connectors/saipos/operacao-repositorio";
import {
  receberEntrega,
  receberAvisoEntrega,
} from "@/connectors/saipos/logistica";
import { registrarEventoPedido } from "@/connectors/saipos/operacoes";

export const runtime = "nodejs";
let windowStart = 0,
  count = 0;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(
  request: Request,
  { params }: { params: Promise<{ caminho: string[] }> },
) {
  const started = Date.now();
  if (started - windowStart > 60000) {
    windowStart = started;
    count = 0;
  }
  if (++count > 120)
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  try {
    const path = (await params).caminho.join("/");
    if (path.startsWith("pedidos/eventos/")) {
      const key = process.env.SAIPOS_ORDER_WEBHOOK_KEY;
      // URL de capacidade é necessária enquanto o contrato de Pedidos não
      // especifica assinatura/headers. Sem chave forte, recusar tudo.
      if (
        !key ||
        !/^[a-f0-9]{64}$/i.test(key) ||
        !igual(path.slice("pedidos/eventos/".length), key)
      )
        return json({ error: "Não autorizado." }, 401);
      const c = configOperacao("pedidos");
      await registrarEventoPedido(
        await escopoMaquina(c.unidadeId),
        JSON.parse(await lerCorpo(request, 8192)),
      );
      return json({ ok: true });
    }
    const c = configOperacao("logistica");
    if (path === "oauth/token") {
      const raw = await lerCorpo(request, 8192);
      const body = request.headers
        .get("content-type")
        ?.includes("application/json")
        ? JSON.parse(raw)
        : Object.fromEntries(new URLSearchParams(raw));
      const credentials = z
        .object({
          client_id: z.string().max(200),
          client_secret: z.string().max(1000),
          grant_type: z.literal("client_credentials"),
        })
        .parse(body);
      if (
        !igual(credentials.client_id, c.clientId) ||
        !igual(credentials.client_secret, c.secret)
      )
        return json({ error: "invalid_client" }, 401);
      await escopoMaquina(c.unidadeId);
      return json({
        access_token: emitirToken(`${c.clientId}:${c.ambiente}`, c.secret),
        token_type: "bearer",
        expires_in: 3600,
      });
    }
    const token =
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!validarToken(token, `${c.clientId}:${c.ambiente}`, c.secret))
      return json({ error: "Não autorizado." }, 401);
    const scope = await escopoMaquina(c.unidadeId);
    if (path === "v1/logistics/delivery")
      return json(
        await receberEntrega(
          scope,
          JSON.parse(await lerCorpo(request)),
          started,
        ),
        202,
      );
    const match = /^v1\/logistics\/(cancel|readyForPickup)\/([\w-]+)$/.exec(
      path,
    );
    if (match) {
      const raw = await lerCorpo(request, 8192),
        body = raw ? JSON.parse(raw) : {};
      const response = await receberAvisoEntrega(
        scope,
        match[2],
        match[1] === "cancel" ? "cancelar" : "pronto",
        body,
      );
      return json(response, match[1] === "cancel" ? 202 : 200);
    }
    return json({ error: "Rota não encontrada." }, 404);
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json({ error: "Payload inválido." }, 400);
    // Não registrar request, token, URL de capacidade nem resposta do fornecedor.
    return json(
      {
        error:
          "Operação não concluída. Verifique a integração e o vínculo da loja.",
      },
      503,
    );
  }
}
