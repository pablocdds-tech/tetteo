-- CreateEnum
CREATE TYPE "UnidadeMedida" AS ENUM ('KG', 'G', 'L', 'ML', 'UN');

-- CreateTable
CREATE TABLE "insumo" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT,
    "unidadeMedida" "UnidadeMedida" NOT NULL,
    "custoMedio" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "estoqueMinimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "atualizadoPorId" TEXT,

    CONSTRAINT "insumo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insumo_organizacaoId_ativo_idx" ON "insumo"("organizacaoId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "insumo_organizacaoId_nome_key" ON "insumo"("organizacaoId", "nome");
