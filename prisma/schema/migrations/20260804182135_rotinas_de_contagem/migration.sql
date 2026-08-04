-- CreateEnum
CREATE TYPE "Recorrencia" AS ENUM ('DIARIA', 'SEMANAL', 'MENSAL');

-- AlterTable
ALTER TABLE "contagem" ADD COLUMN     "rotinaId" TEXT;

-- CreateTable
CREATE TABLE "rotina_de_contagem" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "recorrencia" "Recorrencia" NOT NULL,
    "diaDaSemana" INTEGER,
    "diaDoMes" INTEGER,
    "horario" TEXT,
    "localId" TEXT,
    "categorias" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rotina_de_contagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rotina_de_contagem_unidadeId_ativo_idx" ON "rotina_de_contagem"("unidadeId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "rotina_de_contagem_unidadeId_nome_key" ON "rotina_de_contagem"("unidadeId", "nome");

-- AddForeignKey
ALTER TABLE "rotina_de_contagem" ADD CONSTRAINT "rotina_de_contagem_localId_fkey" FOREIGN KEY ("localId") REFERENCES "local_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagem" ADD CONSTRAINT "contagem_rotinaId_fkey" FOREIGN KEY ("rotinaId") REFERENCES "rotina_de_contagem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
