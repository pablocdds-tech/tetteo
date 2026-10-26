export function validCrmOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  const expected = configured
    ? new URL(configured).origin
    : new URL(request.url).origin;
  return (
    origin === expected &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
function invalid(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}
export async function readCrmBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw invalid("Envie dados JSON.", 415);
  const limit = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw invalid("O arquivo excede 1 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw invalid("Envio vazio.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw invalid("O arquivo excede 1 MB.", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw invalid("JSON inválido.");
  }
}
