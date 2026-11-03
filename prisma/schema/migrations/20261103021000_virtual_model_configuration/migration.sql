-- CreateTable
CREATE TABLE "av_model_configuration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GEMINI',
    "model" TEXT NOT NULL DEFAULT '',
    "encryptedKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "inputMicrosPerMillion" INTEGER NOT NULL DEFAULT 0,
    "outputMicrosPerMillion" INTEGER NOT NULL DEFAULT 0,
    "ratesConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "testState" TEXT NOT NULL DEFAULT 'PENDING',
    "testedRevision" INTEGER,
    "testedAt" TIMESTAMP(3),
    "testError" TEXT,
    "testTokens" INTEGER NOT NULL DEFAULT 0,
    "testCostMicros" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "av_model_configuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "av_model_probe" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RUNNING',
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "av_model_probe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "av_model_configuration_organizationId_storeId_key" ON "av_model_configuration"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "av_model_configuration_organizationId_storeId_id_key" ON "av_model_configuration"("organizationId", "storeId", "id");

-- CreateIndex
CREATE INDEX "av_model_probe_organizationId_storeId_createdAt_idx" ON "av_model_probe"("organizationId", "storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "av_model_probe_organizationId_storeId_requestId_key" ON "av_model_probe"("organizationId", "storeId", "requestId");

-- AddForeignKey
ALTER TABLE "av_model_configuration" ADD CONSTRAINT "av_model_configuration_organizationId_storeId_fkey" FOREIGN KEY ("organizationId", "storeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "av_model_probe" ADD CONSTRAINT "av_model_probe_organizationId_storeId_configurationId_fkey" FOREIGN KEY ("organizationId", "storeId", "configurationId") REFERENCES "av_model_configuration"("organizationId", "storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Credenciais só de Gemini e ativação vinculada à revisão testada.
ALTER TABLE "av_model_configuration"
  ADD CONSTRAINT "av_model_provider" CHECK ("provider" = 'GEMINI'),
  ADD CONSTRAINT "av_model_limits" CHECK ("revision" > 0 AND "inputMicrosPerMillion" >= 0 AND "outputMicrosPerMillion" >= 0 AND "testTokens" >= 0 AND "testCostMicros" >= 0),
  ADD CONSTRAINT "av_model_test_state" CHECK ("testState" IN ('PENDING', 'TESTING', 'PASSED', 'FAILED')),
  ADD CONSTRAINT "av_model_test_revision" CHECK ("testedRevision" IS NULL OR ("testedRevision" > 0 AND "testedRevision" <= "revision")),
  ADD CONSTRAINT "av_model_activation" CHECK (NOT "enabled" OR ("testState" = 'PASSED' AND "testedRevision" IS NOT NULL AND "testedRevision" = "revision" AND "testedAt" IS NOT NULL AND "ratesConfirmed" AND "model" <> ''));
ALTER TABLE "av_model_probe"
  ADD CONSTRAINT "av_model_probe_limits" CHECK ("revision" > 0 AND "tokens" >= 0 AND "costMicros" >= 0),
  ADD CONSTRAINT "av_model_probe_state" CHECK ("state" IN ('RUNNING', 'PASSED', 'FAILED')),
  ADD CONSTRAINT "av_model_probe_completion" CHECK ("state" = 'RUNNING' OR "completedAt" IS NOT NULL);
