import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { setLiveBookingCapacity } from "@/server/atendimento-reservas";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { CrmError } from "./campaign-domain";
import { dateInZone, relativeVirtualDate, virtualDate } from "./virtual-domain";
export { dateInZone, relativeVirtualDate, virtualDate } from "./virtual-domain";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const publicUrl = z
  .string()
  .url()
  .max(500)
  .refine((v) => {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !/^(localhost|.*\.localhost|.*\.local|\[.*\]|[\d.]+)$/i.test(u.hostname)
    );
  }, "Use um endereço público HTTPS, sem credenciais.");
export const virtualFactsSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    address: z.string().trim().max(500),
    hours: z
      .array(
        z
          .object({
            day: z.number().int().min(0).max(6),
            opens: time,
            closes: time,
          })
          .strict(),
      )
      .max(21),
    exceptions: z
      .array(
        z
          .object({
            date: virtualDate,
            closed: z.boolean(),
            description: z.string().trim().max(300),
          })
          .strict(),
      )
      .max(100),
    menu: z
      .array(
        z
          .object({
            id: z.string().max(100),
            name: z.string().trim().min(1).max(160),
            description: z.string().max(500),
            priceCents: z.number().int().min(0).max(10_000_000),
            vegetarian: z.boolean(),
            photoUrl: publicUrl.optional(),
          })
          .strict(),
      )
      .max(200),
    links: z
      .array(
        z
          .object({
            kind: z.enum(["menu", "booking", "location", "support"]),
            url: publicUrl,
            available: z.boolean(),
          })
          .strict(),
      )
      .max(12),
    reservationPolicy: z.string().trim().max(1500),
    supportContact: z.string().trim().max(200),
  })
  .strict();
export type VirtualFacts = z.infer<typeof virtualFactsSchema>;
export type VirtualScope = {
  organizationId: string;
  storeId: string;
  accountId: string;
};

export async function virtualAccess(
  ctx: ContextoSessao,
  storeId: string,
  permission = "crm.ver",
) {
  if (
    !pode(ctx, permission) ||
    ctx.unidadeAtiva?.id !== storeId ||
    !ctx.unidadesVisiveis.some((u) => u.id === storeId)
  )
    throw new CrmError(
      "FORBIDDEN",
      "Sem acesso a esta unidade ou operação.",
      403,
    );
  const unit = await db.unidade.findFirst({
    where: {
      id: storeId,
      organizacaoId: ctx.organizacao.id,
      ativa: true,
      excluidoEm: null,
      organizacao: { ativa: true, excluidoEm: null },
    },
  });
  if (!unit) throw new CrmError("NOT_FOUND", "Unidade indisponível.", 404);
  return unit;
}
export async function approvedVirtualKnowledge(
  tx: Prisma.TransactionClient,
  scope: VirtualScope,
  now: Date,
) {
  const row = await tx.avKnowledgeVersion.findFirst({
    where: {
      ...scope,
      status: "APPROVED",
      validFrom: { lte: now },
      validUntil: { gt: now },
    },
    orderBy: { version: "desc" },
  });
  return row
    ? {
        id: row.id,
        version: row.version,
        updatedAt: row.approvedAt,
        validUntil: row.validUntil,
        facts: virtualFactsSchema.parse(row.facts),
      }
    : null;
}
export async function virtualKnowledge(
  ctx: ContextoSessao,
  storeId: string,
  accountId?: string,
) {
  await virtualAccess(ctx, storeId);
  const account = await db.avChannelAccount.findFirst({
    where: {
      organizationId: ctx.organizacao.id,
      storeId,
      ...(accountId ? { id: accountId } : { mode: "DEMO" }),
    },
  });
  if (!account) return { accountId: null, versions: [], slots: [] };
  const scope = {
    organizationId: ctx.organizacao.id,
    storeId,
    accountId: account.id,
  };
  const [versions, slots] = await Promise.all([
    db.avKnowledgeVersion.findMany({
      where: scope,
      orderBy: { version: "desc" },
      take: 30,
    }),
    account.mode === "DEMO"
      ? db.avReservationSlot.findMany({
          where: {
            ...scope,
            date: { gte: dateInZone(new Date(), account.timezone) },
          },
          orderBy: [{ date: "asc" }, { time: "asc" }],
          take: 200,
        })
      : db.avBookingCapacity.findMany({
          where: {
            organizationId: ctx.organizacao.id,
            storeId,
            date: { gte: dateInZone(new Date(), account.timezone) },
          },
          orderBy: [{ date: "asc" }, { time: "asc" }],
          take: 200,
        }),
  ]);
  return { accountId: account.id, accountMode: account.mode, versions, slots };
}
const draftSchema = z
  .object({
    storeId: z.string().min(1),
    accountId: z.string().uuid().optional(),
    action: z.literal("draft"),
    facts: virtualFactsSchema,
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime(),
  })
  .strict();
const approvalSchema = z
  .object({
    storeId: z.string().min(1),
    accountId: z.string().uuid().optional(),
    action: z.literal("approve"),
    versionId: z.string().uuid(),
  })
  .strict();
const slotSchema = z
  .object({
    storeId: z.string().min(1),
    accountId: z.string().uuid().optional(),
    action: z.literal("slot"),
    date: virtualDate,
    time,
    capacity: z.number().int().min(1).max(500),
    enabled: z.boolean(),
  })
  .strict();
