-- Nenhum destinatário de avisos é autorizado para notas automaticamente.
CREATE TABLE "autorizacao_nota_whatsapp" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "vinculoId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "telefone" TEXT NOT NULL,
  "autorizadoEm" TIMESTAMP(3),
  "autorizadoPorId" TEXT,
  "revogadoEm" TIMESTAMP(3),
  "revogadoPorId" TEXT,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "autorizacao_nota_whatsapp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "autorizacao_nota_whatsapp_escopo_key" ON "autorizacao_nota_whatsapp"("organizacaoId","unidadeId","vinculoId");
CREATE INDEX "autorizacao_nota_whatsapp_organizacaoId_unidadeId_usuarioId_idx" ON "autorizacao_nota_whatsapp"("organizacaoId","unidadeId","usuarioId");
