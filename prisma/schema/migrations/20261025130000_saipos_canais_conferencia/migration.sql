ALTER TABLE "saipos_venda" ADD COLUMN "modalidade" INTEGER, ADD COLUMN "origem" VARCHAR(120), ADD COLUMN "canalImportado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "saipos_vinculo" ADD COLUMN "canaisAte" VARCHAR(10), ADD COLUMN "ultimoErroCanais" TEXT;
CREATE TABLE "saipos_referencia_fechamento" (
 "id" TEXT NOT NULL, "organizacaoId" TEXT NOT NULL, "unidadeId" TEXT NOT NULL,
 "de" VARCHAR(10) NOT NULL, "ate" VARCHAR(10) NOT NULL, "totalCentavos" INTEGER NOT NULL,
 "versao" INTEGER NOT NULL DEFAULT 1, "informadaPorId" TEXT NOT NULL,
 "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "atualizadoEm" TIMESTAMP(3) NOT NULL, "excluidoEm" TIMESTAMP(3),
 CONSTRAINT "saipos_referencia_fechamento_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "saipos_referencia_valor_check" CHECK ("totalCentavos" >= 0),
 CONSTRAINT "saipos_referencia_periodo_check" CHECK ("de" <= "ate"),
 CONSTRAINT "saipos_referencia_vinculo_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "saipos_vinculo"("organizacaoId", "unidadeId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "saipos_referencia_autor_fkey" FOREIGN KEY ("informadaPorId") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "saipos_referencia_fechamento_organizacaoId_unidadeId_de_ate_key" ON "saipos_referencia_fechamento"("organizacaoId", "unidadeId", "de", "ate");
