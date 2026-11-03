BEGIN;
-- AlterTable
ALTER TABLE "lancamento" ADD COLUMN     "assinaturaCriacao" TEXT,
ADD COLUMN     "chaveCriacao" TEXT;

-- AlterTable
ALTER TABLE "pdv_movimento_caixa" ADD COLUMN     "assinatura" TEXT,
ADD COLUMN     "chave" TEXT;

-- AlterTable
ALTER TABLE "pdv_venda" ADD COLUMN     "destinoEstoqueCancelamento" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "lancamento_unidadeId_chaveCriacao_key" ON "lancamento"("unidadeId", "chaveCriacao");

-- CreateIndex
CREATE UNIQUE INDEX "pdv_movimento_caixa_organizacaoId_unidadeId_chave_key" ON "pdv_movimento_caixa"("organizacaoId", "unidadeId", "chave");


ALTER TABLE pdv_venda ADD CONSTRAINT destino_estoque_cancelamento_valido CHECK ("destinoEstoqueCancelamento" IS NULL OR "destinoEstoqueCancelamento" IN ('PERDA','DEVOLVER'));
COMMIT;
