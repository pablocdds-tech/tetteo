-- AlterTable
ALTER TABLE "CrmContact" ADD COLUMN     "saiposManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "saiposUpdatedAt" TIMESTAMP(3),
ALTER COLUMN "phone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CrmSaiposSync" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "historyStart" VARCHAR(10) NOT NULL,
    "historyCoveredFrom" VARCHAR(10),
    "historyComplete" BOOLEAN NOT NULL DEFAULT false,
    "cursor" VARCHAR(19),
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSaiposSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSaiposSync_storeId_key" ON "CrmSaiposSync"("storeId");

-- AddForeignKey
ALTER TABLE "CrmSaiposSync" ADD CONSTRAINT "CrmSaiposSync_organizacaoId_storeId_fkey" FOREIGN KEY ("organizacaoId", "storeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
