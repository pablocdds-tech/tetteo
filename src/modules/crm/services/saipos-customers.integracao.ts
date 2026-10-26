import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { VendaCliente } from "@/server/contratos-clientes";
import { importSaiposCustomers } from "./saipos-customers";
import { syncSaiposCustomers, historyStart } from "./saipos-sync";
import { syncSaiposLinks } from "./saipos-links";

test("Saipos CRM: repetição, revisões, isolamento, consentimento e retomada atômica", async () => {
  process.env.CRM_IDENTITY_KEY = "c".repeat(64);
  assert.match(
    new URL(process.env.DATABASE_URL!).hostname,
    /^(127\.0\.0\.1|localhost)$/,
  );
  const org = await db.organizacao.create({
    data: { nome: "Rede sintética importação", slug: randomUUID() },
  });
  const store = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja sintética", codigo: "S" },
  });
  const scope = { organizacaoId: org.id, storeId: store.id };
  const row: VendaCliente = {
    externalId: "1",
    soldAt: new Date("2026-10-01T15:00:00Z"),
    updatedAt: new Date("2026-10-01T16:00:00Z"),
    shiftDate: "2026-10-01",
    totalCents: 12345,
    cancelled: false,
    customer: {
      externalId: "10",
      name: "Pessoa sintética",
      phone: "5511999991234",
      email: null,
    },
  };
  await importSaiposCustomers(scope, [row, row]);
  await importSaiposCustomers(scope, [row]);
  assert.equal(await db.crmSale.count({ where: { storeId: store.id } }), 1);
  const contact = await db.crmContact.findFirstOrThrow({
    where: { storeId: store.id },
  });
  assert.equal(contact.marketingOptIn, false);
  assert.equal(contact.saiposManaged, true);
  assert.equal(await db.crmConsent.count({ where: { storeId: store.id } }), 0);
  const collision = {
    ...row,
    externalId: "2",
    customer: { ...row.customer!, externalId: "20", name: "Outra pessoa" },
  };
  assert.equal((await importSaiposCustomers(scope, [collision])).conflicts, 1);
  assert.equal(
    (
      await db.crmSale.findUniqueOrThrow({
        where: {
          storeId_source_externalId: {
            storeId: store.id,
            source: "SAIPOS",
            externalId: "2",
          },
        },
      })
    ).crmContactId,
    null,
  );
  await importSaiposCustomers(scope, [
    {
      ...row,
      externalId: "3",
      customer: { ...row.customer!, externalId: "30", phone: null },
    },
  ]);
  assert.equal(await db.crmContact.count({ where: { storeId: store.id } }), 2);
  const revision = {
    ...row,
    cancelled: true,
    totalCents: 10000,
    updatedAt: new Date("2026-10-02T16:00:00Z"),
  };
  await importSaiposCustomers(scope, [revision]);
  await importSaiposCustomers(scope, [row]);
  assert.equal(
    (
      await db.crmSale.findFirstOrThrow({
        where: { storeId: store.id, externalId: "1" },
      })
    ).status,
    "CANCELLED",
  );
  await db.crmContact.update({
    where: { id: contact.id },
    data: { saiposManaged: false, name: "Edição manual" },
  });
  await importSaiposCustomers(scope, [
    { ...revision, updatedAt: new Date("2026-10-03T16:00:00Z") },
  ]);
  assert.equal(
    (await db.crmContact.findUniqueOrThrow({ where: { id: contact.id } })).name,
    "Edição manual",
  );
  await assert.rejects(() =>
    importSaiposCustomers({ ...scope, organizacaoId: "outra-rede" }, [row]),
  );
  await assert.rejects(() =>
    importSaiposCustomers(
      scope,
      [{ ...row, externalId: "rollback" }],
      async () => {
        throw Error("concessão perdida");
      },
    ),
  );
  assert.equal(
    await db.crmSale.count({
      where: { storeId: store.id, externalId: "rollback" },
    }),
    0,
  );
  const audits = JSON.stringify(
    await db.crmAuditEvent.findMany({
      where: { storeId: store.id },
      select: { data: true },
    }),
  );
  assert.equal(audits.includes(row.customer!.phone!), false);
  assert.equal(audits.includes(row.customer!.name), false);
  await db.saiposVinculo.create({
    data: {
      organizacaoId: org.id,
      unidadeId: store.id,
      lojaSaiposId: Math.floor(Math.random() * 1e8) + 1,
    },
  });
  delete process.env.SAIPOS_CRM_HISTORY_START;
  const lateSource = await db.saiposVenda.create({
    data: {
      organizacaoId: org.id,
      unidadeId: store.id,
      vendaExternaId: "1",
      dataTurno: row.shiftDate,
      totalCentavos: row.totalCents,
      cancelada: false,
      criadaNoSaiposEm: row.soldAt,
      alteradaNoSaiposEm: row.updatedAt,
    },
  });
  await syncSaiposLinks(store.id);
  const preserved = await db.crmSale.findFirstOrThrow({
    where: { storeId: store.id, externalId: "1" },
  });
  assert.equal(preserved.saiposVendaId, lateSource.id);
  assert.equal(preserved.status, "CANCELLED");
  await db.crmSaiposSync.create({
    data: {
      ...scope,
      historyStart: "2010-01-01",
      leaseOwner: "outro-worker",
      leaseUntil: new Date(Date.now() + 60000),
    },
  });
  assert.deepEqual(
    await syncSaiposCustomers(
      async () => {
        throw Error("não deve consultar");
      },
      store.id,
      1,
      true,
    ),
    { skipped: true },
  );
  await db.crmSaiposSync.update({
    where: { storeId: store.id },
    data: { leaseUntil: null, leaseOwner: null },
  });
  assert.equal(historyStart("2026-10-26"), "2010-01-01");
  const first = await syncSaiposCustomers(
    async () => {
      throw Error("504 payload privado");
    },
    store.id,
    1,
    true,
  );
  assert.equal("unavailable" in first, true);
  let state = await db.crmSaiposSync.findUniqueOrThrow({
    where: { storeId: store.id },
  });
  assert.equal(state.historyCoveredFrom, null);
  assert.equal(state.lastError?.includes("payload"), false);
  await syncSaiposCustomers(
    async () => {
      throw Object.assign(new Error("detalhes privados"), {
        kind: "provider_unavailable",
        status: 504,
      });
    },
    store.id,
    1,
    true,
  );
  state = await db.crmSaiposSync.findUniqueOrThrow({
    where: { storeId: store.id },
  });
  assert.match(state.lastError!, /banco da API Saipos/);
  assert.equal(state.historyCoveredFrom, null);
  assert.equal(state.lastError?.includes("privados"), false);
  const periods: { start: string; end: string }[] = [];
  await syncSaiposCustomers(
    async (_id, period) => {
      periods.push(period);
      return [];
    },
    store.id,
    1,
    true,
  );
  state = await db.crmSaiposSync.findUniqueOrThrow({
    where: { storeId: store.id },
  });
  assert.equal(state.historyComplete, false);
  assert.equal(state.historyCoveredFrom, periods[0].start.slice(0, 10));
  const cursor = state.cursor;
  await syncSaiposCustomers(
    async (_id, period) => {
      periods.push(period);
      return [];
    },
    store.id,
    1,
    true,
  );
  assert.ok(periods[1].end < periods[0].start);
  assert.equal(
    (await db.crmSaiposSync.findUniqueOrThrow({ where: { storeId: store.id } }))
      .cursor,
    cursor,
  );
  await db.$disconnect();
});
