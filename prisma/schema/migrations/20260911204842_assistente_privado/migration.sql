-- O assistente privado (OpenClaw na VPS) conta ao Tetteo o que fez. Uma linha
-- por chave de execução: a mesma chave atualiza, não duplica.

-- CreateEnum
CREATE TYPE "TipoDeRegistroDoAssistente" AS ENUM ('VERIFICACAO', 'EXECUCAO');

-- CreateTable
CREATE TABLE "registro_do_assistente" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "tipo" "TipoDeRegistroDoAssistente" NOT NULL,
    "chave" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "demonstracao" BOOLEAN NOT NULL DEFAULT false,
    "periodoDe" TEXT,
    "periodoAte" TEXT,
    "fonte" TEXT,
    "indicadores" JSONB,
    "avisos" JSONB NOT NULL DEFAULT '[]',
    "pendencias" JSONB NOT NULL DEFAULT '[]',
    "detalhe" TEXT,
    "versaoOpenclaw" TEXT,
    "modelo" TEXT,
    "proximaRotina" TIMESTAMP(3),
    "rotinaPausada" BOOLEAN,
    "limiteAte" TIMESTAMP(3),
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registro_do_assistente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registro_do_assistente_unidadeId_tipo_ocorridoEm_idx" ON "registro_do_assistente"("unidadeId", "tipo", "ocorridoEm");

-- CreateIndex
CREATE UNIQUE INDEX "registro_do_assistente_unidadeId_chave_key" ON "registro_do_assistente"("unidadeId", "chave");
