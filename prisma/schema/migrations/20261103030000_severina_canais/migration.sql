-- DropIndex
DROP INDEX "AvChannelAccount_organizationId_storeId_mode_key";

-- CreateTable
CREATE TABLE "av_channel_connection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "encryptedCredentials" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "bindingKey" TEXT NOT NULL,
    "connectionState" TEXT NOT NULL DEFAULT 'PENDING',
    "verifiedRevision" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "webhookSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "av_channel_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av_channel_test" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "encryptedRecipient" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'SENDING',
    "providerId" TEXT,
    "error" TEXT,
    "observedAt" TIMESTAMP(3),
    "observedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "av_channel_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av_channel_window" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "av_channel_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av_booking_capacity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "time" VARCHAR(5) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "av_booking_capacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av_agent_policy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "instructions" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "greeting" TEXT NOT NULL,
    "fallbackMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av_agent_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "av_channel_connection_accountId_key" ON "av_channel_connection"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "av_channel_connection_bindingKey_key" ON "av_channel_connection"("bindingKey");

-- CreateIndex
CREATE UNIQUE INDEX "av_channel_connection_organizationId_storeId_accountId_key" ON "av_channel_connection"("organizationId", "storeId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "av_channel_connection_organizationId_storeId_accountId_id_key" ON "av_channel_connection"("organizationId", "storeId", "accountId", "id");

-- CreateIndex
CREATE INDEX "av_channel_test_organizationId_storeId_accountId_createdAt_idx" ON "av_channel_test"("organizationId", "storeId", "accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "av_channel_test_accountId_requestId_key" ON "av_channel_test"("accountId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "av_channel_test_accountId_providerId_key" ON "av_channel_test"("accountId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "av_channel_window_accountId_recipientHash_key" ON "av_channel_window"("accountId", "recipientHash");

-- CreateIndex
CREATE UNIQUE INDEX "av_booking_capacity_organizationId_storeId_date_time_key" ON "av_booking_capacity"("organizationId", "storeId", "date", "time");

-- CreateIndex
CREATE INDEX "av_agent_policy_organizationId_storeId_status_version_idx" ON "av_agent_policy"("organizationId", "storeId", "status", "version");

-- CreateIndex
CREATE UNIQUE INDEX "av_agent_policy_organizationId_storeId_version_key" ON "av_agent_policy"("organizationId", "storeId", "version");

-- CreateIndex
CREATE INDEX "AvChannelAccount_organizationId_storeId_mode_idx" ON "AvChannelAccount"("organizationId", "storeId", "mode");

-- AddForeignKey
ALTER TABLE "av_channel_connection" ADD CONSTRAINT "av_channel_connection_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_channel_test" ADD CONSTRAINT "av_channel_test_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_channel_window" ADD CONSTRAINT "av_channel_window_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_booking_capacity" ADD CONSTRAINT "av_booking_capacity_organizationId_storeId_fkey" FOREIGN KEY ("organizationId", "storeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_agent_policy" ADD CONSTRAINT "av_agent_policy_organizationId_storeId_fkey" FOREIGN KEY ("organizationId", "storeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing DEMO accounts and their events are preserved. Real accounts remain
-- inactive until the server validates the current connection and test proof.
ALTER TABLE "AvChannelAccount" DROP CONSTRAINT "av_channel_demo_only";
ALTER TABLE "AvChannelAccount" ADD CONSTRAINT "av_channel_mode" CHECK ("mode" IN ('DEMO', 'EVOLUTION', 'META'));
ALTER TABLE "av_channel_connection"
  ADD CONSTRAINT "av_channel_connection_state" CHECK ("connectionState" IN ('PENDING', 'VERIFIED', 'FAILED')),
  ADD CONSTRAINT "av_channel_connection_revision" CHECK ("revision" > 0 AND ("verifiedRevision" IS NULL OR "verifiedRevision" > 0)),
  ADD CONSTRAINT "av_channel_connection_verified" CHECK ("connectionState" <> 'VERIFIED' OR ("verifiedRevision" IS NOT NULL AND "verifiedRevision" = "revision" AND "verifiedAt" IS NOT NULL));
ALTER TABLE "av_channel_test"
  ADD CONSTRAINT "av_channel_test_state" CHECK ("state" IN ('SENDING', 'UNCERTAIN', 'ACCEPTED', 'DELIVERED', 'READ', 'FAILED')),
  ADD CONSTRAINT "av_channel_test_revision" CHECK ("revision" > 0),
  ADD CONSTRAINT "av_channel_test_observation" CHECK (("observedAt" IS NULL) = ("observedById" IS NULL));
ALTER TABLE "av_booking_capacity"
  ADD CONSTRAINT "av_booking_capacity_limits" CHECK ("capacity" BETWEEN 1 AND 500 AND "version" > 0),
  ADD CONSTRAINT "av_booking_capacity_date_time" CHECK ("date" ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' AND "time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "av_agent_policy"
  ADD CONSTRAINT "av_agent_policy_version" CHECK ("version" > 0 AND "tone" IN ('ACOLHEDOR', 'OBJETIVO')),
  ADD CONSTRAINT "av_agent_policy_approval" CHECK ("status" IN ('DRAFT', 'APPROVED') AND ("status" <> 'APPROVED' OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL)));
