import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import {
  ambienteOperacao,
  configOperacao,
  statusEntrega,
  terminal,
} from "./operacao-config";
import { assinatura, decifrar, hash } from "./operacao-seguranca";
import {
  auditar,
  contextoCifra,
  concluir,
  reservar,
  type EscopoSaipos,
} from "./operacao-repositorio";

const object = z.record(z.string(), z.unknown());
export const solicitacaoEntrega = z
  .object({
    orderId: z.uuid(),
    orderDisplayId: z.string().min(1).max(100),
    merchant: z.object({
      id: z.string().min(1).max(100),
      name: z.string().max(500),
    }),
    customerName: z.string().max(500),
    pickupAddress: object,
    deliveryAddress: object,
    totalOrderPrice: object,
    payments: z.array(object).max(30),
  })
  .passthrough();
export const trackingEntrega = z
  .object({
    deliveryId: z.uuid(),
    orderId: z.uuid(),
    orderDisplayId: z.string().min(1).max(100),
    merchant: z.object({
      id: z.string().min(1).max(100),
      name: z.string().max(500),
    }),
    event: z.object({
      type: statusEntrega,
      datetime: z.iso.datetime({ offset: true }),
      message: z.string().max(1000).optional(),
      rejectionInfo: object.optional(),
    }),
    vehicle: object.optional(),
    deliveryPrice: object.optional(),
    eta: object.optional(),
    deliveryPerson: object.optional(),
  })
  .superRefine((p, ctx) => {
    if (!["PENDING", "REJECTED", "CANCELLED"].includes(p.event.type))
      for (const field of [
        "vehicle",
        "deliveryPrice",
        "eta",
        "deliveryPerson",
      ] as const)
        if (!p[field])
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `Informe ${field} para esse evento.`,
          });
    if (["REJECTED", "CANCELLED"].includes(p.event.type) && !p.event.message)
      ctx.addIssue({
        code: "custom",
        path: ["event", "message"],
        message: "Informe o motivo.",
      });
  });

