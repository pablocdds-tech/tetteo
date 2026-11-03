import { z } from "zod";
import { verifyChannelSignature } from "./atendimento-canal";

export async function readSignedDemoWebhook(request: Request, secret: string) {
  const denied = () =>
    Object.assign(new Error("Webhook não autorizado."), { status: 401 });
  if (secret.length < 32) throw denied();
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw Object.assign(new Error("Envie JSON."), { status: 415 });
  const limit = 64 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw Object.assign(new Error("Evento acima do limite."), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw denied();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw Object.assign(new Error("Evento acima do limite."), {
        status: 413,
      });
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (
    !verifyChannelSignature(
      body,
      request.headers.get("x-av-signature-256"),
      secret,
    )
  )
    throw denied();
  return z
    .object({
      accountId: z.string().uuid(),
      event: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(JSON.parse(body));
}
