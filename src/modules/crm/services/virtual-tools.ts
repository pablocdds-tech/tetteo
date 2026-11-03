import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { VirtualTurnInput, VirtualClaim } from "../virtual-types";
import { canonicalHash, CrmError } from "./campaign-domain";
import {
  approvedVirtualKnowledge,
  dateInZone,
  virtualDate,
} from "./virtual-knowledge";
import { assertVirtualTurn, createVirtualEscalation } from "./virtual-runtime";

const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const empty = z.object({}).strict();
const confirmation = z
  .object({ confirmationToken: z.string().uuid() })
  .strict();
export const virtualToolSchemas = {
  buscar_cliente: empty,
  consultar_unidades: empty,
  consultar_cardapio: empty,
  consultar_disponibilidade_reserva: z
    .object({
      date: virtualDate,
      time: hhmm,
      partySize: z.number().int().min(1).max(50),
      reservationId: z.string().uuid().optional(),
    })
    .strict(),
  criar_reserva: confirmation,
  atualizar_reserva: confirmation,
  cancelar_reserva: confirmation,
  registrar_preferencia: z
    .object({
      key: z.enum(["name", "dietaryPreference"]),
      value: z.string().trim().min(1).max(160),
    })
    .strict(),
  escalar_para_humano: z
    .object({
      reason: z.string().trim().min(3).max(500),
      excerpt: z.string().max(1000),
    })
    .strict(),
} as const;
export type VirtualToolName = keyof typeof virtualToolSchemas;
export type VirtualToolResult = {
  success: boolean;
  id?: string;
  state?: string;
  error?: string;
  data?: Prisma.JsonValue;
  executionId: string;
};
export const pendingReservationSchema = z
  .object({
    type: z.enum(["create", "update", "cancel"]),
    token: z.string().uuid(),
    date: virtualDate,
    time: hhmm,
    partySize: z.number().int().min(1).max(50),
    guestName: z.string().min(2).max(160),
    reservationId: z.string().uuid().optional(),
    expiresAt: z.string(),
  })
  .strict();
export const virtualStateSchema = z
  .object({
    draft: z
      .object({
        date: virtualDate.optional(),
        time: hhmm.optional(),
        partySize: z.number().int().min(1).max(50).optional(),
        guestName: z.string().min(2).max(160).optional(),
        operation: z.enum(["create", "update"]).optional(),
        reservationId: z.string().uuid().optional(),
      })
      .strict()
      .optional(),
    selection: z.enum(["cancel", "update"]).optional(),
    pending: pendingReservationSchema.optional(),
  })
  .strict();
export const isExplicitVirtualConfirmation = (text: string) =>
  /^(?:sim[,!\s]*)?(?:confirmo|confirmar|pode confirmar|confirmado|sim)[.!\s]*$/i.test(
    text.trim(),
  );
