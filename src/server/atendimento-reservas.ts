import type { Prisma } from "@prisma/client";
type Scope = { organizationId: string; storeId: string; accountId: string };
export async function sharedBookingSlot(
  tx: Prisma.TransactionClient,
  scope: Scope,
  date: string,
  time: string,
  createAccountSlot = false,
) {
  const account = await tx.avChannelAccount.findFirst({
    where: {
      id: scope.accountId,
      organizationId: scope.organizationId,
      storeId: scope.storeId,
    },
    select: { mode: true },
  });
  if (!account) return null;
  if (account.mode === "DEMO")
    return tx.avReservationSlot.findFirst({
      where: { ...scope, date, time, enabled: true },
    });
  const capacity = await tx.avBookingCapacity.findUnique({
    where: {
      organizationId_storeId_date_time: {
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        date,
        time,
      },
    },
  });
  if (!capacity?.enabled) return null;
  if (!createAccountSlot) return { ...capacity, accountId: scope.accountId };
  return tx.avReservationSlot.upsert({
    where: { accountId_date_time: { accountId: scope.accountId, date, time } },
    create: {
      ...scope,
      date,
      time,
      capacity: capacity.capacity,
      enabled: true,
    },
    update: { capacity: capacity.capacity, enabled: true },
  });
}
export async function bookingCapacityLock(
  tx: Prisma.TransactionClient,
  scope: Scope,
  date: string,
  time: string,
) {
  const account = await tx.avChannelAccount.findUniqueOrThrow({
    where: { id: scope.accountId },
    select: { mode: true },
  });
  const key =
    account.mode === "DEMO"
      ? `virtual-slot:${scope.accountId}:${date}:${time}`
      : `av:capacity:${scope.organizationId}:${scope.storeId}:${date}:${time}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
}
export async function bookedPartySize(
  tx: Prisma.TransactionClient,
  scope: Scope,
  date: string,
  time: string,
  excludeId?: string,
) {
  const account = await tx.avChannelAccount.findUniqueOrThrow({
    where: { id: scope.accountId },
    select: { mode: true },
  });
  const used = await tx.avReservation.aggregate({
    where: {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      status: "CONFIRMED",
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(account.mode === "DEMO"
        ? { accountId: scope.accountId }
        : { account: { mode: { in: ["META", "EVOLUTION"] } } }),
      slot: { date, time },
    },
    _sum: { partySize: true },
  });
  return used._sum.partySize ?? 0;
}
export async function setLiveBookingCapacity(
  tx: Prisma.TransactionClient,
  scope: Scope,
  data: { date: string; time: string; capacity: number; enabled: boolean },
) {
  await bookingCapacityLock(tx, scope, data.date, data.time);
  const used = await bookedPartySize(tx, scope, data.date, data.time);
  if (used > data.capacity)
    throw Object.assign(
      new Error(
        "A capacidade é menor que as reservas confirmadas nos canais da unidade.",
      ),
      { status: 409 },
    );
  return tx.avBookingCapacity.upsert({
    where: {
      organizationId_storeId_date_time: {
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        date: data.date,
        time: data.time,
      },
    },
    create: {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      ...data,
    },
    update: {
      capacity: data.capacity,
      enabled: data.enabled,
      version: { increment: 1 },
    },
  });
}
