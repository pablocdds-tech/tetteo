ALTER TABLE "nota_fiscal_whatsapp"
  ADD COLUMN "tentativasLeitura" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "metodoLeitura" TEXT,
  ADD COLUMN "arquivosDerivados" JSONB,
  ADD COLUMN "validacoes" JSONB,
  ADD COLUMN "versaoLeitor" TEXT;
ALTER TABLE "vinculo_item_nota_whatsapp" ADD COLUMN "codigoFornecedor" TEXT, ADD COLUMN "ean" TEXT;
CREATE INDEX "vinculo_item_nota_whatsapp_org_unidade_codigo_idx" ON "vinculo_item_nota_whatsapp"("organizacaoId","unidadeId","fornecedor","codigoFornecedor");
CREATE INDEX "vinculo_item_nota_whatsapp_org_unidade_ean_idx" ON "vinculo_item_nota_whatsapp"("organizacaoId","unidadeId","ean");
