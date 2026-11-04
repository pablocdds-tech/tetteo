import { z } from "zod";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { permitirTentativa } from "@/core/auth/limites";
import { validCrmOrigin, readCrmBody } from "@/modules/crm/services/request";
import {
  listVirtualInbox,
  getVirtualConversation,
  getVirtualHealth,
  simulateVirtualMessage,
} from "@/modules/crm/services/virtual-inbox";
import { actOnVirtualConversation } from "@/modules/crm/services/virtual-runtime";
import {
  virtualKnowledge,
  changeVirtualKnowledge,
} from "@/modules/crm/services/virtual-knowledge";
import { CrmError } from "@/modules/crm/services/campaign-domain";
import {
  getVirtualModelStatus,
  changeVirtualModel,
} from "@/modules/crm/services/virtual-model";
import {
  virtualSettings,
  changeVirtualSettings,
} from "@/modules/crm/services/virtual-settings";
import {
  virtualChannels,
  changeVirtualChannel,
} from "@/modules/crm/services/virtual-channels";
import {
  virtualPolicy,
  changeVirtualPolicy,
} from "@/modules/crm/services/virtual-policy";
import { virtualQuality } from "@/modules/crm/services/virtual-quality";
import { bindVirtualCustomer } from "@/modules/crm/services/virtual-identity";
import { getVirtualMessagePage } from "@/modules/crm/services/virtual-message-page";
import {
  getVirtualHistory,
  startVirtualHistory,
} from "@/modules/crm/services/virtual-history";
import {
  managementFor,
  channelFor,
} from "@/app/api/atendimento/_costura/providers";

export const runtime = "nodejs";
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function handle(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  try {
    const context = await obterContexto();
    if (!context)
      return json(
        { error: "Entre no sistema para acessar o atendimento." },
        401,
      );
    if (!pode(context, "crm.ver"))
      return json({ error: "Sem permissão para ver o atendimento." }, 403);
    const storeId = context.unidadeAtiva?.id;
    if (!storeId)
      return json({ error: "Selecione uma unidade no menu do sistema." }, 400);
    const writing = request.method !== "GET";
    if (writing && (!pode(context, "crm.editar") || !validCrmOrigin(request)))
      return json({ error: "Operação ou origem não autorizada." }, 403);
    if (
      !(await permitirTentativa(
        "atendimento",
        `${context.organizacao.id}:${context.usuario.id}`,
        writing ? 60 : 240,
        60_000,
      ))
    )
      return json({ error: "Muitas solicitações. Aguarde um minuto." }, 429);
    const url = new URL(request.url);
    if (
      [...new Set(url.searchParams.keys())].some(
        (k) => url.searchParams.getAll(k).length !== 1,
      )
    )
      return json({ error: "Filtros duplicados." }, 400);
    const query = Object.fromEntries(url.searchParams);
    const body = writing ? await readCrmBody(request) : undefined;
    const requested =
      body && typeof body === "object" && "storeId" in body
        ? body.storeId
        : query.storeId;
    if (requested !== undefined && requested !== storeId)
      return json({ error: "A unidade mudou. Atualize a tela." }, 403);
    const { path = [] } = await params;
    const accountId =
      query.accountId === undefined
        ? undefined
        : z.string().uuid().parse(query.accountId);
    if (path.length === 1 && path[0] === "channels")
      return json(
        writing
          ? await changeVirtualChannel(context, body, managementFor)
          : await virtualChannels(context, storeId),
      );
    if (path.length === 1 && path[0] === "history") {
      if (writing) return json(await startVirtualHistory(context, body), 202);
      if (!accountId)
        return json(
          { error: "Selecione o WhatsApp para consultar o histórico." },
          400,
        );
      return json(await getVirtualHistory(context, storeId, accountId));
    }
    if (path.length === 1 && path[0] === "policy")
      return json(
        writing
          ? await changeVirtualPolicy(context, body)
          : await virtualPolicy(context, storeId),
      );
    if (path.length === 1 && path[0] === "quality" && !writing)
      return json(
        await virtualQuality(
          context,
          storeId,
          accountId,
          z.coerce
            .number()
            .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
            .parse(query.periodDays ?? 30),
        ),
      );
    if (path.length === 1 && path[0] === "bind-customer" && writing)
      return json(await bindVirtualCustomer(context, body));
    if (path.length === 1 && path[0] === "model")
      return json(
        writing
          ? await changeVirtualModel(context, body)
          : await getVirtualModelStatus(context, storeId),
      );
    if (!path.length && !writing)
      return json(await listVirtualInbox(context, { ...query, storeId }));
    if (path.length === 1 && path[0] === "health" && !writing)
      return json(await getVirtualHealth(context, storeId, accountId));
    if (path.length === 1 && path[0] === "knowledge")
      return json(
        writing
          ? await changeVirtualKnowledge(context, body)
          : await virtualKnowledge(context, storeId, accountId),
      );
    if (path.length === 1 && path[0] === "settings")
      return json(
        writing
          ? await changeVirtualSettings(context, body)
          : await virtualSettings(context, storeId, accountId),
      );
    if (path.length === 1 && path[0] === "demo" && writing)
      return json(await simulateVirtualMessage(context, body), 202);
    if (
      path.length === 2 &&
      path[1] === "messages" &&
      !writing &&
      z.string().uuid().safeParse(path[0]).success
    )
      return json(
        await getVirtualMessagePage(
          context,
          storeId,
          path[0],
          query.before ?? "",
        ),
      );
    if (path.length === 1 && z.string().uuid().safeParse(path[0]).success)
      return json(
        writing
          ? await actOnVirtualConversation(context, path[0], body, channelFor)
          : await getVirtualConversation(context, storeId, path[0]),
      );
    return json({ error: "Operação de atendimento não encontrada." }, 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        {
          error: "Confira os campos e os limites do atendimento.",
          fields: error.issues.map((i) => i.path.join(".")),
        },
        400,
      );
    if (error instanceof CrmError)
      return json({ error: error.message, code: error.code }, error.status);
    const status =
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 503;
    console.error(
      "[atendimento-api]",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      {
        error:
          "Não foi possível concluir. Atualize a conversa antes de tentar novamente.",
      },
      status,
    );
  }
}
export const GET = handle;
export const POST = handle;
