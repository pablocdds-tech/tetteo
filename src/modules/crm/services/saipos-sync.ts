import { randomUUID } from "node:crypto";
import type { FonteClientes } from "@/server/contratos-clientes";
import { prisma } from "./database";
import { importSaiposCustomers } from "./saipos-customers";

const day = (date: string, n: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
const localNow = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .replace(" ", "T");
export function historyStart(today: string) {
  const configured = process.env.SAIPOS_CRM_HISTORY_START;
  if (!configured) return "2010-01-01";
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(configured) ||
    new Date(configured + "T12:00:00Z").toISOString().slice(0, 10) !==
      configured ||
    configured > today
  )
    throw new Error("Data inicial do histórico CRM inválida.");
  return configured;
}

export async function syncSaiposCustomers(
  source: FonteClientes,
  storeId: string,
  maxChunks = 24,
  force = false,
) {
  const binding = await prisma.saiposVinculo.findFirst({
    where: {
      unidadeId: storeId,
      habilitado: true,
      excluidoEm: null,
      unidade: {
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
    },
  });
  if (!binding) return { skipped: true };
  const now = new Date(),
    through = localNow(),
    start = historyStart(through.slice(0, 10));
  let state = await prisma.crmSaiposSync.upsert({
    where: { storeId },
    create: {
      organizacaoId: binding.organizacaoId,
      storeId,
      historyStart: start,
    },
    update: {},
  });
  const owner = randomUUID();
  const claim = await prisma.crmSaiposSync.updateMany({
    where: {
      id: state.id,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      ...(!force
        ? {
            AND: [
              {
                OR: [
                  { lastAttemptAt: null },
                  {
                    lastAttemptAt: {
                      lt: new Date(
                        now.getTime() -
                          (state.lastError
                            ? 15
                            : state.historyComplete
                              ? 15
                              : 1) *
                            60000,
                      ),
                    },
                  },
                ],
              },
            ],
          }
        : {}),
    },
    data: {
      leaseOwner: owner,
      leaseUntil: new Date(now.getTime() + 15 * 60000),
      lastAttemptAt: now,
      lastError: null,
    },
  });
  if (!claim.count) return { skipped: true };
  try {
    if (start < state.historyStart)
      state = await prisma.crmSaiposSync.update({
        where: { id: state.id },
        data: {
          historyStart: start,
          historyCoveredFrom: null,
          historyComplete: false,
        },
      });
    let processed = 0,
      linked = 0,
      conflicts = 0;
    for (let chunk = 0; chunk < maxChunks; chunk++) {
      const history = !state.historyComplete;
      const endDay = state.historyCoveredFrom
        ? day(state.historyCoveredFrom, -1)
        : through.slice(0, 10);
      const startDay = [state.historyStart, day(endDay, -14)].sort().at(-1)!;
      const period = history
        ? {
            start: startDay + "T00:00:00",
            end:
              endDay === through.slice(0, 10) ? through : endDay + "T23:59:59",
            column: "shift_date" as const,
          }
        : {
            start:
              day(state.cursor?.slice(0, 10) ?? through.slice(0, 10), -2) +
              "T00:00:00",
            end: through,
            column: "updated_at" as const,
          };
      const rows = await source(binding.lojaSaiposId, period);
      if (
        !state.lastSuccessAt &&
        !rows.length &&
        (await prisma.saiposVenda.count({
          where: {
            organizacaoId: binding.organizacaoId,
            unidadeId: storeId,
            dataTurno: {
              gte: period.start.slice(0, 10),
              lte: period.end.slice(0, 10),
            },
          },
        }))
      )
        throw new Error("Consulta vazia sem cobertura comprovada.");
      const complete = history ? startDay <= state.historyStart : true;
      const result = await importSaiposCustomers(
        { organizacaoId: binding.organizacaoId, storeId },
        rows,
        async (tx) => {
          const fenced = await tx.crmSaiposSync.updateMany({
            where: {
              id: state.id,
              leaseOwner: owner,
              leaseUntil: { gt: new Date() },
            },
            data: {
              ...(history
                ? { historyCoveredFrom: startDay, historyComplete: complete }
                : {}),
              ...(!history || !state.cursor ? { cursor: through } : {}),
              lastSuccessAt: new Date(),
              lastError: null,
              processed: { increment: rows.length },
              leaseUntil: new Date(Date.now() + 15 * 60000),
            },
          });
          if (!fenced.count)
            throw new Error(
              "A importação perdeu sua concessão; lote preservado.",
            );
          await tx.crmAuditEvent.create({
            data: {
              storeId,
              actorId: "system:saipos",
              entityType: "CrmSaiposSync",
              entityId: state.id,
              action: "IMPORT_BATCH",
              data: { from: period.start, to: period.end, rows: rows.length },
            },
          });
        },
      );
      processed += result.processed;
      linked += result.linked;
      conflicts += result.conflicts;
      state = await prisma.crmSaiposSync.findUniqueOrThrow({
        where: { id: state.id },
      });
      if (complete) break;
    }
    await prisma.crmSaiposSync.updateMany({
      where: { id: state.id, leaseOwner: owner },
      data: { leaseOwner: null, leaseUntil: null },
    });
    // Reclassify contacts using all imported history. Processing remains bounded.
    if (processed) {
      const pending = await prisma.crmSegmentJob.findFirst({
        where: { storeId, status: { in: ["ACCEPTED", "RUNNING"] } },
      });
      if (!pending)
        await prisma.crmSegmentJob.create({
          data: { storeId, actorId: "system:saipos" },
        });
    }
    return {
      skipped: false,
      processed,
      linked,
      conflicts,
      historyComplete: state.historyComplete,
      coveredFrom: state.historyCoveredFrom,
    };
  } catch (error) {
    const denied =
      error &&
      typeof error === "object" &&
      "status" in error &&
      [401, 403].includes(Number(error.status));
    await prisma.crmSaiposSync.updateMany({
      where: { id: state.id, leaseOwner: owner },
      data: {
        leaseOwner: null,
        leaseUntil: null,
        lastError: denied
          ? "A credencial Saipos não autorizou a consulta de clientes."
          : "Saipos ou gravação temporariamente indisponível. A carga continuará do último lote confirmado.",
      },
    });
    return { skipped: false, unavailable: true };
  }
}

export function startSaiposCustomerSync(source: FonteClientes) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!process.env.SAIPOS_UNIDADE_ID) return;
      const binding = await prisma.saiposVinculo.findFirst({
        where: {
          unidadeId: process.env.SAIPOS_UNIDADE_ID,
          habilitado: true,
          excluidoEm: null,
        },
        select: { unidadeId: true },
      });
      if (binding) await syncSaiposCustomers(source, binding.unidadeId);
    } catch {
      console.error(
        "[crm/saipos] Atualização não concluída; consulte o estado da importação.",
      );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 60000);
  timer.unref();
  void tick();
}
