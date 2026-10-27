import { db } from "@/server/db";
import {
  configOperacao,
  configWebhookPedido,
  ambienteOperacao,
} from "./operacao-config";
import { comandoPedido, FalhaPedidos, PedidosSaipos } from "./pedidos";
import { reservar, concluir, type EscopoSaipos } from "./operacao-repositorio";
import { z } from "zod";
import { hash } from "./operacao-seguranca";

export async function enviarComando(
  scope: EscopoSaipos,
  raw: unknown,
  client = new PedidosSaipos(),
) {
  const c = configOperacao("pedidos");
  if (scope.unidadeId !== c.unidadeId)
    throw new Error("API de Pedidos não configurada para esta unidade.");
  const command = comandoPedido.parse(raw);
  const reference =
    command.acao === "criar" || command.acao === "adicionar"
      ? command.pedido.order_id
      : command.acao === "converter"
        ? command.table
        : command.order_id;
  if (!["criar", "converter"].includes(command.acao)) {
    const existing = await db.saiposOperacao.findFirst({
      where: {
        organizacaoId: scope.organizacaoId,
        unidadeId: scope.unidadeId,
        ambiente: c.ambiente,
        tipo: "PEDIDO",
        referencia: reference,
        excluidoEm: null,
      },
    });
    if (!existing || !["RECEBIDO", "CONVERTIDO"].includes(existing.estado))
      throw new Error("Pedido sem vínculo confirmado neste canal e unidade.");
  }
  const key =
    command.acao === "criar"
      ? reference
      : command.acao === "adicionar"
        ? command.comando_id
        : hash(JSON.stringify(command));
  const { row, nova } = await reservar(
    scope,
    command.acao === "criar" ? "PEDIDO" : "COMANDO",
    key,
    reference,
    command,
  );
  if (!nova) return { id: row.id, estado: row.estado, repetida: true };
  try {
    const response = await client.executar(command);
    if (command.acao === "converter") {
      const converted = z
        .object({
          order_ids: z
            .array(z.object({ order_id: z.string().min(1).max(100) }))
            .max(1000),
        })
        .parse(response);
      for (const order of converted.order_ids) {
        const parent = await reservar(
          scope,
          "PEDIDO",
          order.order_id,
          order.order_id,
          { origem: "conversao", mesa: command.table },
        );
        if (parent.nova) await concluir(scope, parent.row.id, "CONVERTIDO");
      }
    }
    await concluir(scope, row.id, "RECEBIDO", response);
    return { id: row.id, estado: "RECEBIDO", repetida: false };
  } catch (e) {
    const state =
      e instanceof FalhaPedidos && !e.incerta ? "RECUSADO" : "INCERTO";
    await concluir(
      scope,
      row.id,
      state,
      e instanceof FalhaPedidos ? e.resposta : undefined,
      e instanceof FalhaPedidos
        ? e.message
        : "Operação pendente de conferência na Saipos.",
    );
    throw new Error(
      e instanceof FalhaPedidos
        ? e.message
        : "Operação pendente de conferência na Saipos.",
    );
  }
}
export async function registrarEventoPedido(scope: EscopoSaipos, raw: unknown) {
  const event = z
    .object({
      event: z.enum([
        "CONFIRMED",
        "READY_TO_DELIVER",
        "DISPATCHED",
        "CONCLUDED",
        "CANCELLED",
      ]),
      cod_store: z.string(),
      order_id: z.string().min(1).max(100),
    })
    .parse(raw);
  const c = configWebhookPedido();
  if (event.cod_store !== c.codStore || scope.unidadeId !== c.unidadeId)
    throw new Error("Loja inválida.");
  const original = await db.saiposOperacao.findFirst({
    where: {
      organizacaoId: scope.organizacaoId,
      unidadeId: scope.unidadeId,
      ambiente: ambienteOperacao(),
      tipo: "PEDIDO",
      referencia: event.order_id,
      excluidoEm: null,
    },
  });
  if (!original) throw new Error("Pedido desconhecido.");
  const saved = await reservar(
    scope,
    "EVENTO",
    `${event.order_id}:${event.event}`,
    event.order_id,
    event,
  );
  // Eventos não têm sequência/instante no contrato. Guardar todos sem regredir
  // o estado canônico do pedido por uma notificação atrasada.
  if (saved.nova) await concluir(scope, saved.row.id, event.event);
}
