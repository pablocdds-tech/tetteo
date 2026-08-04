-- CreateEnum
CREATE TYPE "StatusCotacao" AS ENUM ('ABERTA', 'FECHADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusProposta" AS ENUM ('AGUARDANDO', 'RESPONDIDA', 'RECUSADA');

-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('RASCUNHO', 'ENVIADO', 'RECEBIDO', 'CANCELADO');

-- AlterTable
ALTER TABLE "fornecedor" ADD COLUMN     "condicaoPagamento" TEXT,
ADD COLUMN     "contato" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "prazoEntregaDias" INTEGER;

-- CreateTable
CREATE TABLE "cotacao" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "validaAte" TIMESTAMP(3),
    "status" "StatusCotacao" NOT NULL DEFAULT 'ABERTA',
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "fechadaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "criadoPorId" TEXT,

    CONSTRAINT "cotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_de_cotacao" (
    "id" TEXT NOT NULL,
    "cotacaoId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "observacao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_de_cotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposta_de_cotacao" (
    "id" TEXT NOT NULL,
    "cotacaoId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "status" "StatusProposta" NOT NULL DEFAULT 'AGUARDANDO',
    "frete" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pedidoMinimo" DECIMAL(14,2),
    "observacao" TEXT,
    "respondidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposta_de_cotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preco_proposto" (
    "id" TEXT NOT NULL,
    "propostaId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "embalagem" TEXT,
    "fatorConversao" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "precoEmbalagem" DECIMAL(14,4) NOT NULL,
    "precoUnitario" DECIMAL(14,4) NOT NULL,
    "naoAtende" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,

    CONSTRAINT "preco_proposto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "cotacaoId" TEXT,
    "status" "StatusPedido" NOT NULL DEFAULT 'RASCUNHO',
    "previsaoEntrega" TIMESTAMP(3),
    "frete" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "recebidoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_de_pedido" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "embalagem" TEXT,
    "fatorConversao" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "precoUnitario" DECIMAL(14,4) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "item_de_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cotacao_unidadeId_status_idx" ON "cotacao"("unidadeId", "status");

-- CreateIndex
CREATE INDEX "cotacao_unidadeId_criadoEm_idx" ON "cotacao"("unidadeId", "criadoEm");

-- CreateIndex
CREATE INDEX "item_de_cotacao_cotacaoId_ordem_idx" ON "item_de_cotacao"("cotacaoId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "item_de_cotacao_cotacaoId_insumoId_key" ON "item_de_cotacao"("cotacaoId", "insumoId");

-- CreateIndex
CREATE INDEX "proposta_de_cotacao_fornecedorId_idx" ON "proposta_de_cotacao"("fornecedorId");

-- CreateIndex
CREATE UNIQUE INDEX "proposta_de_cotacao_cotacaoId_fornecedorId_key" ON "proposta_de_cotacao"("cotacaoId", "fornecedorId");

-- CreateIndex
CREATE INDEX "preco_proposto_itemId_idx" ON "preco_proposto"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "preco_proposto_propostaId_itemId_key" ON "preco_proposto"("propostaId", "itemId");

-- CreateIndex
CREATE INDEX "pedido_unidadeId_status_idx" ON "pedido"("unidadeId", "status");

-- CreateIndex
CREATE INDEX "pedido_unidadeId_criadoEm_idx" ON "pedido"("unidadeId", "criadoEm");

-- CreateIndex
CREATE INDEX "item_de_pedido_pedidoId_idx" ON "item_de_pedido"("pedidoId");

-- CreateIndex
CREATE INDEX "item_de_pedido_insumoId_idx" ON "item_de_pedido"("insumoId");

-- AddForeignKey
ALTER TABLE "item_de_cotacao" ADD CONSTRAINT "item_de_cotacao_cotacaoId_fkey" FOREIGN KEY ("cotacaoId") REFERENCES "cotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_de_cotacao" ADD CONSTRAINT "item_de_cotacao_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_de_cotacao" ADD CONSTRAINT "proposta_de_cotacao_cotacaoId_fkey" FOREIGN KEY ("cotacaoId") REFERENCES "cotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_de_cotacao" ADD CONSTRAINT "proposta_de_cotacao_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco_proposto" ADD CONSTRAINT "preco_proposto_propostaId_fkey" FOREIGN KEY ("propostaId") REFERENCES "proposta_de_cotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preco_proposto" ADD CONSTRAINT "preco_proposto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item_de_cotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_cotacaoId_fkey" FOREIGN KEY ("cotacaoId") REFERENCES "cotacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_de_pedido" ADD CONSTRAINT "item_de_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_de_pedido" ADD CONSTRAINT "item_de_pedido_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

