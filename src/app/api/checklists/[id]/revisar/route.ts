import { NextResponse } from "next/server";

import { obterContexto } from "@/core/sessao/contexto";
import {
  ErroEvidencia,
  lerCorpoLimitado,
} from "@/modules/checklists/schemas/evidencia";
import { revisarItemChecklist } from "@/modules/checklists/services/conferencia";

import { erroChecklist } from "../../_http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const contexto = await obterContexto();
  if (!contexto)
    return NextResponse.json({ erro: "Entre no sistema." }, { status: 401 });
  try {
    const { id } = await params;
    let dados: unknown;
    try {
      dados = JSON.parse(
        new TextDecoder().decode(await lerCorpoLimitado(request, 16 * 1024)),
      );
    } catch (erro) {
      if (erro instanceof ErroEvidencia) throw erro;
      throw new ErroEvidencia("Confira os dados da revisão.");
    }
    const revisao = await revisarItemChecklist(contexto, id, dados);
    return NextResponse.json(revisao, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (erro) {
    return erroChecklist(erro, "Não foi possível registrar a revisão.");
  }
}
