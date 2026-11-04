import { NextResponse } from "next/server";

import { obterContexto, pode } from "@/core/sessao/contexto";
import {
  ErroEvidencia,
  esquemaEnvioEvidencia,
  lerFormularioEvidencia,
  LIMITE_VIDEO_CHECKLIST,
} from "@/modules/checklists/schemas/evidencia";
import { gravarEvidencia } from "@/modules/checklists/services/evidencias";

import { erroChecklist } from "../../_http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const contexto = await obterContexto();
  if (!contexto)
    return NextResponse.json({ erro: "Entre no sistema." }, { status: 401 });
  if (!pode(contexto, "checklists.responder"))
    return NextResponse.json(
      { erro: "Seu perfil não pode responder checklists." },
      { status: 403 },
    );
  try {
    const { id } = await params;
    const formulario = await lerFormularioEvidencia(request);
    const dados = esquemaEnvioEvidencia.parse({
      itemId: formulario.get("itemId"),
      versaoEsperada: formulario.get("versaoEsperada"),
    });
    const arquivo = formulario.get("arquivo");
    if (!(arquivo instanceof File))
      throw new ErroEvidencia("Escolha uma foto ou vídeo.");
    if (arquivo.size > LIMITE_VIDEO_CHECKLIST)
      throw new ErroEvidencia("O vídeo passa de 20 MB.", 413);
    const salvo = await gravarEvidencia(contexto, id, {
      ...dados,
      nome: arquivo.name,
      bytes: new Uint8Array(await arquivo.arrayBuffer()),
    });
    return NextResponse.json(salvo, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (erro) {
    return erroChecklist(
      erro,
      "Não foi possível guardar a evidência. Tente novamente.",
    );
  }
}
