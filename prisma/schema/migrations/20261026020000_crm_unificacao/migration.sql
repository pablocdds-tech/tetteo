-- Additive CRM migration: existing application tables and rows are preserved.
BEGIN;

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntegrationSource" AS ENUM ('GENERIC_WEBHOOK', 'SAIPOS', 'TAKEAT');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'SMS');

-- CreateTable
CREATE TABLE "CrmSale" (
    "saiposVendaId" TEXT,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "crmContactId" TEXT,
    "source" "IntegrationSource" NOT NULL DEFAULT 'GENERIC_WEBHOOK',
    "externalId" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "netRevenueCents" DECIMAL(18,0),
    "itemsJson" JSONB NOT NULL,
    "providerPayload" JSONB,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "soldAt" TIMESTAMP(3) NOT NULL,
    "shiftDate" VARCHAR(10),
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmIdentity" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "normalizedHash" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "verifiedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmConsent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'LOCAL',
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "proofRef" TEXT,
    "actorId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSegmentSnapshot" (
    "contactId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "visits" INTEGER NOT NULL,
    "lastVisitAt" TIMESTAMP(3),
    "segment" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "ruleVersion" TEXT NOT NULL,

    CONSTRAINT "CrmSegmentSnapshot_pkey" PRIMARY KEY ("contactId")
);

-- CreateTable
CREATE TABLE "CrmSegmentJob" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "processed" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSegmentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmImport" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "rows" JSONB NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "applied" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmVisitRevision" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmVisitRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmExperiment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "assignmentSalt" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "messageVersion" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT NOT NULL,
    "benefit" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'LOCAL',
    "costBudgetCents" DECIMAL(18,0) NOT NULL,
    "unitCostCents" DECIMAL(18,0) NOT NULL,
    "fixedCostCents" DECIMAL(18,0) NOT NULL,
    "previewHash" TEXT,
    "eligibleAt" TIMESTAMP(3),
    "snapshotAsOf" TIMESTAMP(3),
    "lastCalculatedAt" TIMESTAMP(3),
    "excluded" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAssignment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "eligibleAt" TIMESTAMP(3) NOT NULL,
    "segmentAtEntry" TEXT NOT NULL,

    CONSTRAINT "CrmAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmApproval" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "previewHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDelivery" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'LOCAL',
    "messageVersion" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedCode" TEXT,
    "costCents" DECIMAL(18,0) NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLocalReceipt" (
    "deliveryId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmLocalReceipt_pkey" PRIMARY KEY ("deliveryId")
);

-- CreateTable
CREATE TABLE "CrmOutcome" (
    "assignmentId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "returned" BOOLEAN NOT NULL,
    "netRevenueCents" DECIMAL(18,0),
    "visits" INTEGER NOT NULL,
    "contaminated" BOOLEAN NOT NULL DEFAULT false,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmOutcome_pkey" PRIMARY KEY ("assignmentId")
);

-- CreateTable
CREATE TABLE "CrmMutation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAuditEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSale_saiposVendaId_key" ON "CrmSale"("saiposVendaId");

-- CreateIndex
CREATE INDEX "CrmSale_storeId_soldAt_idx" ON "CrmSale"("storeId", "soldAt");

-- CreateIndex
CREATE INDEX "CrmSale_storeId_status_soldAt_idx" ON "CrmSale"("storeId", "status", "soldAt");

-- CreateIndex
CREATE INDEX "CrmSale_storeId_source_shiftDate_idx" ON "CrmSale"("storeId", "source", "shiftDate");

