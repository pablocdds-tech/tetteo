export type AmbienteCw = "sandbox" | "producao";

export class ErroCw extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export const HOSTS_CW = {
  sandbox: {
    api: "https://integracao.sandbox.cardapioweb.com",
    autorizacao: "https://portal.sandbox.cardapioweb.com/cw-apps",
  },
  producao: {
    api: "https://integracao.cardapioweb.com",
    autorizacao: "https://portal.cardapioweb.com/cw-apps",
  },
} as const;

export function configCw(
  env: Record<string, string | undefined> = process.env,
) {
  const ambiente = env.CARDAPIOWEB_ENVIRONMENT || "sandbox";
  if (ambiente !== "sandbox" && ambiente !== "producao")
    throw new ErroCw(
      "configuracao",
      "Revise o ambiente Cardápio Web no servidor.",
    );
  const clientId = env.CARDAPIOWEB_CLIENT_ID?.trim();
  const redirectUri = env.CARDAPIOWEB_REDIRECT_URI?.trim();
  const key = env.CARDAPIOWEB_ENCRYPTION_KEY;
  const chaveValida = key
    ? /^[a-f0-9]{64}$/i.test(key)
    : (env.AUTH_SECRET?.length ?? 0) >= 32;
  if (!clientId || !redirectUri || !chaveValida)
    throw new ErroCw(
      "configuracao",
      "O administrador precisa configurar o aplicativo Cardápio Web no servidor.",
    );
  let url: URL;
  let app: URL;
  try {
    url = new URL(redirectUri);
    app = new URL(env.APP_URL || "");
  } catch {
    throw new ErroCw(
      "configuracao",
      "Revise os endereços do aplicativo no servidor.",
    );
  }
  const local =
    ambiente === "sandbox" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (!local && url.protocol !== "https:") ||
    url.origin !== app.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/cardapioweb/callback"
  )
    throw new ErroCw(
      "configuracao",
      "O retorno Cardápio Web precisa usar o domínio do Tetteo e /api/cardapioweb/callback.",
    );
  return { ambiente, clientId, redirectUri, ...HOSTS_CW[ambiente] };
}

export type ConfigCw = ReturnType<typeof configCw>;

export function configApiCw(ambiente: AmbienteCw) {
  if (ambiente !== "sandbox" && ambiente !== "producao")
    throw new ErroCw("configuracao", "Ambiente Cardápio Web inválido.");
  return { ambiente, api: HOSTS_CW[ambiente].api };
}

export function urlWebhookCw(ambiente: AmbienteCw) {
  const url = new URL("/api/cardapioweb/webhook", process.env.APP_URL);
  if (
    url.username ||
    url.password ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new ErroCw("configuracao", "Endereço do Tetteo inválido.");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new ErroCw(
      "configuracao",
      "Configure o endereço HTTPS do Tetteo no servidor.",
    );
  url.searchParams.set("ambiente", ambiente);
  return url.toString();
}
