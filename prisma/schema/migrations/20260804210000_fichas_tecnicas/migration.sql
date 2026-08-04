-- CreateEnum
CREATE TYPE "TipoDeFicha" AS ENUM ('PRATO', 'PREPARO');

-- CreateTable
CREATE TABLE "ficha_tecnica" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT,
    "tipo" "TipoDeFicha" NOT NULL DEFAULT 'PRATO',
    "modoDePreparo" TEXT,
    "rendimento" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "unidadeRendimento" "UnidadeMedida" NOT NULL DEFAULT 'UN',
    "precoVenda" DECIMAL(14,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "atualizadoPorId" TEXT,

    CONSTRAINT "ficha_tecnica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_de_ficha" (
    "id" TEXT NOT NULL,
    "fichaId" TEXT NOT NULL,
    "insumoId" TEXT,
    "subFichaId" TEXT,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidade" "UnidadeMedida" NOT NULL,
    "perdaPercentual" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_de_ficha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ficha_tecnica_organizacaoId_tipo_ativo_idx" ON "ficha_tecnica"("organizacaoId", "tipo", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "ficha_tecnica_organizacaoId_nome_key" ON "ficha_tecnica"("organizacaoId", "nome");

-- CreateIndex
CREATE INDEX "item_de_ficha_fichaId_ordem_idx" ON "item_de_ficha"("fichaId", "ordem");

-- CreateIndex
CREATE INDEX "item_de_ficha_insumoId_idx" ON "item_de_ficha"("insumoId");

-- CreateIndex
CREATE INDEX "item_de_ficha_subFichaId_idx" ON "item_de_ficha"("subFichaId");

-- AddForeignKey
ALTER TABLE "item_de_ficha" ADD CONSTRAINT "item_de_ficha_fichaId_fkey" FOREIGN KEY ("fichaId") REFERENCES "ficha_tecnica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_de_ficha" ADD CONSTRAINT "item_de_ficha_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_de_ficha" ADD CONSTRAINT "item_de_ficha_subFichaId_fkey" FOREIGN KEY ("subFichaId") REFERENCES "ficha_tecnica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