export async function changeVirtualKnowledge(
  ctx: ContextoSessao,
  raw: unknown,
) {
  const data = z
    .discriminatedUnion("action", [draftSchema, approvalSchema, slotSchema])
    .parse(raw);
  await virtualAccess(ctx, data.storeId, "crm.gerenciar");
  return db.$transaction(async (tx) => {
    const account = await tx.avChannelAccount.findFirst({
      where: {
        organizationId: ctx.organizacao.id,
        storeId: data.storeId,
        ...(data.accountId ? { id: data.accountId } : { mode: "DEMO" }),
      },
    });
    if (!account)
      throw new CrmError(
        "ACCOUNT_MISSING",
        "Selecione um canal desta unidade antes de configurar a base.",
        409,
      );
    const scope = {
      organizationId: ctx.organizacao.id,
      storeId: data.storeId,
      accountId: account.id,
    };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`virtual-knowledge:${account.id}`},0))`;
    let result: unknown;
    if (data.action === "draft") {
      const validFrom = new Date(data.validFrom),
        validUntil = new Date(data.validUntil);
      if (
        validUntil <= validFrom ||
        validUntil.getTime() - validFrom.getTime() > 366 * 86_400_000
      )
        throw new CrmError(
          "INVALID_VALIDITY",
          "A validade deve terminar após o início e durar até um ano.",
          400,
        );
      const last = await tx.avKnowledgeVersion.findFirst({
        where: scope,
        orderBy: { version: "desc" },
      });
      result = await tx.avKnowledgeVersion.create({
        data: {
          ...scope,
          version: (last?.version ?? 0) + 1,
          authorId: ctx.usuario.id,
          validFrom,
          validUntil,
          facts: data.facts,
        },
      });
    } else if (data.action === "approve") {
      const row = await tx.avKnowledgeVersion.findFirst({
        where: { ...scope, id: data.versionId, status: "DRAFT" },
      });
      if (!row || row.validUntil <= new Date())
        throw new CrmError(
          "INVALID_VERSION",
          "Rascunho indisponível ou vencido.",
          409,
        );
      virtualFactsSchema.parse(row.facts);
      result = await tx.avKnowledgeVersion.update({
        where: { id: row.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: ctx.usuario.id,
        },
      });
    } else if (account.mode !== "DEMO") {
      result = await setLiveBookingCapacity(tx, scope, {
        date: data.date,
        time: data.time,
        capacity: data.capacity,
        enabled: data.enabled,
      });
    } else {
      // The same lock as creation/update: reducing capacity cannot race a booking.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`virtual-slot:${account.id}:${data.date}:${data.time}`},0))`;
      const existing = await tx.avReservationSlot.findUnique({
        where: {
          accountId_date_time: {
            accountId: account.id,
            date: data.date,
            time: data.time,
          },
        },
      });
      if (existing) {
        const used = await tx.avReservation.aggregate({
          where: { slotId: existing.id, status: "CONFIRMED" },
          _sum: { partySize: true },
        });
        if ((used._sum.partySize ?? 0) > data.capacity)
          throw new CrmError(
            "CAPACITY_CONFLICT",
            "A capacidade é menor que as reservas confirmadas.",
            409,
          );
        result = await tx.avReservationSlot.update({
          where: { id: existing.id },
          data: {
            capacity: data.capacity,
            enabled: data.enabled,
            version: { increment: 1 },
          },
        });
      } else
        result = await tx.avReservationSlot.create({
          data: {
            ...scope,
            date: data.date,
            time: data.time,
            capacity: data.capacity,
            enabled: data.enabled,
          },
        });
    }
    await tx.avAuditEvent.create({
      data: {
        organizationId: ctx.organizacao.id,
        storeId: data.storeId,
        actorId: ctx.usuario.id,
        action: `KNOWLEDGE_${data.action.toUpperCase()}`,
        data: { accountId: account.id },
      },
    });
    return result;
  });
}
export async function ensureVirtualDemoKnowledge(
  tx: Prisma.TransactionClient,
  scope: VirtualScope,
  actorId: string,
) {
  const demoAccount = await tx.avChannelAccount.findFirst({
    where: {
      id: scope.accountId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      mode: "DEMO",
    },
    select: { id: true },
  });
  if (!demoAccount)
    throw new CrmError(
      "DEMO_ONLY",
      "Dados fictícios são permitidos somente no canal de demonstração.",
      403,
    );
  if (await tx.avKnowledgeVersion.findFirst({ where: scope })) return;
  const now = new Date();
  await tx.avKnowledgeVersion.create({
    data: {
      ...scope,
      version: 1,
      status: "APPROVED",
      authorId: actorId,
      approvedById: actorId,
      approvedAt: now,
      validFrom: now,
      validUntil: new Date(now.getTime() + 30 * 86_400_000),
      facts: {
        name: "Kairu · unidade de demonstração",
        address: "Endereço fictício para demonstração",
        hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          day,
          opens: "18:00",
          closes: "23:00",
        })),
        exceptions: [],
        menu: [
          {
            id: "demo-margherita",
            name: "Margherita · exemplo",
            description: "Tomate, mussarela e manjericão. Item fictício Kairu.",
            priceCents: 6900,
            vegetarian: true,
          },
        ],
        links: [],
        reservationPolicy:
          "Demonstração Kairu. Grade fictícia por horário, até oito pessoas. Nenhuma mesa real é reservada.",
        supportContact: "Equipe da demonstração no inbox",
      },
    },
  });
  const account = await tx.avChannelAccount.findUniqueOrThrow({
    where: { id: scope.accountId },
  });
  for (let i = 0; i < 8; i++) {
    const date = relativeVirtualDate(
      i === 0 ? "hoje" : "amanhã",
      new Date(now.getTime() + Math.max(0, i - 1) * 86_400_000),
      account.timezone,
    );
    for (const time of ["19:00", "20:00", "21:00"])
      await tx.avReservationSlot.upsert({
        where: {
          accountId_date_time: { accountId: scope.accountId, date, time },
        },
        create: { ...scope, date, time, capacity: 8 },
        update: {},
      });
  }
}
