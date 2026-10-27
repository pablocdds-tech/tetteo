import type { z } from "zod";
import { ErroCw, type ConfigCw } from "./config";
import {
  catalogoCw,
  detalhePedidoCw,
  lojaCw,
  pedidosCw,
  tokensCw,
} from "./schemas";

export function urlAutorizacaoCw(
  config: ConfigCw,
  state: string,
  challenge: string,
) {
  const url = new URL(config.autorizacao);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export class ClienteCw {
  constructor(
    private readonly config: Pick<ConfigCw, "ambiente" | "api"> &
      Partial<ConfigCw>,
    private readonly transporte: typeof fetch = fetch,
    private readonly autenticacao: "bearer" | "api-key" = "bearer",
  ) {}

  private async request(
    caminho: string,
    token?: string,
    formulario?: URLSearchParams,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transporte(new URL(caminho, this.config.api), {
        method: formulario ? "POST" : "GET",
        headers: {
          Accept: "application/json",
          ...(token
            ? this.autenticacao === "api-key"
              ? { "X-API-KEY": token }
              : { Authorization: `Bearer ${token}` }
            : {}),
          ...(formulario
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body: formulario,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ErroCw(
        "rede",
        "Cardápio Web não respondeu. Aguarde e tente novamente.",
      );
    }
    if (!response.ok) {
      // Só o código OAuth conhecido é interpretado; descrição e payload nunca saem em erros.
      const corpo = await lerLimitado(response, 4096).catch(() => null);
      if (
        corpo &&
        typeof corpo === "object" &&
        "error" in corpo &&
        corpo.error === "invalid_grant"
      )
        throw new ErroCw(
          "reconectar",
          "A autorização Cardápio Web expirou ou foi revogada. Conecte a loja novamente.",
        );
      if (response.status === 401)
        throw new ErroCw(
          "reconectar",
          "A conexão Cardápio Web não está autorizada. Conecte a loja novamente.",
        );
      if (response.status === 403)
        throw new ErroCw(
          "escopo",
          "O aplicativo Cardápio Web não tem a permissão necessária. Revise os escopos com o fornecedor.",
        );
      if (response.status === 429)
        throw new ErroCw(
          "limite",
          "Limite Cardápio Web atingido. Aguarde pelo menos um minuto.",
        );
      throw new ErroCw(
        "fornecedor",
        "Cardápio Web não concluiu a consulta. Tente novamente mais tarde.",
      );
    }
    if (caminho.endsWith("/revoke")) {
      await response.body?.cancel();
      return null;
    }
    return lerLimitado(
      response,
      caminho.endsWith("/catalog") ? 8_000_000 : 4_000_000,
    );
  }
  private async ler<T>(
    schema: z.ZodType<T>,
    caminho: string,
    token: string,
  ): Promise<T> {
    const result = schema.safeParse(await this.request(caminho, token));
    if (!result.success)
      throw new ErroCw(
        "contrato",
        "A resposta Cardápio Web não corresponde ao contrato esperado. Consulte o administrador.",
      );
    return result.data;
  }
  async token(dados: Record<string, string>) {
    if (!this.config.clientId || this.autenticacao !== "bearer")
      throw new ErroCw(
        "configuracao",
        "O aplicativo OAuth não foi configurado.",
      );
    const result = tokensCw.safeParse(
      await this.request(
        "/api/partner/oauth/token",
        undefined,
        new URLSearchParams({ ...dados, client_id: this.config.clientId }),
      ),
    );
    if (!result.success)
      throw new ErroCw(
        "contrato",
        "A resposta de autorização Cardápio Web é inválida. Reinicie a conexão.",
      );
    return result.data;
  }
  revogar(token: string) {
    if (!this.config.clientId || this.autenticacao !== "bearer")
      throw new ErroCw(
        "configuracao",
        "O aplicativo OAuth não foi configurado.",
      );
    return this.request(
      "/api/partner/oauth/revoke",
      undefined,
      new URLSearchParams({ client_id: this.config.clientId, token }),
    );
  }
  loja(token: string) {
    return this.ler(lojaCw, "/api/partner/v1/merchant", token);
  }
  pedidos(token: string, desde?: Date) {
    const query = desde
      ? `?updated_since=${encodeURIComponent(desde.toISOString())}`
      : "";
    return this.ler(pedidosCw, `/api/partner/v1/orders${query}`, token);
  }
  pedido(token: string, id: number) {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new ErroCw("contrato", "Pedido inválido.");
    return this.ler(detalhePedidoCw, `/api/partner/v1/orders/${id}`, token);
  }
  catalogo(token: string) {
    return this.ler(catalogoCw, "/api/partner/v1/catalog", token);
  }
}

async function lerLimitado(
  response: Response,
  limite: number,
): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > limite) {
    await response.body?.cancel();
    throw new ErroCw(
      "contrato",
      "A resposta Cardápio Web excedeu o limite de leitura.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new ErroCw("contrato", "Cardápio Web devolveu uma resposta vazia.");
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const parte = await reader.read();
      if (parte.done) break;
      tamanho += parte.value.byteLength;
      if (tamanho > limite) throw new Error();
      partes.push(parte.value);
    }
    return JSON.parse(Buffer.concat(partes).toString("utf8")) as unknown;
  } catch {
    await reader.cancel();
    throw new ErroCw(
      "contrato",
      "A resposta Cardápio Web é inválida ou excedeu o limite de leitura.",
    );
  }
}
