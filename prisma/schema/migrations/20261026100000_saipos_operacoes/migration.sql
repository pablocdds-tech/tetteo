-- AlterTable
ALTER TABLE "saipos_vinculo" ADD COLUMN     "detalhesAte" TIMESTAMP(3),
ADD COLUMN     "detalhesCursor" VARCHAR(19),
ADD COLUMN     "detalhesDono" TEXT,
ADD COLUMN     "detalhesErro" TEXT,
ADD COLUMN     "detalhesSucessoEm" TIMESTAMP(3),
ADD COLUMN     "detalhesTentativaEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "saipos_venda" ADD COLUMN     "detalhesEm" TIMESTAMP(3),
ADD COLUMN     "historicoAtualizadoEm" TIMESTAMP(3),
ADD COLUMN     "historicoSaipos" JSONB,
ADD COLUMN     "itensAtualizadosEm" TIMESTAMP(3),
ADD COLUMN     "itensSaipos" JSONB;

-- CreateTable
CREATE TABLE "saipos_operacao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" VARCHAR(200) NOT NULL,
    "referencia" VARCHAR(100) NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "estado" TEXT NOT NULL,
    "payloadCifrado" TEXT NOT NULL,
    "respostaCifrada" TEXT,
    "erro" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "saipos_operacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saipos_operacao_organizacaoId_unidadeId_ambiente_tipo_criad_idx" ON "saipos_operacao"("organizacaoId", "unidadeId", "ambiente", "tipo", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "saipos_operacao_organizacaoId_unidadeId_ambiente_tipo_chave_key" ON "saipos_operacao"("organizacaoId", "unidadeId", "ambiente", "tipo", "chave");

-- AddForeignKey
ALTER TABLE "saipos_operacao" ADD CONSTRAINT "saipos_operacao_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
