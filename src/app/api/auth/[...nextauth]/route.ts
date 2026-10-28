import { handlers } from "@/core/auth";
import {
  urlDaRequisicaoPublica,
  configurarDominios,
} from "@/lib/dominios-publicos";
import { NextRequest } from "next/server";

function validar(request: NextRequest) {
  const config = configurarDominios(
    process.env.APP_URL,
    process.env.APP_OPERACAO_URL,
    process.env.APP_OPERACAO_ROTA,
  );
  const url = urlDaRequisicaoPublica(request.url, request.headers, config);
  return url ? new NextRequest(url, request) : null;
}
export async function GET(request: NextRequest) {
  const publica = validar(request);
  if (!publica)
    return new Response("Domínio de acesso não reconhecido.", { status: 400 });
  return handlers.GET(publica);
}
export async function POST(request: NextRequest) {
  const publica = validar(request);
  if (!publica)
    return new Response("Domínio de acesso não reconhecido.", { status: 400 });
  return handlers.POST(publica);
}
