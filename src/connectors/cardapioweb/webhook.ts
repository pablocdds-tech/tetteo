import type { AmbienteCw } from "./config";
import { eventoWebhookCw, type EventoWebhookCw } from "./schemas";

export type GravarEventoCw = (
  ambiente: AmbienteCw,
  token: string,
  evento: EventoWebhookCw,
) => Promise<"recebido" | "repetido" | "recusado" | "conflito">;

export async function receberWebhookCw(
  request: Request,
  gravar: GravarEventoCw,
) {
  const responder = (status: number, mensagem: string) =>
    Response.json(
      { mensagem },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  const ambiente = new URL(request.url).searchParams.get("ambiente");
  if (ambiente !== "sandbox" && ambiente !== "producao")
    return responder(400, "Informe o ambiente do webhook.");
  const token = request.headers.get("x-webhook-token");
  if (!token || token.length < 32 || token.length > 512)
    return responder(401, "Webhook não autorizado.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return responder(415, "Envie JSON.");
  const limite = 16384;
  if (Number(request.headers.get("content-length")) > limite)
    return responder(413, "Evento excede o limite permitido.");
  const reader = request.body?.getReader();
  if (!reader) return responder(400, "Evento inválido.");
  let evento: EventoWebhookCw;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const corpo = async () => {
      const partes: Uint8Array[] = [];
      let tamanho = 0;
      for (;;) {
        const p = await reader.read();
        if (p.done) break;
        tamanho += p.value.byteLength;
        if (tamanho > limite) throw new Error();
        partes.push(p.value);
      }
      return JSON.parse(Buffer.concat(partes).toString("utf8")) as unknown;
    };
    const valor = await Promise.race([
      corpo(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), 1500);
      }),
    ]);
    evento = eventoWebhookCw.parse(valor);
  } catch {
    void reader.cancel().catch(() => undefined);
    return responder(400, "Evento inválido ou fora do limite de leitura.");
  } finally {
    clearTimeout(timer);
  }
  try {
    const resultado = await Promise.race([
      gravar(ambiente, token, evento),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error()), 2500);
      }),
    ]);
    if (resultado === "recusado")
      return responder(401, "Webhook não autorizado.");
    if (resultado === "conflito")
      return responder(409, "Identificador de evento em conflito.");
    return responder(
      200,
      resultado === "repetido" ? "Evento já recebido." : "Evento recebido.",
    );
  } catch {
    return responder(503, "Não foi possível gravar o evento. Tente novamente.");
  } finally {
    clearTimeout(timer);
  }
}
