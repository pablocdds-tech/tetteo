"use client";

async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error ?? "Não foi possível concluir a operação no CRM.",
    );
  return data as T;
}
export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body: unknown, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  put: <T = unknown>(path: string, body: unknown, options?: RequestInit) =>
    request<T>(path, { ...options, method: "PUT", body: JSON.stringify(body) }),
};
