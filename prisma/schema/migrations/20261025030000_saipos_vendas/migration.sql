-- Migração aditiva: não altera vendas, financeiro ou permissões existentes.
CREATE UNIQUE INDEX "unidade_organizacaoId_id_key" ON "unidade"("organizacaoId", "id");
CREATE TABLE "saipos_vinculo" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "organizacaoId" TEXT NOT NULL,
 "unidadeId" TEXT NOT NULL,
 "lojaSaiposId" INTEGER NOT NULL CHECK ("lojaSaiposId" > 0),
 "habilitado" BOOLEAN NOT NULL DEFAULT true,
 "cursor" VARCHAR(19),
 "coberturaDesde" VARCHAR(10),
 "ultimaTentativaEm" TIMESTAMP(3),
 "solicitadaEm" TIMESTAMP(3),
 "ultimoSucessoEm" TIMESTAMP(3),
 "ultimoErro" TEXT,
 "ultimaQuantidade" INTEGER NOT NULL DEFAULT 0,
 "concessaoDono" TEXT,
 "concessaoAte" TIMESTAMP(3),
 "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "atualizadoEm" TIMESTAMP(3) NOT NULL,
 "excluidoEm" TIMESTAMP(3),
 CONSTRAINT "saipos_vinculo_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId","unidadeId") REFERENCES "unidade"("organizacaoId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "saipos_vinculo_unidadeId_key" ON "saipos_vinculo"("unidadeId");
CREATE UNIQUE INDEX "saipos_vinculo_lojaSaiposId_key" ON "saipos_vinculo"("lojaSaiposId");
CREATE UNIQUE INDEX "saipos_vinculo_organizacaoId_unidadeId_key" ON "saipos_vinculo"("organizacaoId","unidadeId");
CREATE TABLE "saipos_venda" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "organizacaoId" TEXT NOT NULL,
 "unidadeId" TEXT NOT NULL,
 "vendaExternaId" TEXT NOT NULL,
 "dataTurno" VARCHAR(10) NOT NULL,
 "totalCentavos" INTEGER NOT NULL,
 "cancelada" BOOLEAN NOT NULL,
 "criadaNoSaiposEm" TIMESTAMP(3) NOT NULL,
 "alteradaNoSaiposEm" TIMESTAMP(3) NOT NULL,
 "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "atualizadoEm" TIMESTAMP(3) NOT NULL,
 "excluidoEm" TIMESTAMP(3),
 CONSTRAINT "saipos_venda_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId","unidadeId") REFERENCES "saipos_vinculo"("organizacaoId","unidadeId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "saipos_venda_organizacaoId_unidadeId_vendaExternaId_key" ON "saipos_venda"("organizacaoId","unidadeId","vendaExternaId");
CREATE INDEX "saipos_venda_organizacaoId_unidadeId_dataTurno_cancelada_idx" ON "saipos_venda"("organizacaoId","unidadeId","dataTurno","cancelada");
