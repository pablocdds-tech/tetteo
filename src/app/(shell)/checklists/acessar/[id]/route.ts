import { NextResponse } from "next/server";
import {
  contextoDeFundo,
  COOKIE_UNIDADE,
  obterContexto,
  pode,
} from "@/core/sessao/contexto";
import { db } from "@/server/db";
import { dominiosPublicos } from "@/core/superficie";
import { urlDaRequisicaoPublica } from "@/lib/dominios-publicos";

/** O link escolhe a unidade somente depois de validar o acesso real do usuário. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const publica = urlDaRequisicaoPublica(
    request.url,
    request.headers,
    dominiosPublicos(),
    process.env.APP_URL,
  );
  if (!publica)
    return new NextResponse("Domínio de acesso não reconhecido.", {
      status: 400,
    });
  const { id } = await params;
  const contexto = await obterContexto();
  if (!contexto)
    return NextResponse.redirect(
      new URL(
        `/login?callbackUrl=${encodeURIComponent(`/checklists/acessar/${id}`)}`,
        publica,
      ),
    );
  const resposta = await db.respostaDeChecklist.findFirst({
    where: {
      id,
      unidadeId: { in: contexto.unidadesVisiveis.map((u) => u.id) },
      modelo: { organizacaoId: contexto.organizacao.id },
    },
    select: { unidadeId: true },
  });
  const destino = resposta
    ? await contextoDeFundo(contexto.usuario.id, resposta.unidadeId)
    : null;
  if (!resposta || !destino || !pode(destino, "checklists.ver"))
    return new NextResponse("Checklist não encontrado ou sem acesso.", {
      status: 404,
    });
  const retorno = NextResponse.redirect(new URL(`/checklists/${id}`, publica));
  retorno.headers.set("Cache-Control", "private, no-store");
  retorno.cookies.set(COOKIE_UNIDADE, resposta.unidadeId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return retorno;
}
