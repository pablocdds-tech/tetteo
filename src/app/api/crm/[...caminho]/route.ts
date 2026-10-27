import { randomUUID } from "node:crypto";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { permitirTentativa } from "@/core/auth/limites";
import { crmUser } from "@/modules/crm/services/scope";
import contactRoutes from "@/modules/crm/services/routes";
import atendimentoRoutes from "@/modules/crm/services/atendimento-routes";
import campaignRoutes from "@/modules/crm/services/campaign-routes";
import { advanceCrmJobs } from "@/modules/crm/services/jobs";
import { syncSaiposLinks } from "@/modules/crm/services/saipos-links";
import { validCrmOrigin, readCrmBody } from "@/modules/crm/services/request";

export const runtime = "nodejs";
const respond = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function handle(
  request: Request,
  { params }: { params: Promise<{ caminho: string[] }> },
) {
  const requestId = randomUUID();
  try {
    const ctx = await obterContexto();
    if (!ctx)
      return respond({ error: "Entre no sistema para acessar o CRM." }, 401);
    if (!pode(ctx, "crm.ver"))
      return respond({ error: "Sem permissão para acessar o CRM." }, 403);
    if (!ctx.unidadeAtiva)
      return respond(
        { error: "Selecione uma unidade no menu do sistema." },
        400,
      );
    const user = crmUser(ctx);
    const writing = request.method !== "GET";
    if (writing && !pode(ctx, "crm.editar"))
      return respond({ error: "Sem permissão para alterar o CRM." }, 403);
    if (writing && !validCrmOrigin(request))
      return respond({ error: "Origem do envio não autorizada." }, 403);
    if (
      !(await permitirTentativa(
        "crm",
        `${ctx.organizacao.id}:${user.userId}`,
        writing ? 60 : 240,
        60_000,
      ))
    )
      return respond({ error: "Muitas solicitações. Aguarde um minuto." }, 429);
    const { caminho } = await params;
    const url = new URL(request.url);
    // Duplicate query values are not silently reduced to a different scope.
    if (
      [...new Set(url.searchParams.keys())].some(
        (k) => url.searchParams.getAll(k).length !== 1,
      )
    )
      return respond({ error: "Filtros duplicados." }, 400);
    if (caminho.join("/") === "stores" && !writing)
      return respond([
        { id: ctx.unidadeAtiva.id, name: ctx.unidadeAtiva.nome },
      ]);
    const body = writing ? await readCrmBody(request) : undefined;
    const query = Object.fromEntries(url.searchParams);
    const requested =
      query.storeId ??
      (body && typeof body === "object" && "storeId" in body
        ? body.storeId
        : undefined);
    if (
      requested !== undefined &&
      requested !== "all" &&
      requested !== ctx.unidadeAtiva.id
    )
      return respond(
        { error: "A unidade mudou. Atualize a tela antes de continuar." },
        403,
      );
    if (
      caminho[0] === "audiences" ||
      caminho[0] === "imports" ||
      caminho.at(-1) === "result"
    )
      await advanceCrmJobs(ctx.unidadeAtiva.id);
    else if (!writing && caminho[0] !== "atendimento")
      await syncSaiposLinks(ctx.unidadeAtiva.id);
    const req = {
      user,
      query,
      params: {},
      body,
      method: request.method,
      path: `/${caminho.join("/")}`,
      header: (name: string) => request.headers.get(name) ?? undefined,
    };
    return (
      (await atendimentoRoutes.dispatch(req)) ??
      (await contactRoutes.dispatch(req)) ??
      (await campaignRoutes.dispatch(req)) ??
      respond({ error: "Operação do CRM não encontrada." }, 404)
    );
  } catch (error) {
    const status =
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 503;
    console.error(
      "[crm]",
      requestId,
      error instanceof Error ? error.name : "unknown",
    );
    return respond(
      {
        error:
          status < 500 && error instanceof Error
            ? error.message
            : "Não foi possível concluir. Os dados anteriores foram preservados.",
        requestId,
      },
      status,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
