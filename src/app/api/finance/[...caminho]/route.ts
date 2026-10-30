import { obterContexto, pode } from "@/core/sessao/contexto";
/** A auditoria anterior foi substituída; seus registros históricos são preservados. */
async function encerrado() {
  const ctx = await obterContexto();
  if (!ctx || !pode(ctx, "financeiro.ver"))
    return Response.json({ erro: "Não encontrado." }, { status: 404 });
  return Response.json(
    {
      erro: "A auditoria anterior foi substituída pela conciliação Inter. Abra /financeiro/conciliacao.",
    },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
export const GET = encerrado;
export const POST = encerrado;
