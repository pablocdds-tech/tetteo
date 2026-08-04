-- AlterTable
ALTER TABLE "contagem" ADD COLUMN     "localId" TEXT;

-- AlterTable
ALTER TABLE "insumo" ADD COLUMN     "custoUltimo" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "unidadeRotulo" TEXT;

-- CreateTable
CREATE TABLE "local_estoque" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posicao_estoque" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "estoqueMinimo" DECIMAL(14,3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posicao_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_estoque_unidadeId_ativo_idx" ON "local_estoque"("unidadeId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "local_estoque_unidadeId_nome_key" ON "local_estoque"("unidadeId", "nome");

-- CreateIndex
CREATE INDEX "posicao_estoque_unidadeId_insumoId_idx" ON "posicao_estoque"("unidadeId", "insumoId");

-- CreateIndex
CREATE UNIQUE INDEX "posicao_estoque_localId_insumoId_key" ON "posicao_estoque"("localId", "insumoId");

-- AddForeignKey
ALTER TABLE "posicao_estoque" ADD CONSTRAINT "posicao_estoque_localId_fkey" FOREIGN KEY ("localId") REFERENCES "local_estoque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posicao_estoque" ADD CONSTRAINT "posicao_estoque_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagem" ADD CONSTRAINT "contagem_localId_fkey" FOREIGN KEY ("localId") REFERENCES "local_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;
