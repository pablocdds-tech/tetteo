/** Nunca registre body, cabeçalhos ou URL com segredo de provedores. */
export async function channelHttp(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error("PROVIDER_RESPONSE_LIMIT");
  if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("PROVIDER_INVALID_RESPONSE");
  }
}
export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const string = (v: unknown) => (typeof v === "string" ? v : "");
