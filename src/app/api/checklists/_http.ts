import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { ErroEvidencia } from "@/modules/checklists/schemas/evidencia";

export function erroChecklist(erro: unknown, mensagem: string) {
  if (erro instanceof ErroEvidencia)
    return NextResponse.json({ erro: erro.message }, { status: erro.status });
  if (erro instanceof SemPermissao)
    return NextResponse.json({ erro: erro.message }, { status: 403 });
  if (erro instanceof ExigeUnidade)
    return NextResponse.json({ erro: erro.message }, { status: 400 });
  if (erro instanceof ZodError)
    return NextResponse.json(
      { erro: erro.issues[0]?.message ?? "Confira os campos informados." },
      { status: 400 },
    );
  if (erro instanceof Error && erro.message === "Checklist não encontrado.")
    return NextResponse.json(
      { erro: "Checklist não encontrado." },
      { status: 404 },
    );
  // Não ecoa erro de Prisma, caminho privado, conteúdo ou credencial do provedor.
  return NextResponse.json({ erro: mensagem }, { status: 500 });
}
