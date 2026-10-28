import { handlers } from "@/core/auth";
import {
  ambienteDaRequisicao,
  configurarDominios,
} from "@/lib/dominios-publicos";
import type { NextRequest } from "next/server";

function validar(request: NextRequest) {
  const config = configurarDominios(
    process.env.APP_URL,
    process.env.APP_OPERACAO_URL,
    process.env.APP_OPERACAO_ROTA,
  );
  return ambienteDaRequisicao(request.headers, config) !== null;
}
export async function GET(request: NextRequest) {
  if (!validar(request))
    return new Response("Domínio de acesso não reconhecido.", { status: 400 });
  return handlers.GET(request);
}
export async function POST(request: NextRequest) {
  if (!validar(request))
    return new Response("Domínio de acesso não reconhecido.", { status: 400 });
  return handlers.POST(request);
}
