-- CreateTable
CREATE TABLE "av_knowledge_version" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "facts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "av_knowledge_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av_reservation_slot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "time" VARCHAR(5) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "av_reservation_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av_reservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT,
    "externalCustomerId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "av_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av_customer_preference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "contactId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "av_customer_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvChannelAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'DEMO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "debounceMs" INTEGER NOT NULL DEFAULT 1500,
    "maxWaitMs" INTEGER NOT NULL DEFAULT 8000,
    "notificationUserId" TEXT,
    "maxTurnTokens" INTEGER NOT NULL DEFAULT 4000,
    "maxTurnCostMicros" INTEGER NOT NULL DEFAULT 100000,
    "dailyBudgetMicros" INTEGER NOT NULL DEFAULT 5000000,
    "circuitUntil" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvInboundEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AvInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "contactId" TEXT,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "assignedToId" TEXT,
    "agentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "state" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "pendingSince" TIMESTAMP(3),
    "processAfter" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalId" TEXT,
    "direction" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TEXT',
    "transcriptionCertain" BOOLEAN NOT NULL DEFAULT true,
    "actorId" TEXT,
    "sequence" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AvMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvAgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "leaseOwner" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'DEMO_RULES',
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AvAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvToolExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "argsHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "objectId" TEXT,
    "state" TEXT,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvMessageOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'AGENT',
    "actorId" TEXT,
    "text" TEXT NOT NULL,
    "claims" JSONB NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "AvMessageOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvAgentPause" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "resumedById" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvAgentPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvEscalation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "alertState" TEXT NOT NULL DEFAULT 'PENDING',
    "notificationId" TEXT,
    "alertAttempts" INTEGER NOT NULL DEFAULT 0,
    "alertError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "conversationId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvOperatorRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvOperatorRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "av_knowledge_version_organizationId_storeId_accountId_statu_idx" ON "av_knowledge_version"("organizationId", "storeId", "accountId", "status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "av_knowledge_version_accountId_version_key" ON "av_knowledge_version"("accountId", "version");

-- CreateIndex
CREATE INDEX "av_reservation_slot_organizationId_storeId_accountId_date_e_idx" ON "av_reservation_slot"("organizationId", "storeId", "accountId", "date", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "av_reservation_slot_accountId_date_time_key" ON "av_reservation_slot"("accountId", "date", "time");

-- CreateIndex
CREATE UNIQUE INDEX "av_reservation_slot_organizationId_storeId_accountId_id_key" ON "av_reservation_slot"("organizationId", "storeId", "accountId", "id");

-- CreateIndex
CREATE INDEX "av_reservation_organizationId_storeId_accountId_conversatio_idx" ON "av_reservation"("organizationId", "storeId", "accountId", "conversationId", "status");

-- CreateIndex
CREATE INDEX "av_reservation_slotId_status_idx" ON "av_reservation"("slotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "av_reservation_accountId_idempotencyKey_key" ON "av_reservation"("accountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "av_customer_preference_organizationId_storeId_accountId_con_idx" ON "av_customer_preference"("organizationId", "storeId", "accountId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "av_customer_preference_accountId_externalCustomerId_key_key" ON "av_customer_preference"("accountId", "externalCustomerId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AvChannelAccount_organizationId_storeId_mode_key" ON "AvChannelAccount"("organizationId", "storeId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "AvChannelAccount_organizationId_storeId_id_key" ON "AvChannelAccount"("organizationId", "storeId", "id");

-- CreateIndex
CREATE INDEX "AvInboundEvent_organizationId_storeId_status_receivedAt_idx" ON "AvInboundEvent"("organizationId", "storeId", "status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AvInboundEvent_accountId_externalId_key" ON "AvInboundEvent"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "AvConversation_organizationId_storeId_status_lastMessageAt_idx" ON "AvConversation"("organizationId", "storeId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AvConversation_agentEnabled_processAfter_leaseUntil_idx" ON "AvConversation"("agentEnabled", "processAfter", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AvConversation_accountId_externalCustomerId_key" ON "AvConversation"("accountId", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "AvConversation_organizationId_storeId_accountId_id_key" ON "AvConversation"("organizationId", "storeId", "accountId", "id");

-- CreateIndex
CREATE INDEX "AvMessage_conversationId_sequence_idx" ON "AvMessage"("conversationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AvMessage_accountId_externalId_key" ON "AvMessage"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "AvAgentRun_organizationId_storeId_createdAt_idx" ON "AvAgentRun"("organizationId", "storeId", "createdAt");

-- CreateIndex
CREATE INDEX "AvAgentRun_conversationId_status_idx" ON "AvAgentRun"("conversationId", "status");

-- CreateIndex
CREATE INDEX "AvToolExecution_runId_createdAt_idx" ON "AvToolExecution"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AvToolExecution_conversationId_key_key" ON "AvToolExecution"("conversationId", "key");

-- CreateIndex
CREATE INDEX "AvMessageOutbox_state_createdAt_idx" ON "AvMessageOutbox"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AvMessageOutbox_conversationId_requestId_key" ON "AvMessageOutbox"("conversationId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AvMessageOutbox_accountId_providerId_key" ON "AvMessageOutbox"("accountId", "providerId");

-- CreateIndex
CREATE INDEX "AvAgentPause_conversationId_resumedAt_until_idx" ON "AvAgentPause"("conversationId", "resumedAt", "until");

-- CreateIndex
CREATE INDEX "AvEscalation_organizationId_storeId_status_updatedAt_idx" ON "AvEscalation"("organizationId", "storeId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AvEscalation_conversationId_key_key" ON "AvEscalation"("conversationId", "key");

-- CreateIndex
CREATE INDEX "AvAuditEvent_organizationId_storeId_createdAt_idx" ON "AvAuditEvent"("organizationId", "storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AvOperatorRequest_conversationId_requestId_key" ON "AvOperatorRequest"("conversationId", "requestId");

-- AddForeignKey
ALTER TABLE "av_knowledge_version" ADD CONSTRAINT "av_knowledge_version_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_reservation_slot" ADD CONSTRAINT "av_reservation_slot_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_reservation" ADD CONSTRAINT "av_reservation_organizationId_storeId_accountId_conversati_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId", "conversationId") REFERENCES "AvConversation"("organizationId", "storeId", "accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_reservation" ADD CONSTRAINT "av_reservation_storeId_contactId_fkey" FOREIGN KEY ("storeId", "contactId") REFERENCES "CrmContact"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_reservation" ADD CONSTRAINT "av_reservation_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_reservation" ADD CONSTRAINT "av_reservation_organizationId_storeId_accountId_slotId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId", "slotId") REFERENCES "av_reservation_slot"("organizationId", "storeId", "accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_customer_preference" ADD CONSTRAINT "av_customer_preference_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvChannelAccount" ADD CONSTRAINT "AvChannelAccount_organizationId_storeId_fkey" FOREIGN KEY ("organizationId", "storeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvInboundEvent" ADD CONSTRAINT "AvInboundEvent_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvConversation" ADD CONSTRAINT "AvConversation_organizationId_storeId_accountId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId") REFERENCES "AvChannelAccount"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvMessage" ADD CONSTRAINT "AvMessage_organizationId_storeId_accountId_conversationId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId", "conversationId") REFERENCES "AvConversation"("organizationId", "storeId", "accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvAgentRun" ADD CONSTRAINT "AvAgentRun_organizationId_storeId_accountId_conversationId_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId", "conversationId") REFERENCES "AvConversation"("organizationId", "storeId", "accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvToolExecution" ADD CONSTRAINT "AvToolExecution_organizationId_storeId_accountId_conversat_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId", "conversationId") REFERENCES "AvConversation"("organizationId", "storeId", "accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvMessageOutbox" ADD CONSTRAINT "AvMessageOutbox_organizationId_storeId_accountId_conversat_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId", "conversationId") REFERENCES "AvConversation"("organizationId", "storeId", "accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvAgentPause" ADD CONSTRAINT "AvAgentPause_organizationId_storeId_accountId_conversation_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId", "conversationId") REFERENCES "AvConversation"("organizationId", "storeId", "accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvEscalation" ADD CONSTRAINT "AvEscalation_organizationId_storeId_accountId_conversation_fkey" FOREIGN KEY ("organizationId", "storeId", "accountId", "conversationId") REFERENCES "AvConversation"("organizationId", "storeId", "accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariantes defensivas: nenhum canal real pode ser ativado nesta entrega.
ALTER TABLE "AvChannelAccount"
  ADD CONSTRAINT "av_channel_demo_only" CHECK ("mode" = 'DEMO'),
  ADD CONSTRAINT "av_channel_limits" CHECK ("debounceMs" >= 0 AND "maxWaitMs" >= "debounceMs" AND "maxWaitMs" <= 120000 AND "maxTurnTokens" > 0 AND "maxTurnCostMicros" >= 0 AND "dailyBudgetMicros" >= 0);
ALTER TABLE "AvConversation"
  ADD CONSTRAINT "av_conversation_status" CHECK ("status" IN ('OPEN', 'WAITING_CUSTOMER', 'WAITING_TEAM', 'ESCALATED', 'PAUSED', 'RESOLVED')),
  ADD CONSTRAINT "av_conversation_counters" CHECK ("version" > 0 AND "attempts" >= 0),
  ADD CONSTRAINT "av_conversation_lease" CHECK (("leaseOwner" IS NULL) = ("leaseUntil" IS NULL));
ALTER TABLE "av_knowledge_version"
  ADD CONSTRAINT "av_knowledge_validity" CHECK ("version" > 0 AND "validUntil" > "validFrom"),
  ADD CONSTRAINT "av_knowledge_approval" CHECK ("status" IN ('DRAFT', 'APPROVED') AND ("status" <> 'APPROVED' OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL)));
ALTER TABLE "av_reservation_slot"
  ADD CONSTRAINT "av_slot_capacity" CHECK ("capacity" > 0 AND "capacity" <= 500 AND "version" > 0),
  ADD CONSTRAINT "av_slot_date_time" CHECK ("date" ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' AND "time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "av_reservation"
  ADD CONSTRAINT "av_reservation_party" CHECK ("partySize" BETWEEN 1 AND 50 AND "version" > 0),
  ADD CONSTRAINT "av_reservation_status" CHECK ("status" IN ('CONFIRMED', 'CANCELLED'));
ALTER TABLE "AvAgentRun"
  ADD CONSTRAINT "av_run_counters" CHECK ("version" > 0 AND "tokens" >= 0 AND "costMicros" >= 0 AND "latencyMs" >= 0),
  ADD CONSTRAINT "av_run_status" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'DISCARDED', 'FAILED'));
ALTER TABLE "AvMessageOutbox"
  ADD CONSTRAINT "av_outbox_state" CHECK ("state" IN ('PENDING', 'UNCERTAIN', 'ACCEPTED', 'DELIVERED', 'READ', 'FAILED', 'DISCARDED', 'BLOCKED')),
  ADD CONSTRAINT "av_outbox_counters" CHECK ("version" > 0 AND "attempts" >= 0);
ALTER TABLE "AvEscalation"
  ADD CONSTRAINT "av_escalation_state" CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED') AND "alertState" IN ('PENDING', 'NOTIFIED', 'FAILED') AND "alertAttempts" >= 0),
  ADD CONSTRAINT "av_escalation_ack" CHECK ("status" <> 'ACKNOWLEDGED' OR ("acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL AND "assignedToId" IS NOT NULL));
