ALTER TABLE "AvConversation"
  ADD COLUMN "nameSource" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "nameUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "nameNeedsConfirmation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "nameUsableForReservation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "channelNames" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "nameLookupRevision" INTEGER,
  ADD COLUMN "nameLookupAfter" TIMESTAMP(3),
  ADD COLUMN "nameLookupLeaseOwner" TEXT,
  ADD COLUMN "nameLookupLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "nameLookupAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nameLookupLastAt" TIMESTAMP(3),
  ADD COLUMN "nameLookupError" TEXT,
  ADD CONSTRAINT "av_customer_name_source" CHECK ("nameSource" IN ('CUSTOMER_CORRECTION','CRM_VERIFIED','DEVICE_CONTACT','PROVIDER_CONTACT','CRM_PHONE_HINT','WHATSAPP_PROFILE','HISTORY','UNKNOWN')),
  ADD CONSTRAINT "av_customer_name_lease" CHECK (("nameLookupLeaseOwner" IS NULL) = ("nameLookupLeaseUntil" IS NULL)),
  ADD CONSTRAINT "av_customer_name_attempts" CHECK ("nameLookupAttempts" BETWEEN 0 AND 3);
CREATE INDEX "AvConversation_nameLookupAfter_nameLookupLeaseUntil_idx" ON "AvConversation"("nameLookupAfter","nameLookupLeaseUntil");
