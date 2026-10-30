import { obterContexto, pode } from "@/core/sessao/contexto";
import { clienteInter } from "@/connectors/inter/cliente";
import {
  obterIntegracaoInter,
  processarExtratoInter,
  registrarEstadoInter,
} from "@/modules/financeiro/services/integrado";
export const runtime = "nodejs";
const resposta = (dados: unknown, status = 200) =>
  Response.json(dados, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(
  req: Request,
  { params }: { params: Promise<{ operacao: string }> },
) {
  const ctx = await obterContexto();
  if (!ctx) return resposta({ erro: "Entre no sistema.", isError: true }, 401);
  if (
    !ctx.ehDiretor ||
    !pode(ctx, "financeiro.ver") ||
    !pode(ctx, "financeiro.quitar")
  )
    return resposta(
      { erro: "Apenas o diretor pode acessar o Inter.", isError: true },
      403,
    );
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return resposta({ erro: "Origem não autorizada.", isError: true }, 403);
  const { operacao } = await params;
  if (!["teste", "sincronizar"].includes(operacao))
    return resposta({ erro: "Rota não encontrada.", isError: true }, 404);
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[\w-]{1,128}$/.test(id))
    return resposta({ erro: "Escolha uma integração.", isError: true }, 400);
  let cliente: Awaited<ReturnType<typeof clienteInter>> | undefined;
  let autorizada = false;
  try {
    const i = await obterIntegracaoInter(ctx, id);
    autorizada = true;
    cliente = await clienteInter({
      id: i.id,
      envKey: i.envKey,
      ambiente: i.ambiente,
      cnpj: i.empresa.cnpj,
    });
    if (operacao === "teste") {
      await cliente.testar();
      return resposta({
        ok: true,
        mensagem: "Conexão mTLS e consulta de saldo confirmadas.",
      });
    }
    const ate = new Date().toISOString().slice(0, 10),
      de = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const transacoes = await cliente.extrato(de, ate);
    const totais = await processarExtratoInter(ctx, id, transacoes);
    await registrarEstadoInter(ctx, id, null);
    return resposta({ ok: true, ...totais });
  } catch (e) {
    // Mensagens do conector são locais e não incluem respostas, tokens ou certificados.
    const erro =
      e instanceof Error && !e.constructor.name.startsWith("Prisma")
        ? e.message
        : "Não foi possível concluir a operação. Tente novamente.";
    if (autorizada) await registrarEstadoInter(ctx, id, erro).catch(() => {});
    return resposta({ erro, isError: true }, 400);
  } finally {
    cliente?.fechar();
  }
}
