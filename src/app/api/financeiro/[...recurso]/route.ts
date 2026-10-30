import { Prisma } from "@prisma/client";
import { z } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import {
  baixarIntegrado,
  cancelarIntegrado,
  consultarFinanceiro,
  criarTransferenciaIntegrada,
  detalheFinanceiro,
  estornarBaixaIntegrada,
  resolverPendenciasInter,
  salvarCentroIntegrado,
  salvarIntegracaoInter,
  salvarLancamentoIntegrado,
  salvarPessoaIntegrada,
  salvarPlanoIntegrado,
} from "@/modules/financeiro/services/integrado";

export const runtime = "nodejs";
function resposta(dados: unknown, status = 200) {
  return new Response(
    JSON.stringify(dados, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export async function GET(
  req: Request,
  { params }: { params: Promise<{ recurso: string[] }> },
) {
  const ctx = await obterContexto();
  if (!ctx) return resposta({ erro: "Entre no sistema." }, 401);
  try {
    const { recurso } = await params;
    if (!(
      (recurso.length === 1 && recurso[0] === "base") ||
      (recurso.length === 2 && recurso[0] === "lancamentos")
    ))
      return resposta({ erro: "Rota não encontrada." }, 404);
    return resposta(
      recurso[0] === "lancamentos" && recurso.length === 2
        ? await detalheFinanceiro(ctx, recurso[1])
        : await consultarFinanceiro(
            ctx,
            Object.fromEntries(new URL(req.url).searchParams),
          ),
    );
  } catch (e) {
    return falha(e);
  }
}
async function lerJson(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Envie JSON.");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Envio vazio.");
  let total = 0;
  const partes: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 64000) {
      await reader.cancel();
      throw new Error("Envio excede 64 KB.");
    }
    partes.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    throw new Error("JSON inválido.");
  }
}
function falha(e: unknown) {
  if (e instanceof z.ZodError)
    return resposta({ erro: e.issues.map((i) => i.message).join(" ") }, 400);
  if (e instanceof SemPermissao) return resposta({ erro: e.message }, 403);
  if (e instanceof ExigeUnidade) return resposta({ erro: e.message }, 400);
  if (e instanceof Prisma.PrismaClientKnownRequestError)
    return resposta(
      {
        erro:
          e.code === "P2002"
            ? "Já existe um registro com estes dados."
            : "Não foi possível salvar. Atualize a página e tente novamente.",
      },
      409,
    );
  if (
    e instanceof Prisma.PrismaClientUnknownRequestError ||
    e instanceof Prisma.PrismaClientValidationError
  )
    return resposta(
      { erro: "Operação indisponível. Atualize a página e tente novamente." },
      500,
    );
  return resposta(
    { erro: e instanceof Error ? e.message : "Operação indisponível." },
    400,
  );
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ recurso: string[] }> },
) {
  const ctx = await obterContexto();
  if (!ctx) return resposta({ erro: "Entre no sistema." }, 401);
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return resposta({ erro: "Origem não autorizada." }, 403);
  try {
    const { recurso } = await params;
    const d = await lerJson(req);
    const id = () => z.object({ id: z.string().min(1).max(128) }).parse(d).id;
    if (recurso.length !== 1)
      return resposta({ erro: "Rota não encontrada." }, 404);
    switch (recurso[0]) {
      case "lancamentos":
        return resposta(await salvarLancamentoIntegrado(ctx, d));
      case "pessoas":
        return resposta(await salvarPessoaIntegrada(ctx, d));
      case "planos":
        return resposta(await salvarPlanoIntegrado(ctx, d));
      case "centros":
        return resposta(await salvarCentroIntegrado(ctx, d));
      case "integracoes":
        return resposta(await salvarIntegracaoInter(ctx, d));
      case "baixas":
        return resposta(await baixarIntegrado(ctx, d));
      case "estornar":
        return resposta(await estornarBaixaIntegrada(ctx, id()));
      case "cancelar":
        return resposta(await cancelarIntegrado(ctx, id()));
      case "transferencias":
        return resposta(await criarTransferenciaIntegrada(ctx, d));
      case "pendencias":
        return resposta(await resolverPendenciasInter(ctx, d));
      default:
        return resposta({ erro: "Rota não encontrada." }, 404);
    }
  } catch (e) {
    return falha(e);
  }
}
