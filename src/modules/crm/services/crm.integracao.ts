import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { crmUser, scopedStoreIds, can } from "./scope";
import {
  createContact,
  updateContact,
  getContact,
  linkSale,
  listContacts,
  getCrmOverview,
  addActivity,
} from "./service";
import {
  registerIdentity,
  acceptImport,
  processImport,
  segmentPage,
  mutation,
  createCampaign,
  previewCampaign,
  approveCampaign,
  updateCampaign,
  recordConsent,
  campaignDetail,
} from "./campaign-service";
import { syncSaiposLinks } from "./saipos-links";
import contactRoutes from "./routes";
import campaignRoutes from "./campaign-routes";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { assignArm } from "./campaign-domain";
import { advanceCrmJobs } from "./jobs";

test("CRM integrado: isolamento, vendas reais, importação idempotente, públicos e aprovação", async () => {
  assert.match(
    new URL(process.env.DATABASE_URL!).hostname,
    /^(127\.0\.0\.1|localhost)$/,
  );
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test/);
  process.env.CRM_IDENTITY_KEY = "b".repeat(64);
  const org = await db.organizacao.create({
    data: { nome: "Rede fictícia CRM", slug: `crm-test-${randomUUID()}` },
  });
  const actor = await db.usuario.create({
    data: {
      nome: "Pessoa fictícia CRM",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const store = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Unidade fictícia A", codigo: "A" },
  });
  const otherOrg = await db.organizacao.create({
    data: { nome: "Outra rede fictícia", slug: `crm-test-${randomUUID()}` },
  });
  const other = await db.unidade.create({
    data: { organizacaoId: otherOrg.id, nome: "Outra unidade", codigo: "B" },
  });
  const ctx: ContextoSessao = {
    usuario: {
      id: actor.id,
      nome: actor.nome,
      email: actor.email,
      avatarUrl: null,
    },
    organizacao: org,
    unidadesVisiveis: [store].map((s) => ({
      id: s.id,
      nome: s.nome,
      codigo: s.codigo,
    })),
    unidadeAtiva: store,
    podeVerRedeInteira: false,
    permissoes: new Set(["crm.ver", "crm.editar"]),
    ehDiretor: false,
  };
  const user = crmUser(ctx);
  assert.deepEqual(scopedStoreIds(user, "all"), [store.id]);
  assert.throws(() => scopedStoreIds(user, other.id), /Sem acesso/);
  assert.equal(can(user, "CRM", "EDIT"), true);
  assert.equal(user.role, "ATTENDANT");
  assert.throws(() => crmUser({ ...ctx, unidadeAtiva: other }), /Sem acesso/);
  const contact = await createContact(
    {
      storeId: store.id,
      name: "Contato fictício",
      phone: "11999991234",
      marketingOptIn: false,
    },
    actor.id,
  );
  const hidden = await createContact(
    {
      storeId: other.id,
      name: "Contato de outra rede",
      phone: "11999991234",
      marketingOptIn: false,
    },
    actor.id,
  );
  assert.equal(await getContact(store.id, hidden.id), null);
  assert.equal(
    await updateContact(store.id, hidden.id, { name: "Invasão" }, actor.id),
    null,
  );
  const list = await listContacts({
    storeIds: [store.id],
    allStores: false,
    page: 1,
    pageSize: 25,
  });
  assert.deepEqual(
    list.items.map((c) => c.id),
    [contact.id],
  );
  assert.equal((await getCrmOverview([store.id], false)).counts.LEAD, 1);
  const fakeReq = {
    user,
    query: { storeId: other.id },
    params: {},
    body: undefined,
    method: "GET",
    path: "/contacts",
    header: () => undefined,
  };
  assert.equal((await contactRoutes.dispatch(fakeReq))?.status, 403);
  const unauthorized = await campaignRoutes.dispatch({
    ...fakeReq,
    query: { storeId: store.id },
    path: `/contacts/${contact.id}/identities`,
    method: "POST",
    body: { type: "LOCAL_JSON", value: "customer-1", confirmedVerified: true },
    header: () => randomUUID(),
  });
  assert.equal(unauthorized?.status, 403);
  await addActivity(
    store.id,
    contact.id,
    "NOTE",
    "Interação fictícia de validação",
    actor.id,
  );
  const v = await db.saiposVinculo.create({
    data: {
      organizacaoId: org.id,
      unidadeId: store.id,
      lojaSaiposId: Math.floor(Math.random() * 1e8),
    },
  });
  const sale = await db.saiposVenda.create({
    data: {
      organizacaoId: org.id,
      unidadeId: store.id,
      vendaExternaId: "verified-sale",
      dataTurno: "2026-10-25",
      totalCentavos: 12345,
      cancelada: false,
      criadaNoSaiposEm: new Date(),
      alteradaNoSaiposEm: new Date(),
    },
  });
  assert.ok(v.id);
  assert.equal(
    await linkSale(
      store.id,
      hidden.id,
      "SAIPOS",
      sale.vendaExternaId,
      actor.id,
    ),
    "CONTACT_NOT_FOUND",
  );
  assert.equal(
    await linkSale(
      store.id,
      contact.id,
      "SAIPOS",
      sale.vendaExternaId,
      actor.id,
    ),
    "OK",
  );
  assert.equal(
    await linkSale(
      store.id,
      contact.id,
      "SAIPOS",
      sale.vendaExternaId,
      actor.id,
    ),
    "OK",
  );
  assert.equal((await getContact(store.id, contact.id))?.metrics.spent, 123.45);
  await db.saiposVenda.update({
    where: { id: sale.id },
    data: { cancelada: true },
  });
  await syncSaiposLinks(store.id);
  assert.equal((await getContact(store.id, contact.id))?.metrics.purchases, 0);
  assert.equal(
    (await db.saiposVenda.findUniqueOrThrow({ where: { id: sale.id } }))
      .totalCentavos,
    12345,
  );
  await assert.rejects(
    db.crmSale.create({
      data: {
        storeId: store.id,
        crmContactId: hidden.id,
        source: "TAKEAT",
        externalId: "cross-unit",
        itemsJson: [],
        totalAmount: 1,
        soldAt: new Date(),
      },
    }),
  );
  await db.$transaction((tx) =>
    registerIdentity(
      tx,
      store.id,
      contact.id,
      actor.id,
      "LOCAL_JSON",
      "customer-1",
    ),
  );
  const row = {
    externalId: "visit-1",
    externalCustomerId: "customer-1",
    occurredAt: new Date().toISOString(),
    netRevenueCents: 9500,
    reversed: false,
    revision: 1,
    reason: "Importação fictícia de teste",
  };
  const batch = await db.$transaction((tx) =>
    acceptImport(tx, store.id, actor.id, [row]),
  );
  await processImport(batch.importId!);
  await processImport(batch.importId!);
  assert.equal((await getContact(store.id, contact.id))?.metrics.purchases, 1);
  assert.equal((await getContact(store.id, contact.id))?.metrics.spent, 95);
  const mutationKey = randomUUID();
  let calls = 0;
  const work = () => {
    calls++;
    return Promise.resolve({ accepted: true });
  };
  await mutation(store.id, actor.id, mutationKey, { x: 1 }, work);
  await mutation(store.id, actor.id, mutationKey, { x: 1 }, work);
  assert.equal(calls, 1);
  await assert.rejects(
    mutation(store.id, actor.id, mutationKey, { x: 2 }, work),
    /chave/,
  );
  const job = await db.crmSegmentJob.create({
    data: { storeId: store.id, actorId: actor.id },
  });
  while (!(await segmentPage(job.id, 1)).done) {
    /* bounded fixture */
  }
  const snapshot = await db.crmSegmentSnapshot.findUniqueOrThrow({
    where: { contactId: contact.id },
  });
  assert.equal(snapshot.visits, 1);
  await db.$transaction((tx) =>
    recordConsent(
      tx,
      store.id,
      contact.id,
      actor.id,
      "OPT_IN",
      "SYNTHETIC_TEST",
      "fictitious-reference",
    ),
  );
  const tomorrow = new Date(Date.now() + 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const end = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const input = {
    name: "Campanha fictícia",
    objective: "Validar aprovação",
    segment: snapshot.segment,
    startDate: tomorrow,
    endDate: end,
    message: "Mensagem fictícia sem envio",
    benefit: "Benefício de teste",
    costBudgetCents: 1000,
    unitCostCents: 0,
    fixedCostCents: 0,
  };
  const campaign = await db.$transaction((tx) =>
    createCampaign(tx, store.id, actor.id, input),
  );
  const preview = await db.$transaction((tx) =>
    previewCampaign(tx, store.id, campaign.id, actor.id, 1),
  );
  assert.equal(preview.assigned, 1);
  // Approval must refuse a stale preview, independently of the randomly assigned arm.
  await assert.rejects(
    db.$transaction((tx) =>
      approveCampaign(tx, store.id, campaign.id, actor.id, 1, "0".repeat(64)),
    ),
    /prévia mudou/,
  );
  assert.equal((await campaignDetail(store.id, campaign.id)).version, 1);
  await assert.rejects(campaignDetail(other.id, campaign.id), /não encontrada/);
  await db.$transaction((tx) =>
    updateCampaign(tx, store.id, campaign.id, actor.id, 1, {
      ...input,
      name: "Rascunho atualizado",
    }),
  );
  await assert.rejects(
    db.$transaction((tx) =>
      updateCampaign(tx, store.id, campaign.id, actor.id, 1, input),
    ),
    /alterado/,
  );
  const experiment = await db.crmExperiment.findUniqueOrThrow({
    where: { id: campaign.id },
  });
  let recipientId = randomUUID();
  while (
    assignArm(recipientId, campaign.id, experiment.assignmentSalt) !==
    "TREATMENT"
  )
    recipientId = randomUUID();
  await db.crmContact.create({
    data: {
      id: recipientId,
      storeId: store.id,
      name: "Destinatário fictício",
      phone: `synthetic:${recipientId}`,
      marketingOptIn: true,
    },
  });
  await db.$transaction((tx) =>
    recordConsent(
      tx,
      store.id,
      recipientId,
      actor.id,
      "OPT_IN",
      "SYNTHETIC_TEST",
      "fictitious-reference",
    ),
  );
  await db.crmSegmentSnapshot.create({
    data: {
      storeId: store.id,
      contactId: recipientId,
      visits: 1,
      lastVisitAt: new Date(),
      segment: snapshot.segment,
      asOf: new Date(),
      ruleVersion: snapshot.ruleVersion,
    },
  });
  const freshPreview = await db.$transaction((tx) =>
    previewCampaign(tx, store.id, campaign.id, actor.id, 2),
  );
  assert.ok(freshPreview.treatment >= 1);
  await db.$transaction((tx) =>
    approveCampaign(
      tx,
      store.id,
      campaign.id,
      actor.id,
      2,
      freshPreview.previewHash,
    ),
  );
  const delivery = await db.crmDelivery.findFirstOrThrow({
    where: { storeId: store.id, assignment: { contactId: recipientId } },
  });
  await db.crmDelivery.update({
    where: { id: delivery.id },
    data: { state: "CLAIMED", claimedAt: new Date(Date.now() - 120_000) },
  });
  process.env.CRM_LOCAL_DELIVERY_ENABLED = "true";
  await advanceCrmJobs(store.id);
  assert.equal(
    (await db.crmDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .state,
    "UNCERTAIN",
  );
  await db.crmLocalReceipt.create({
    data: { deliveryId: delivery.id, providerId: `local:${delivery.id}` },
  });
  await advanceCrmJobs(store.id);
  assert.equal(
    (await db.crmDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .state,
    "SIMULATED",
  );
  delete process.env.CRM_LOCAL_DELIVERY_ENABLED;
  assert.ok(
    (await db.crmAuditEvent.count({ where: { storeId: store.id } })) > 0,
  );
  await db.$disconnect();
});
