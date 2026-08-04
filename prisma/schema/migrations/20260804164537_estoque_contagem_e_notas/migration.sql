-- CreateEnum
CREATE TYPE "StatusNota" AS ENUM ('RASCUNHO', 'LANCADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusContagem" AS ENUM ('ABERTA', 'FECHADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "embalagem_compra" (
    "id" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "fator" DECIMAL(14,4) NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embalagem_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedor" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "telefone" TEXT,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,

    CONSTRAINT "fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nota_entrada" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "numero" TEXT,
    "serie" TEXT,
    "chaveAcesso" TEXT,
    "emitidaEm" TIMESTAMP(3),
    "recebidaEm" TIMESTAMP(3) NOT NULL,
    "status" "StatusNota" NOT NULL DEFAULT 'RASCUNHO',
    "valorTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "lancadaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "registradaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nota_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nota_entrada_item" (
    "id" TEXT NOT NULL,
    "notaId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidadeNota" DECIMAL(14,3) NOT NULL,
    "embalagemId" TEXT,
    "fatorConversao" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "valorUnitario" DECIMAL(14,4) NOT NULL,
    "valorTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "nota_entrada_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contagem" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "referencia" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT,
    "categorias" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "StatusContagem" NOT NULL DEFAULT 'ABERTA',
    "abertaPorId" TEXT,
    "fechadaPorId" TEXT,
    "fechadaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contagem_item" (
    "id" TEXT NOT NULL,
    "contagemId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3),
    "custoUnitario" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "contadoPorId" TEXT,
    "contadoEm" TIMESTAMP(3),

    CONSTRAINT "contagem_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "embalagem_compra_insumoId_ativo_idx" ON "embalagem_compra"("insumoId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "embalagem_compra_insumoId_nome_key" ON "embalagem_compra"("insumoId", "nome");

-- CreateIndex
CREATE INDEX "fornecedor_organizacaoId_ativo_idx" ON "fornecedor"("organizacaoId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedor_organizacaoId_nome_key" ON "fornecedor"("organizacaoId", "nome");

-- CreateIndex
CREATE INDEX "nota_entrada_unidadeId_recebidaEm_idx" ON "nota_entrada"("unidadeId", "recebidaEm");

-- CreateIndex
CREATE INDEX "nota_entrada_unidadeId_status_idx" ON "nota_entrada"("unidadeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "nota_entrada_unidadeId_fornecedorId_numero_serie_key" ON "nota_entrada"("unidadeId", "fornecedorId", "numero", "serie");

-- CreateIndex
CREATE INDEX "nota_entrada_item_notaId_idx" ON "nota_entrada_item"("notaId");

-- CreateIndex
CREATE INDEX "nota_entrada_item_insumoId_idx" ON "nota_entrada_item"("insumoId");

-- CreateIndex
CREATE INDEX "contagem_unidadeId_referencia_idx" ON "contagem"("unidadeId", "referencia");

-- CreateIndex
CREATE INDEX "contagem_unidadeId_status_idx" ON "contagem"("unidadeId", "status");

-- CreateIndex
CREATE INDEX "contagem_item_insumoId_idx" ON "contagem_item"("insumoId");

-- CreateIndex
CREATE UNIQUE INDEX "contagem_item_contagemId_insumoId_key" ON "contagem_item"("contagemId", "insumoId");

-- AddForeignKey
ALTER TABLE "embalagem_compra" ADD CONSTRAINT "embalagem_compra_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_entrada" ADD CONSTRAINT "nota_entrada_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_entrada_item" ADD CONSTRAINT "nota_entrada_item_notaId_fkey" FOREIGN KEY ("notaId") REFERENCES "nota_entrada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_entrada_item" ADD CONSTRAINT "nota_entrada_item_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_entrada_item" ADD CONSTRAINT "nota_entrada_item_embalagemId_fkey" FOREIGN KEY ("embalagemId") REFERENCES "embalagem_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagem_item" ADD CONSTRAINT "contagem_item_contagemId_fkey" FOREIGN KEY ("contagemId") REFERENCES "contagem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagem_item" ADD CONSTRAINT "contagem_item_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
