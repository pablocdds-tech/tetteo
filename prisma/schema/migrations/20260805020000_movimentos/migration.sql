-- CreateEnum
CREATE TYPE "TipoDeMovimento" AS ENUM ('ENTRADA', 'PERDA', 'QUEBRA', 'CONSUMO_INTERNO', 'DOACAO', 'TRANSFERENCIA', 'AJUSTE');

-- CreateTable
CREATE TABLE "movimento_estoque" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "localDestinoId" TEXT,
    "tipo" "TipoDeMovimento" NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "custoUnitario" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "motivo" TEXT,
    "contagemId" TEXT,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registradoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimento_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimento_estoque_unidadeId_ocorridoEm_idx" ON "movimento_estoque"("unidadeId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "movimento_estoque_unidadeId_tipo_ocorridoEm_idx" ON "movimento_estoque"("unidadeId", "tipo", "ocorridoEm");

-- CreateIndex
CREATE INDEX "movimento_estoque_insumoId_idx" ON "movimento_estoque"("insumoId");

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_localId_fkey" FOREIGN KEY ("localId") REFERENCES "local_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_localDestinoId_fkey" FOREIGN KEY ("localDestinoId") REFERENCES "local_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

