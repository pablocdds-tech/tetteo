-- CreateEnum
CREATE TYPE "GrupoDre" AS ENUM ('RECEITA', 'DEDUCAO', 'MERCADORIA', 'PESSOAL', 'OCUPACAO', 'OPERACIONAL', 'FINANCEIRA', 'INVESTIMENTO');

-- AlterTable
ALTER TABLE "categoria_financeira" ADD COLUMN     "grupoDre" "GrupoDre";