-- CreateIndex
CREATE INDEX "CrmSale_storeId_crmContactId_status_soldAt_idx" ON "CrmSale"("storeId", "crmContactId", "status", "soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSale_storeId_source_externalId_key" ON "CrmSale"("storeId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSale_storeId_id_key" ON "CrmSale"("storeId", "id");

-- CreateIndex
CREATE INDEX "CrmContact_storeId_createdAt_idx" ON "CrmContact"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_storeId_phone_key" ON "CrmContact"("storeId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_storeId_id_key" ON "CrmContact"("storeId", "id");

-- CreateIndex
CREATE INDEX "CrmActivity_storeId_contactId_createdAt_idx" ON "CrmActivity"("storeId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmIdentity_storeId_contactId_idx" ON "CrmIdentity"("storeId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmIdentity_storeId_type_normalizedHash_key" ON "CrmIdentity"("storeId", "type", "normalizedHash");

-- CreateIndex
CREATE INDEX "CrmConsent_storeId_contactId_channel_effectiveAt_idx" ON "CrmConsent"("storeId", "contactId", "channel", "effectiveAt");

-- CreateIndex
CREATE INDEX "CrmSegmentSnapshot_storeId_segment_asOf_idx" ON "CrmSegmentSnapshot"("storeId", "segment", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSegmentSnapshot_storeId_contactId_key" ON "CrmSegmentSnapshot"("storeId", "contactId");

-- CreateIndex
CREATE INDEX "CrmSegmentJob_status_createdAt_idx" ON "CrmSegmentJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CrmImport_status_createdAt_idx" ON "CrmImport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmImport_storeId_id_key" ON "CrmImport"("storeId", "id");

-- CreateIndex
CREATE INDEX "CrmVisitRevision_storeId_saleId_createdAt_idx" ON "CrmVisitRevision"("storeId", "saleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmVisitRevision_storeId_saleId_revision_key" ON "CrmVisitRevision"("storeId", "saleId", "revision");

-- CreateIndex
CREATE INDEX "CrmExperiment_storeId_createdAt_idx" ON "CrmExperiment"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmExperiment_storeId_id_key" ON "CrmExperiment"("storeId", "id");

-- CreateIndex
CREATE INDEX "CrmAssignment_storeId_contactId_idx" ON "CrmAssignment"("storeId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmAssignment_experimentId_contactId_key" ON "CrmAssignment"("experimentId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmAssignment_storeId_id_key" ON "CrmAssignment"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmApproval_experimentId_version_key" ON "CrmApproval"("experimentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDelivery_assignmentId_key" ON "CrmDelivery"("assignmentId");

-- CreateIndex
CREATE INDEX "CrmDelivery_state_createdAt_idx" ON "CrmDelivery"("state", "createdAt");

-- CreateIndex
CREATE INDEX "CrmDelivery_storeId_sentAt_idx" ON "CrmDelivery"("storeId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDelivery_storeId_assignmentId_key" ON "CrmDelivery"("storeId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLocalReceipt_providerId_key" ON "CrmLocalReceipt"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOutcome_storeId_assignmentId_key" ON "CrmOutcome"("storeId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMutation_storeId_actorId_key_key" ON "CrmMutation"("storeId", "actorId", "key");

-- CreateIndex
CREATE INDEX "CrmAuditEvent_storeId_entityType_entityId_createdAt_idx" ON "CrmAuditEvent"("storeId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "saipos_venda_unidadeId_id_key" ON "saipos_venda"("unidadeId", "id");

-- AddForeignKey
ALTER TABLE "CrmSale" ADD CONSTRAINT "CrmSale_storeId_saiposVendaId_fkey" FOREIGN KEY ("storeId", "saiposVendaId") REFERENCES "saipos_venda"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSale" ADD CONSTRAINT "CrmSale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSale" ADD CONSTRAINT "CrmSale_storeId_crmContactId_fkey" FOREIGN KEY ("storeId", "crmContactId") REFERENCES "CrmContact"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_storeId_mergedIntoId_fkey" FOREIGN KEY ("storeId", "mergedIntoId") REFERENCES "CrmContact"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_storeId_contactId_fkey" FOREIGN KEY ("storeId", "contactId") REFERENCES "CrmContact"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmIdentity" ADD CONSTRAINT "CrmIdentity_storeId_contactId_fkey" FOREIGN KEY ("storeId", "contactId") REFERENCES "CrmContact"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConsent" ADD CONSTRAINT "CrmConsent_storeId_contactId_fkey" FOREIGN KEY ("storeId", "contactId") REFERENCES "CrmContact"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSegmentSnapshot" ADD CONSTRAINT "CrmSegmentSnapshot_storeId_contactId_fkey" FOREIGN KEY ("storeId", "contactId") REFERENCES "CrmContact"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSegmentJob" ADD CONSTRAINT "CrmSegmentJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImport" ADD CONSTRAINT "CrmImport_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmVisitRevision" ADD CONSTRAINT "CrmVisitRevision_sale_fkey" FOREIGN KEY ("storeId", "saleId") REFERENCES "CrmSale"("storeId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CrmVisitRevision" ADD CONSTRAINT "CrmVisitRevision_import_fkey" FOREIGN KEY ("storeId", "importId") REFERENCES "CrmImport"("storeId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CrmExperiment" ADD CONSTRAINT "CrmExperiment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAssignment" ADD CONSTRAINT "CrmAssignment_storeId_experimentId_fkey" FOREIGN KEY ("storeId", "experimentId") REFERENCES "CrmExperiment"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAssignment" ADD CONSTRAINT "CrmAssignment_storeId_contactId_fkey" FOREIGN KEY ("storeId", "contactId") REFERENCES "CrmContact"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmApproval" ADD CONSTRAINT "CrmApproval_storeId_experimentId_fkey" FOREIGN KEY ("storeId", "experimentId") REFERENCES "CrmExperiment"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDelivery" ADD CONSTRAINT "CrmDelivery_storeId_assignmentId_fkey" FOREIGN KEY ("storeId", "assignmentId") REFERENCES "CrmAssignment"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLocalReceipt" ADD CONSTRAINT "CrmLocalReceipt_delivery_fkey" FOREIGN KEY ("deliveryId") REFERENCES "CrmDelivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CrmOutcome" ADD CONSTRAINT "CrmOutcome_storeId_assignmentId_fkey" FOREIGN KEY ("storeId", "assignmentId") REFERENCES "CrmAssignment"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMutation" ADD CONSTRAINT "CrmMutation_store_fkey" FOREIGN KEY ("storeId") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CrmAuditEvent" ADD CONSTRAINT "CrmAuditEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
