import { z } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { escopoOperacao } from "@/connectors/saipos/operacao-repositorio";
import { enviarComando } from "@/connectors/saipos/operacoes";
import { enviarTracking } from "@/connectors/saipos/logistica";
import {
  lerCorpo,
  origemOperacaoValida,
} from "@/connectors/saipos/operacao-seguranca";
import { configOperacao } from "@/connectors/saipos/operacao-config";
import { PedidosSaipos, FalhaPedidos } from "@/connectors/saipos/pedidos";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const context = await obterContexto();
  if (!context?.ehDiretor || !context.unidadeAtiva)
    return Response.json(
      { error: "Acesso restrito ao diretor de uma unidade." },
      { status: 403, headers },
    );
  // API de sessão: bloquear CSRF antes de qualquer envio ao fornecedor.
  if (!origemOperacaoValida(request))
    return Response.json(
      { error: "Origem inválida." },
      { status: 403, headers },
    );
  try {
    const scope = await escopoOperacao(context);
    const body = z
      .object({
        tipo: z.enum(["pedido", "consulta", "tracking"]),
        dados: z.unknown(),
      })
      .parse(JSON.parse(await lerCorpo(request)));
    let result: unknown;
    if (body.tipo === "pedido") result = await enviarComando(scope, body.dados);
    else if (body.tipo === "tracking")
      result = await enviarTracking(scope, body.dados);
    else {
      if (configOperacao("pedidos").unidadeId !== scope.unidadeId)
        throw new Error("Consulta indisponível nesta unidade.");
      const input = z
        .object({
          consulta: z.string().max(30),
          parametros: z.record(z.string(), z.string().max(100)).optional(),
        })
        .parse(body.dados);
      result = await new PedidosSaipos().consultar(
        input.consulta,
        input.parametros,
      );
    }
    return Response.json({ result }, { headers });
  } catch (e) {
    const error =
      e instanceof z.ZodError
        ? "Dados inválidos. Confira os campos obrigatórios do contrato Saipos."
        : e instanceof Error &&
            !(e instanceof SyntaxError) &&
            (e instanceof FalhaPedidos || !e.message.includes("prisma"))
          ? e.message
          : "Não foi possível concluir a operação.";
    // Mensagens locais são fixas; erros Prisma/criptográficos não vão ao navegador.
    const safe = /prisma|Invalid|invocation|cipher|database|connection/i.test(
      error,
    )
      ? "Operação não concluída. Verifique a configuração privada do servidor."
      : error;
    return Response.json({ error: safe }, { status: 400, headers });
  }
}
