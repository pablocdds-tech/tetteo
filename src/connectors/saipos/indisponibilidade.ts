/** Extract only known connection codes. Never retain the provider's error payload. */
export async function codigoConexao(
  response: Response,
): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) return null;
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks);
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !("code" in parsed))
      return null;
    return typeof parsed.code === "string" && /^PGRST00[0-3]$/.test(parsed.code)
      ? parsed.code
      : null;
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
