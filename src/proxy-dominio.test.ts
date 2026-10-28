import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { NextFetchEvent } from "next/dist/server/web/spec-extension/fetch-event";
import {
  configurarDominios,
  urlDaRequisicaoPublica,
} from "@/lib/dominios-publicos";

test("proxy standalone envia o login e callback à origem pública validada", async () => {
  const chaves = [
    "APP_URL",
    "APP_OPERACAO_URL",
    "APP_OPERACAO_ROTA",
    "AUTH_SECRET",
    "AUTH_TRUST_HOST",
    "AUTH_URL",
    "NEXTAUTH_URL",
  ] as const;
  const anteriores = chaves.map((chave) => process.env[chave]);
  Object.assign(process.env, {
    APP_URL: "https://app.example.com",
    APP_OPERACAO_URL: "https://pdv.example.com",
    APP_OPERACAO_ROTA: "/pdv",
    AUTH_SECRET: "segredo-ficticio-exclusivo-teste-proxy-2026",
    AUTH_TRUST_HOST: "true",
  });
  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;
  try {
    const { default: proxy } = await import("./proxy");
    for (const [host, caminho] of [
      ["pdv.example.com", "/pdv?visao=AGENDADOS"],
      ["app.example.com", "/estoque"],
    ]) {
      const request = new NextRequest(`https://0.0.0.0:3000${caminho}`, {
        headers: {
          host,
          "x-forwarded-host": host,
          "x-forwarded-proto": "https",
        },
      });
      const response = await proxy(
        request,
        new NextFetchEvent({ request, page: caminho, context: undefined }),
      );
      assert.equal(response?.status, 307);
      const destino = new URL(response!.headers.get("location")!);
      assert.equal(destino.origin, `https://${host}`);
      assert.equal(destino.pathname, "/login");
      assert.equal(
        destino.searchParams.get("callbackUrl"),
        `https://${host}${caminho}`,
      );
    }
    const { default: NextAuth } = await import("next-auth");
    const { default: Credentials } =
      await import("next-auth/providers/credentials");
    const { authConfigBase } = await import("@/core/auth/config-base");
    const { handlers } = NextAuth({
      ...authConfigBase,
      useSecureCookies: true,
      providers: [
        Credentials({
          authorize: () => ({ id: "usuario-ficticio-qa", name: "QA fictício" }),
        }),
      ],
    });
    const dominios = configurarDominios(
      process.env.APP_URL,
      process.env.APP_OPERACAO_URL,
      process.env.APP_OPERACAO_ROTA,
    );
    const h = {
      host: "pdv.example.com",
      "x-forwarded-host": "pdv.example.com",
      "x-forwarded-proto": "https",
    };
    const externa = (request: NextRequest) =>
      new NextRequest(
        urlDaRequisicaoPublica(request.url, request.headers, dominios)!,
        request,
      );
    const providers = await handlers.GET(
      externa(
        new NextRequest("https://0.0.0.0:3000/api/auth/providers", {
          headers: h,
        }),
      ),
    );
    const cadastro = await providers.json();
    assert.equal(
      cadastro.credentials.callbackUrl,
      "https://pdv.example.com/api/auth/callback/credentials",
    );
    const csrf = await handlers.GET(
      externa(
        new NextRequest("https://0.0.0.0:3000/api/auth/csrf", { headers: h }),
      ),
    );
    const { csrfToken } = await csrf.json();
    const cookie = csrf.headers
      .getSetCookie()
      .map((valor) => valor.split(";")[0])
      .join("; ");
    const login = await handlers.POST(
      externa(
        new NextRequest("https://0.0.0.0:3000/api/auth/callback/credentials", {
          method: "POST",
          headers: {
            ...h,
            cookie,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            csrfToken,
            callbackUrl: "https://pdv.example.com/pdv",
          }),
        }),
      ),
    );
    assert.equal(login.status, 302);
    assert.equal(login.headers.get("location"), "https://pdv.example.com/pdv");
    const sessao = login.headers
      .getSetCookie()
      .find((valor) => valor.startsWith("__Secure-authjs.session-token="));
    assert.ok(sessao);
    assert.match(sessao, /; HttpOnly/i);
    assert.match(sessao, /; Secure/i);
    assert.match(sessao, /; SameSite=Lax/i);
    assert.doesNotMatch(sessao, /; Domain=/i);
  } finally {
    chaves.forEach((chave, i) => {
      if (anteriores[i] === undefined) delete process.env[chave];
      else process.env[chave] = anteriores[i];
    });
  }
});
