import { obterContexto } from "@/core/sessao/contexto";
import { transacaoFinanceira } from "@/modules/financeiro/services/integrado";
import { gravarDocumentoPrivado } from "@/server/documento-privado";
const resposta = (d: unknown, status = 200) =>
  Response.json(d, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pessoaId: string }> },
) {
  const ctx = await obterContexto();
  if (!ctx) return resposta({ erro: "Entre no sistema." }, 401);
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return resposta({ erro: "Origem não autorizada." }, 403);
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Envie um documento.");
    const partes: Uint8Array[] = [];
    let tamanho = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      tamanho += value.length;
      if (tamanho > 6 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Envio excede 5 MB.");
      }
      partes.push(value);
    }
    const form = await new Response(Buffer.concat(partes), {
      headers: { "Content-Type": req.headers.get("content-type") ?? "" },
    }).formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) throw new Error("Envie um documento.");
    const { pessoaId } = await params;
    return resposta(
      await transacaoFinanceira(ctx, "financeiro.lancar", async (tx, u) => {
        if (
          !(await tx.pessoaFinanceira.count({
            where: {
              id: pessoaId,
              organizacaoId: ctx.organizacao.id,
              unidadeId: u,
            },
          }))
        )
          throw new Error("Pessoa não encontrada.");
        const salvo = await gravarDocumentoPrivado(tx, {
          organizacaoId: ctx.organizacao.id,
          unidadeId: u,
          usuarioId: ctx.usuario.id,
          pessoaId,
          bytes: new Uint8Array(await arquivo.arrayBuffer()),
          nome: arquivo.name,
        });
        await tx.auditoria.create({
          data: {
            organizacaoId: ctx.organizacao.id,
            unidadeId: u,
            usuarioId: ctx.usuario.id,
            entidade: "Arquivo",
            entidadeId: salvo.id,
            acao: "CRIOU",
            valoresDepois: { pessoaId, nome: salvo.nomeOriginal },
          },
        });
        return salvo;
      }),
    );
  } catch (e) {
    return resposta(
      {
        erro:
          e instanceof Error && !e.constructor.name.startsWith("Prisma")
            ? e.message
            : "Não foi possível salvar o documento.",
      },
      400,
    );
  }
}
