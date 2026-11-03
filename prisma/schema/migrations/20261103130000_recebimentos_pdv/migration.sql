BEGIN;
-- CreateTable
CREATE TABLE "configuracao_recebimento_pdv" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "forma" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "empresaId" TEXT,
    "contaId" TEXT,
    "categoriaId" TEXT,
    "taxaBps" INTEGER,
    "prazoDias" INTEGER,
    "baixarNoRecebimento" BOOLEAN NOT NULL DEFAULT false,
    "versao" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_recebimento_pdv_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "configuracao_recebimento_pdv_organizacaoId_unidadeId_idx" ON "configuracao_recebimento_pdv"("organizacaoId", "unidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_recebimento_pdv_unidadeId_forma_key" ON "configuracao_recebimento_pdv"("unidadeId", "forma");

-- AddForeignKey
ALTER TABLE "configuracao_recebimento_pdv" ADD CONSTRAINT "configuracao_recebimento_pdv_unidadeId_empresaId_fkey" FOREIGN KEY ("unidadeId", "empresaId") REFERENCES "empresa_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_recebimento_pdv" ADD CONSTRAINT "configuracao_recebimento_pdv_unidadeId_empresaId_contaId_fkey" FOREIGN KEY ("unidadeId", "empresaId", "contaId") REFERENCES "conta_financeira"("unidadeId", "empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_recebimento_pdv" ADD CONSTRAINT "configuracao_recebimento_pdv_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categoria_financeira"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE configuracao_recebimento_pdv ADD CONSTRAINT recebimento_pdv_valido CHECK (
 forma IN ('DINHEIRO','PIX','DEBITO','CREDITO') AND
 ("taxaBps" IS NULL OR "taxaBps" BETWEEN 0 AND 9999) AND
 ("prazoDias" IS NULL OR "prazoDias" BETWEEN 0 AND 365) AND
 (NOT ativa OR ("empresaId" IS NOT NULL AND "contaId" IS NOT NULL AND "categoriaId" IS NOT NULL AND "taxaBps" IS NOT NULL AND "prazoDias" IS NOT NULL)) AND
 (NOT "baixarNoRecebimento" OR (forma IN ('DINHEIRO','PIX') AND "prazoDias" IS NOT NULL AND "prazoDias"=0)) AND
 (forma <> 'DINHEIRO' OR (COALESCE("taxaBps",0)=0 AND COALESCE("prazoDias",0)=0))
);
ALTER TABLE configuracao_recebimento_pdv ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracao_recebimento_pdv FORCE ROW LEVEL SECURITY;
CREATE POLICY financeiro_escopo ON configuracao_recebimento_pdv
 USING ("organizacaoId" = current_setting('tetteo.financeiro_organizacao',true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade',true))
 WITH CHECK ("organizacaoId" = current_setting('tetteo.financeiro_organizacao',true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade',true));

COMMIT;