export async function receberEntrega(
  scope: EscopoSaipos,
  raw: unknown,
  started = Date.now(),
) {
  const c = configOperacao("logistica"),
    input = solicitacaoEntrega.parse(raw);
  if (input.merchant.id !== c.merchantId || scope.unidadeId !== c.unidadeId)
    throw new Error("Merchant inválido.");
  if (Date.now() - started > 4000) throw new Error("Solicitação expirada.");
  const result = await reservar(
    scope,
    "ENTREGA",
    input.orderId,
    input.orderId,
    input,
  );
  if (!result.nova && terminal(result.row.estado))
    throw new Error(
      "Entrega encerrada. Uma nova tentativa deve ser conciliada com o parceiro.",
    );
  if (result.nova) await concluir(scope, result.row.id, "PENDING");
  if (Date.now() - started > 7000) {
    if (result.nova) await concluir(scope, result.row.id, "EXPIRADO");
    throw new Error("Solicitação expirada; nenhum despacho permitido.");
  }
  const created = result.row.criadoEm.getTime();
  return {
    deliveryId: result.row.id,
    event: "PENDING",
    completion: {
      estimate: new Date(created + 60000).toISOString(),
      rejectAfter: new Date(created + 15 * 60000).toISOString(),
    },
  };
}
export async function receberAvisoEntrega(
  scope: EscopoSaipos,
  orderId: string,
  acao: "cancelar" | "pronto",
  body: unknown,
) {
  z.uuid().parse(orderId);
  const c = configOperacao("logistica");
  const delivery = await db.saiposOperacao.findFirst({
    where: {
      organizacaoId: scope.organizacaoId,
      unidadeId: scope.unidadeId,
      ambiente: c.ambiente,
      tipo: "ENTREGA",
      referencia: orderId,
      excluidoEm: null,
    },
  });
  if (!delivery) throw new Error("Entrega não encontrada.");
  const event = acao === "cancelar" ? "CANCELLED" : "READY_FOR_PICKUP";
  const saved = await reservar(
    scope,
    "AVISO",
    `${delivery.id}:${event}`,
    orderId,
    body,
  );
  if (saved.nova) await concluir(scope, saved.row.id, event);
  if (acao === "cancelar") await concluir(scope, delivery.id, "CANCELLED");
  return acao === "cancelar" ? { additionalCharges: false } : {};
}
export async function enviarTracking(
  scope: EscopoSaipos,
  raw: unknown,
  transport: typeof fetch = fetch,
) {
  const c = configOperacao("logistica"),
    input = trackingEntrega.parse(raw);
  if (scope.unidadeId !== c.unidadeId || input.merchant.id !== c.merchantId)
    throw new Error("Merchant inválido.");
  const delivery = await db.saiposOperacao.findFirst({
    where: {
      id: input.deliveryId,
      organizacaoId: scope.organizacaoId,
      unidadeId: scope.unidadeId,
      ambiente: c.ambiente,
      tipo: "ENTREGA",
      referencia: input.orderId,
      excluidoEm: null,
    },
  });
  if (!delivery)
    throw new Error("Par deliveryId/orderId não encontrado nesta unidade.");
  if (
    terminal(delivery.estado) ||
    ["EXPIRADO", "CONFERIR", "ENVIANDO", "TRACKING_EM_ENVIO"].includes(
      delivery.estado,
    )
  )
    throw new Error(
      "Entrega encerrada ou pendente de conferência; nenhum novo despacho permitido.",
    );
  if (
    delivery.estado === "PENDING" &&
    Date.now() - delivery.criadoEm.getTime() >= 15 * 60000
  )
    throw new Error(
      "Prazo de aceitação expirado; confira a entrega na Saipos.",
    );
  const unresolved = await db.saiposOperacao.findFirst({
    where: {
      organizacaoId: scope.organizacaoId,
      unidadeId: scope.unidadeId,
      ambiente: c.ambiente,
      tipo: "TRACKING",
      referencia: input.orderId,
      estado: { in: ["INCERTO", "ENVIANDO"] },
    },
  });
  if (unresolved)
    throw new Error(
      "Há um tracking pendente de conferência para esta entrega.",
    );
  // Um timeout anterior não autoriza novo envio com outro corpo/identificador.
  const key = `${input.deliveryId}:${hash(JSON.stringify(input.event))}`;
  const saved = await reservar(scope, "TRACKING", key, input.orderId, input);
  if (!saved.nova)
    return { id: saved.row.id, estado: saved.row.estado, repetida: true };
  const claimed = await db.saiposOperacao.updateMany({
    where: {
      id: delivery.id,
      versao: delivery.versao,
      estado: delivery.estado,
    },
    data: { estado: "TRACKING_EM_ENVIO", versao: { increment: 1 } },
  });
  if (!claimed.count) {
    await concluir(
      scope,
      saved.row.id,
      "RECUSADO",
      undefined,
      "Entrega alterada por outra operação; nenhum tracking enviado.",
    );
    throw new Error("Entrega alterada. Recarregue antes de continuar.");
  }
  const wire = JSON.stringify(input);
  try {
    const response = await transport(
      "https://logistics-api.saipos.com/delivery-tracking/tracking-event-webhook",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          "Content-Type": "application/json",
          "X-App-Id": process.env.SAIPOS_LOGISTICS_APP_ID ?? "Tetteo",
          "X-App-MerchantId": c.merchantId,
          "X-App-Signature": assinatura(wire, c.secret),
        },
        body: wire,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      await concluir(
        scope,
        saved.row.id,
        response.status >= 500 ? "INCERTO" : "RECUSADO",
        undefined,
        `Saipos respondeu HTTP ${response.status}.`,
      );
      if (response.status === 400)
        await concluir(
          scope,
          delivery.id,
          "CONFERIR",
          undefined,
          "Vínculo não confirmado na Saipos; não despachar sem conferência.",
        );
      throw new Error(
        "Tracking não confirmado na Saipos. Confira o vínculo e a entrega.",
      );
    }
    await response.body?.cancel();
    await db.$transaction(async (tx) => {
      // A confirmação remota nunca sobrescreve cancelamento concorrente da loja.
      await tx.saiposOperacao.updateMany({
        where: {
          id: delivery.id,
          versao: delivery.versao + 1,
          estado: "TRACKING_EM_ENVIO",
        },
        data: { estado: input.event.type, versao: { increment: 1 } },
      });
      await auditar(tx, scope, delivery.id, input.event.type);
    });
    await concluir(scope, saved.row.id, "CONFIRMADO");
    return { id: saved.row.id, estado: "CONFIRMADO", repetida: false };
  } catch (e) {
    await db.saiposOperacao.updateMany({
      where: {
        id: delivery.id,
        versao: delivery.versao + 1,
        estado: "TRACKING_EM_ENVIO",
      },
      data: { estado: "CONFERIR", versao: { increment: 1 } },
    });
    await db.saiposOperacao.updateMany({
      where: { id: saved.row.id, estado: "ENVIANDO" },
      data: {
        estado: "INCERTO",
        erro: "Resposta incerta do tracking. Conferir antes de reenviar.",
      },
    });
    throw new Error(
      e instanceof Error && e.message.startsWith("Tracking")
        ? e.message
        : "Resposta incerta do tracking. Confira antes de reenviar.",
    );
  }
}
export async function listarEntregas(scope: EscopoSaipos) {
  const rows = await db.saiposOperacao.findMany({
    where: {
      organizacaoId: scope.organizacaoId,
      unidadeId: scope.unidadeId,
      ambiente: ambienteOperacao(),
      tipo: "ENTREGA",
      excluidoEm: null,
    },
    orderBy: { criadoEm: "desc" },
    take: 30,
  });
  return rows.map((row) => ({
    id: row.id,
    referencia: row.referencia,
    estado: row.estado,
    criadoEm: row.criadoEm.toISOString(),
    dados: solicitacaoEntrega.parse(
      decifrar(row.payloadCifrado, contextoCifra(scope)),
    ),
  }));
}
export const novoIdEntrega = () => randomUUID();
