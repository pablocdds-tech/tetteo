-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoDeMovimento" ADD VALUE 'VENDA';
ALTER TYPE "TipoDeMovimento" ADD VALUE 'ESTORNO_VENDA';

-- CreateTable
CREATE TABLE "pdv_produto" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "fichaId" TEXT NOT NULL,
    "codigo" TEXT,
    "grupos" JSONB NOT NULL DEFAULT '[]',
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pdv_produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdv_caixa" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "localEstoqueId" TEXT NOT NULL,
    "abertoPorId" TEXT NOT NULL,
    "operador" TEXT NOT NULL,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadoEm" TIMESTAMP(3),
    "fechadoPorId" TEXT,
    "saldoInicialCentavos" INTEGER NOT NULL,
    "valorContadoCentavos" INTEGER,
    "saldoFechamentoCentavos" INTEGER,
    "observacao" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "pdv_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdv_movimento_caixa" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdv_movimento_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdv_venda" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "operador" TEXT NOT NULL,
    "clienteId" TEXT,
    "cliente" TEXT,
    "modalidade" TEXT NOT NULL,
    "observacao" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'CONCLUIDA',
    "subtotalCentavos" INTEGER NOT NULL,
    "descontoCentavos" INTEGER NOT NULL,
    "taxaCentavos" INTEGER NOT NULL,
    "totalCentavos" INTEGER NOT NULL,
    "trocoCentavos" INTEGER NOT NULL,
    "itens" JSONB NOT NULL,
    "pagamentos" JSONB NOT NULL,
    "consumo" JSONB NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceladaEm" TIMESTAMP(3),
    "canceladaPorId" TEXT,
    "motivoCancelamento" TEXT,

    CONSTRAINT "pdv_venda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pdv_produto_organizacaoId_fichaId_key" ON "pdv_produto"("organizacaoId", "fichaId");

-- CreateIndex
CREATE UNIQUE INDEX "pdv_produto_organizacaoId_codigo_key" ON "pdv_produto"("organizacaoId", "codigo");

-- CreateIndex
CREATE INDEX "pdv_caixa_organizacaoId_unidadeId_abertoEm_idx" ON "pdv_caixa"("organizacaoId", "unidadeId", "abertoEm");

-- CreateIndex
CREATE UNIQUE INDEX "pdv_caixa_organizacaoId_unidadeId_id_key" ON "pdv_caixa"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE INDEX "pdv_movimento_caixa_caixaId_criadoEm_idx" ON "pdv_movimento_caixa"("caixaId", "criadoEm");

-- CreateIndex
CREATE INDEX "pdv_venda_organizacaoId_unidadeId_criadaEm_idx" ON "pdv_venda"("organizacaoId", "unidadeId", "criadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "pdv_venda_organizacaoId_unidadeId_chave_key" ON "pdv_venda"("organizacaoId", "unidadeId", "chave");

-- AddForeignKey
ALTER TABLE "pdv_movimento_caixa" ADD CONSTRAINT "pdv_movimento_caixa_organizacaoId_unidadeId_caixaId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "caixaId") REFERENCES "pdv_caixa"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdv_venda" ADD CONSTRAINT "pdv_venda_organizacaoId_unidadeId_caixaId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "caixaId") REFERENCES "pdv_caixa"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Apenas um caixa aberto por unidade, inclusive diante de requisições concorrentes.
CREATE UNIQUE INDEX "pdv_caixa_unico_aberto" ON "pdv_caixa" ("organizacaoId", "unidadeId") WHERE "fechadoEm" IS NULL;
ALTER TABLE "pdv_caixa" ADD CONSTRAINT "pdv_caixa_unidade_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade" ("organizacaoId", "id") ON DELETE RESTRICT;
ALTER TABLE "pdv_produto" ADD CONSTRAINT "pdv_produto_ficha_fkey" FOREIGN KEY ("fichaId") REFERENCES "ficha_tecnica" ("id") ON DELETE RESTRICT;
ALTER TABLE "pdv_caixa" ADD CONSTRAINT "pdv_caixa_saldo_valido" CHECK ("saldoInicialCentavos" >= 0 AND ("valorContadoCentavos" IS NULL OR "valorContadoCentavos" >= 0));
ALTER TABLE "pdv_movimento_caixa" ADD CONSTRAINT "pdv_movimento_valido" CHECK ("tipo" IN ('SANGRIA','SUPRIMENTO') AND "valorCentavos" > 0);
ALTER TABLE "pdv_venda" ADD CONSTRAINT "pdv_venda_valida" CHECK ("status" IN ('CONCLUIDA','CANCELADA') AND "subtotalCentavos" >= 0 AND "descontoCentavos" >= 0 AND "taxaCentavos" >= 0 AND "totalCentavos" > 0 AND "trocoCentavos" >= 0 AND "totalCentavos" = "subtotalCentavos" - "descontoCentavos" + "taxaCentavos");
