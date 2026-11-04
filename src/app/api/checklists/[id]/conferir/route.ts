import { NextResponse } from "next/server";

import { obterContexto } from "@/core/sessao/contexto";
import { conferirResposta } from "@/modules/checklists/services/conferencia";

import { erroChecklist } from "../../_http";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const contexto = await obterContexto();
  if (!contexto)
    return NextResponse.json({ erro: "Entre no sistema." }, { status: 401 });
  try {
    const { id } = await params;
    const resumo = await conferirResposta(contexto, id);
    return NextResponse.json(resumo, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (erro) {
    return erroChecklist(
      erro,
      "Não foi possível iniciar a conferência. Tente novamente.",
    );
  }
}
