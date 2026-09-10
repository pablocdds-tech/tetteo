import { obterContexto, pode } from "@/core/sessao/contexto";
import { lerArquivo } from "@/server/arquivos";

/**
 * GET /api/arquivos/<id> — entrega de arquivo privado.
 *
 * Confere, nesta ordem: sessão, organização, loja visível e a permissão de
 * leitura gravada com o arquivo. Qualquer "não" vira 404 — responder 403
 * contaria a quem não pode ver que o arquivo existe.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await obterContexto();
  if (!ctx) return new Response("Não encontrado.", { status: 404 });

  const { id } = await params;
  const achado = await lerArquivo(id);
  if (!achado) return new Response("Não encontrado.", { status: 404 });

  const { registro, bytes } = achado;
  const lojaVisivel =
    registro.unidadeId === null ||
    ctx.unidadesVisiveis.some((u) => u.id === registro.unidadeId);
  if (
    registro.organizacaoId !== ctx.organizacao.id ||
    !lojaVisivel ||
    !pode(ctx, registro.permissaoLeitura)
  ) {
    return new Response("Não encontrado.", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": registro.tipo,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
