-- CreateEnum
CREATE TYPE "TipoDeConta" AS ENUM ('CAIXA', 'BANCO');

-- CreateEnum
CREATE TYPE "TipoDeCategoria" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "DirecaoDoLancamento" AS ENUM ('PAGAR', 'RECEBER');

-- CreateEnum
CREATE TYPE "StatusLancamento" AS ENUM ('ABERTO', 'QUITADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "conta_financeira" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoDeConta" NOT NULL DEFAULT 'BANCO',
    "saldoInicial" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conta_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categoria_financeira" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoDeCategoria" NOT NULL,
    "grupo" TEXT,
    "ehSistema" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categoria_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamento" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "direcao" "DirecaoDoLancamento" NOT NULL,
    "status" "StatusLancamento" NOT NULL DEFAULT 'ABERTO',
    "descricao" TEXT NOT NULL,
    "categoriaId" TEXT,
    "fornecedorId" TEXT,
    "notaEntradaId" TEXT,
    "valor" DECIMAL(14,2) NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "quitadoEm" TIMESTAMP(3),
    "valorQuitado" DECIMAL(14,2),
    "contaId" TEXT,
    "grupoParcelas" TEXT,
    "parcela" INTEGER,
    "totalParcelas" INTEGER,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "canceladoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "quitadoPorId" TEXT,

    CONSTRAINT "lancamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conta_financeira_unidadeId_ativa_idx" ON "conta_financeira"("unidadeId", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "conta_financeira_unidadeId_nome_key" ON "conta_financeira"("unidadeId", "nome");

-- CreateIndex
CREATE INDEX "categoria_financeira_organizacaoId_tipo_ativa_idx" ON "categoria_financeira"("organizacaoId", "tipo", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "categoria_financeira_organizacaoId_nome_key" ON "categoria_financeira"("organizacaoId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "lancamento_notaEntradaId_key" ON "lancamento"("notaEntradaId");

-- CreateIndex
CREATE INDEX "lancamento_unidadeId_status_vencimento_idx" ON "lancamento"("unidadeId", "status", "vencimento");

-- CreateIndex
CREATE INDEX "lancamento_unidadeId_direcao_vencimento_idx" ON "lancamento"("unidadeId", "direcao", "vencimento");

-- CreateIndex
CREATE INDEX "lancamento_grupoParcelas_idx" ON "lancamento"("grupoParcelas");

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categoria_financeira"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_notaEntradaId_fkey" FOREIGN KEY ("notaEntradaId") REFERENCES "nota_entrada"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "conta_financeira"("id") ON DELETE SET NULL ON UPDATE CASCADE;

