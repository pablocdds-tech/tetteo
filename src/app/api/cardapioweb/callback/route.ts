import { NextRequest, NextResponse } from "next/server";
import { obterContexto } from "@/core/sessao/contexto";
import { configCw, ErroCw } from "@/connectors/cardapioweb/config";
import { escopoCw, validarRetornoCw } from "@/connectors/cardapioweb/seguranca";
import { receberCw } from "@/connectors/cardapioweb/servico";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let config;
  try {
    config = configCw();
  } catch {
    return new Response(
      "O aplicativo Cardápio Web ainda não foi configurado.",
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }
  const destino = new URL(
    "/configuracoes/integracoes/cardapioweb",
    config.redirectUri,
  );
  try {
    const sessao = await obterContexto();
    if (!sessao)
      throw new ErroCw("sessao", "Entre no Tetteo e reinicie a autorização.");
    const scope = escopoCw(sessao);
    const { state, code } = validarRetornoCw(
      request.nextUrl.searchParams,
      request.cookies.get("tetteo.cw.oauth")?.value,
    );
    await receberCw(scope, state, code);
    destino.searchParams.set("aviso", "conferir");
  } catch (erro) {
    destino.searchParams.set(
      "aviso",
      erro instanceof ErroCw ? erro.codigo : "interno",
    );
  }
  const response = NextResponse.redirect(destino);
  response.cookies.set("tetteo.cw.oauth", "", {
    httpOnly: true,
    secure: config.redirectUri.startsWith("https:"),
    sameSite: "lax",
    path: "/api/cardapioweb/callback",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
