import { NextResponse } from "next/server";

import { obterContexto } from "@/core/sessao/contexto";
import {
  ErroEvidencia,
  esquemaEnvioEvidencia,
  faixaDaEvidencia,
  lerCorpoLimitado,
} from "@/modules/checklists/schemas/evidencia";
import {
  lerEvidencia,
  removerEvidencia,
} from "@/modules/checklists/services/evidencias";

import { erroChecklist } from "../../../_http";

export const runtime = "nodejs";
type Parametros = { params: Promise<{ id: string; evidenciaId: string }> };

export async function GET(request: Request, { params }: Parametros) {
  const contexto = await obterContexto();
  if (!contexto) return new Response("Não encontrado.", { status: 404 });
  try {
    const { id, evidenciaId } = await params;
    const arquivo = await lerEvidencia(contexto, id, evidenciaId);
    if (!arquivo) return new Response("Não encontrado.", { status: 404 });
    const { registro, bytes } = arquivo;
    const headers: Record<string, string> = {
      "Content-Type": registro.tipo,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Referrer-Policy": "no-referrer",
      "Accept-Ranges": "bytes",
    };
    const faixa = request.headers.get("range");
    if (faixa) {
      const limites = faixaDaEvidencia(faixa, bytes.length);
      if (!limites)
        return new Response(null, {
          status: 416,
          headers: {
            ...headers,
            "Content-Range": `bytes */${bytes.length}`,
            "Content-Length": "0",
          },
        });
      const { inicio, fim } = limites;
      return new Response(new Uint8Array(bytes.subarray(inicio, fim + 1)), {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${inicio}-${fim}/${bytes.length}`,
          "Content-Length": String(fim - inicio + 1),
        },
      });
    }
    return new Response(new Uint8Array(bytes), { headers });
  } catch {
    return new Response("Não encontrado.", { status: 404 });
  }
}

export async function DELETE(request: Request, { params }: Parametros) {
  const contexto = await obterContexto();
  if (!contexto)
    return NextResponse.json({ erro: "Entre no sistema." }, { status: 401 });
  try {
    const { id, evidenciaId } = await params;
    let entrada: unknown;
    try {
      entrada = JSON.parse(
        new TextDecoder().decode(await lerCorpoLimitado(request, 4096)),
      );
    } catch (erro) {
      if (erro instanceof ErroEvidencia) throw erro;
      throw new ErroEvidencia("Confira os dados de remoção.");
    }
    const dados = esquemaEnvioEvidencia
      .pick({ versaoEsperada: true })
      .parse(entrada);
    return NextResponse.json(
      await removerEvidencia(contexto, id, evidenciaId, dados.versaoEsperada),
    );
  } catch (erro) {
    return erroChecklist(erro, "Não foi possível remover a evidência.");
  }
}