function scopeOf(input: VirtualTurnInput) {
  return {
    organizationId: input.organizationId,
    storeId: input.storeId,
    accountId: input.accountId,
  };
}
const fail = (error: string) => ({ success: false, error });
async function slotAvailability(
  tx: Prisma.TransactionClient,
  input: VirtualTurnInput,
  date: string,
  time: string,
  partySize: number,
  excludeId?: string,
) {
  const now = new Date();
  const today = dateInZone(now, input.timezone);
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: input.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  if (date < today || (date === today && time <= localTime))
    return fail("Escolha uma data e um horário futuros no fuso da unidade.");
  const slot = await tx.avReservationSlot.findFirst({
    where: { ...scopeOf(input), date, time, enabled: true },
  });
  if (!slot)
    return fail(
      "Não há grade de reserva publicada para esse horário. A equipe precisa conferir.",
    );
  const used = await tx.avReservation.aggregate({
    where: {
      slotId: slot.id,
      status: "CONFIRMED",
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    _sum: { partySize: true },
  });
  const remaining = slot.capacity - (used._sum.partySize ?? 0);
  return {
    success: true,
    id: slot.id,
    state: remaining >= partySize ? "AVAILABLE" : "FULL",
    data: {
      date,
      time,
      partySize,
      remaining: Math.max(0, remaining),
      available: remaining >= partySize,
      slotVersion: slot.version,
    },
  };
}
async function reserve(
  tx: Prisma.TransactionClient,
  input: VirtualTurnInput,
  name: VirtualToolName,
  token: string,
  state: unknown,
) {
  const parsed = virtualStateSchema.safeParse(state);
  const pending = parsed.success ? parsed.data.pending : undefined;
  const expected =
    name === "criar_reserva"
      ? "create"
      : name === "atualizar_reserva"
        ? "update"
        : "cancel";
  if (
    !pending ||
    pending.token !== token ||
    pending.type !== expected ||
    new Date(pending.expiresAt) <= new Date() ||
    !input.messages.length ||
    !input.messages.every((m) => m.kind === "TEXT" && m.transcriptionCertain) ||
    !isExplicitVirtualConfirmation(input.messages.map((m) => m.text).join(" "))
  )
    return fail(
      "A ação precisa de uma confirmação explícita do resumo atual. Nenhuma reserva foi alterada.",
    );
  const scope = scopeOf(input);
  const key = `${expected}:${token}`;
  const payloadHash = canonicalHash(pending);
  const prior = await tx.avReservation.findFirst({
    where: {
      ...scope,
      idempotencyKey: key,
      externalCustomerId: input.senderKey,
    },
  });
  if (prior) {
    if (prior.payloadHash !== payloadHash)
      return fail("Chave reutilizada com dados diferentes.");
    return {
      success: true,
      id: prior.id,
      state: prior.status,
      data: { reservationId: prior.id },
    };
  }
  let old = null;
  if (expected !== "create") {
    old = await tx.avReservation.findFirst({
      where: {
        ...scope,
        id: pending.reservationId,
        externalCustomerId: input.senderKey,
        status: "CONFIRMED",
      },
    });
    if (!old)
      return fail(
        "Reserva não encontrada para este contato e canal. Peça ajuda à equipe.",
      );
    const oldSlot = await tx.avReservationSlot.findUniqueOrThrow({
      where: { id: old.slotId },
    });
    const today = dateInZone(new Date(), input.timezone);
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: input.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
    if (
      oldSlot.date < today ||
      (oldSlot.date === today && oldSlot.time <= clock)
    )
      return fail(
        "O horário dessa reserva já começou. A equipe precisa conferir a alteração.",
      );
  }
  if (expected === "cancel") {
    const cancelled = await tx.avReservation.update({
      where: { id: old!.id },
      data: { status: "CANCELLED", version: { increment: 1 } },
    });
    return {
      success: true,
      id: cancelled.id,
      state: cancelled.status,
      data: { reservationId: cancelled.id },
    };
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`virtual-slot:${input.accountId}:${pending.date}:${pending.time}`},0))`;
  // Recheck the approved policy and capacity inside the writing transaction.
  if (!(await approvedVirtualKnowledge(tx, scope, new Date())))
    return fail("A base aprovada venceu. A equipe precisa conferir a reserva.");
  const available = await slotAvailability(
    tx,
    input,
    pending.date,
    pending.time,
    pending.partySize,
    old?.id,
  );
  if (
    !available.success ||
    !("state" in available) ||
    available.state !== "AVAILABLE"
  )
    return fail(
      "A disponibilidade mudou. Consulte outro horário antes de confirmar.",
    );
  const values = {
    slotId: available.id!,
    partySize: pending.partySize,
    guestName: pending.guestName,
  };
  const row = old
    ? await tx.avReservation.update({
        where: { id: old.id },
        data: { ...values, version: { increment: 1 } },
      })
    : await tx.avReservation.create({
        data: {
          ...scope,
          conversationId: input.conversationId,
          contactId: input.contactId,
          externalCustomerId: input.senderKey,
          ...values,
          idempotencyKey: key,
          payloadHash,
        },
      });
  return {
    success: true,
    id: row.id,
    state: row.status,
    data: {
      reservationId: row.id,
      date: pending.date,
      time: pending.time,
      partySize: row.partySize,
      guestName: row.guestName,
    },
  };
}
export async function executeVirtualTool(
  input: VirtualTurnInput,
  name: VirtualToolName,
  raw: unknown,
  key: string,
): Promise<VirtualToolResult> {
  const args = virtualToolSchemas[name].parse(raw);
  const argsHash = canonicalHash({ name, args });
  return db.$transaction(
    async (tx) => {
      const conversation = await assertVirtualTurn(tx, input);
      const prior = await tx.avToolExecution.findUnique({
        where: {
          conversationId_key: { conversationId: input.conversationId, key },
        },
      });
      if (prior) {
        if (prior.name !== name || prior.argsHash !== argsHash)
          throw new CrmError(
            "IDEMPOTENCY_CONFLICT",
            "A tentativa já existe com outro conteúdo.",
          );
        return {
          ...(prior.result as Omit<VirtualToolResult, "executionId">),
          executionId: prior.id,
        };
      }
      if (
        (await tx.avToolExecution.count({ where: { runId: input.runId } })) >= 8
      )
        throw new CrmError("TOOL_LOOP", "Limite de ferramentas atingido.");
      let result: {
        success: boolean;
        id?: string;
        state?: string;
        error?: string;
        data?: unknown;
      };
      const scope = scopeOf(input);
      if (name === "buscar_cliente") {
        const customer = input.contactId
          ? await tx.crmContact.findFirst({
              where: {
                id: input.contactId,
                storeId: input.storeId,
                active: true,
                mergedIntoId: null,
                store: { organizacaoId: input.organizationId },
              },
              select: { id: true, name: true, updatedAt: true },
            })
          : null;
        const [preferences, reservations] = await Promise.all([
          tx.avCustomerPreference.findMany({
            where: { ...scope, externalCustomerId: input.senderKey },
            select: { key: true, value: true, updatedAt: true },
          }),
          tx.avReservation.findMany({
            where: {
              ...scope,
              externalCustomerId: input.senderKey,
              status: "CONFIRMED",
              slot: {
                OR: [
                  { date: { gt: dateInZone(input.now, input.timezone) } },
                  {
                    date: dateInZone(input.now, input.timezone),
                    time: {
                      gte: new Intl.DateTimeFormat("en-GB", {
                        timeZone: input.timezone,
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                      }).format(input.now),
                    },
                  },
                ],
              },
            },
            include: { slot: { select: { date: true, time: true } } },
            take: 10,
            orderBy: { createdAt: "desc" },
          }),
        ]);
        result = {
          success: true,
          id: customer?.id,
          state: customer ? "KNOWN" : "UNKNOWN",
          data: {
            name:
              preferences.find((p) => p.key === "name")?.value ??
              customer?.name ??
              conversation.displayName,
            known: !!customer,
            source: customer
              ? "CRM: identificador verificado por conta"
              : "Conversa neste canal",
            updatedAt: customer?.updatedAt?.toISOString() ?? null,
            preferences: preferences.map((p) => ({
              key: p.key,
              value: p.value,
              updatedAt: p.updatedAt.toISOString(),
            })),
            reservations: reservations.map((r) => ({
              id: r.id,
              date: r.slot.date,
              time: r.slot.time,
              partySize: r.partySize,
              guestName: r.guestName,
            })),
          },
        };
      } else if (
        name === "consultar_unidades" ||
        name === "consultar_cardapio"
      ) {
        const knowledge = await approvedVirtualKnowledge(tx, scope, input.now);
        result = knowledge
          ? {
              success: true,
              id: knowledge.id,
              state: "APPROVED",
              data: {
                version: knowledge.version,
                validUntil: knowledge.validUntil.toISOString(),
                ...(name === "consultar_cardapio"
                  ? {
                      menu: knowledge.facts.menu,
                      links: knowledge.facts.links.filter(
                        (l) => l.available && l.kind === "menu",
                      ),
                    }
                  : {
                      name: knowledge.facts.name,
                      address: knowledge.facts.address,
                      hours: knowledge.facts.hours,
                      exceptions: knowledge.facts.exceptions,
                      links: knowledge.facts.links.filter((l) => l.available),
                      reservationPolicy: knowledge.facts.reservationPolicy,
                      supportContact: knowledge.facts.supportContact,
                      timezone: input.timezone,
                    }),
              },
            }
          : fail(
              "A unidade ainda não tem informações aprovadas e vigentes. A equipe precisa conferir.",
            );
      } else if (name === "consultar_disponibilidade_reserva") {
        const a =
          virtualToolSchemas.consultar_disponibilidade_reserva.parse(args);
        if (
          a.reservationId &&
          !(await tx.avReservation.findFirst({
            where: {
              ...scope,
              id: a.reservationId,
              externalCustomerId: input.senderKey,
              status: "CONFIRMED",
            },
          }))
        )
          throw new CrmError(
            "RESERVATION_FORBIDDEN",
            "Reserva indisponível para este contato.",
            403,
          );
        result = (await approvedVirtualKnowledge(tx, scope, input.now))
          ? await slotAvailability(
              tx,
              input,
              a.date,
              a.time,
              a.partySize,
              a.reservationId,
            )
          : fail("Não há política aprovada vigente para consultar a reserva.");
      } else if (
        name === "criar_reserva" ||
        name === "atualizar_reserva" ||
        name === "cancelar_reserva"
      ) {
        result = await reserve(
          tx,
          input,
          name,
          confirmation.parse(args).confirmationToken,
          conversation.state,
        );
      } else if (name === "registrar_preferencia") {
        const a = virtualToolSchemas.registrar_preferencia.parse(args);
        const pref = await tx.avCustomerPreference.upsert({
          where: {
            accountId_externalCustomerId_key: {
              accountId: input.accountId,
              externalCustomerId: input.senderKey,
              key: a.key,
            },
          },
          create: {
            ...scope,
            externalCustomerId: input.senderKey,
            contactId: input.contactId,
            ...a,
          },
          update: { value: a.value },
        });
        if (a.key === "name")
          await tx.avConversation.update({
            where: { id: input.conversationId },
            data: { displayName: a.value },
          });
        result = {
          success: true,
          id: pref.id,
          state: "RECORDED",
          data: {
            key: a.key,
            value: a.value,
            source: "Correção informada pelo cliente neste canal",
          },
        };
      } else {
        const a = virtualToolSchemas.escalar_para_humano.parse(args);
        const escalation = await createVirtualEscalation(
          tx,
          { ...scope, conversationId: input.conversationId },
          { key, reason: a.reason, excerpt: a.excerpt },
        );
        result = {
          success: true,
          id: escalation.id,
          state: escalation.status,
          data: { taskId: escalation.id, alertState: escalation.alertState },
        };
      }
      const json = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      const execution = await tx.avToolExecution.create({
        data: {
          ...scope,
          conversationId: input.conversationId,
          runId: input.runId,
          key,
          name,
          argsHash,
          success: result.success,
          objectId: result.id,
          state: result.state,
          result: json,
        },
      });
      await tx.avAuditEvent.create({
        data: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          conversationId: input.conversationId,
          actorId: "agent:customer-service",
          action: `TOOL_${name}`,
          data: {
            executionId: execution.id,
            success: result.success,
            objectId: result.id ?? null,
          },
        },
      });
      return {
        ...JSON.parse(JSON.stringify(result)),
        executionId: execution.id,
      } as VirtualToolResult;
    },
    { timeout: 10_000 },
  );
}
export function claimFor(
  result: VirtualToolResult,
  action: VirtualToolName,
): VirtualClaim[] {
  return result.success && result.id
    ? [{ toolExecutionId: result.executionId, objectId: result.id, action }]
    : [];
}
export function newPendingReservation(
  data: Omit<z.infer<typeof pendingReservationSchema>, "token" | "expiresAt">,
) {
  return {
    ...data,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}
