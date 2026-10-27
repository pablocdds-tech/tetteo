-- Rascunhos sem reserva de estoque ou pagamentos. Migração estritamente aditiva.
CREATE TABLE "pdv_carrinho" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "nome" TEXT NOT NULL DEFAULT '',
  "conteudo" JSONB NOT NULL,
  "ultimoHash" TEXT NOT NULL,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ATIVO',
  "vendaId" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  "descartadoEm" TIMESTAMP(3),
  "concluidoEm" TIMESTAMP(3),
  CONSTRAINT "pdv_carrinho_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pdv_carrinho_estado_valido" CHECK (
    "versao" >= 1 AND "status" IN ('ATIVO','DESCARTADO','CONCLUIDO') AND
    (("status" = 'ATIVO' AND "vendaId" IS NULL AND "descartadoEm" IS NULL AND "concluidoEm" IS NULL) OR
     ("status" = 'DESCARTADO' AND "vendaId" IS NULL AND "descartadoEm" IS NOT NULL AND "concluidoEm" IS NULL) OR
     ("status" = 'CONCLUIDO' AND "vendaId" IS NOT NULL AND "concluidoEm" IS NOT NULL AND "descartadoEm" IS NULL))
  )
);
CREATE UNIQUE INDEX "pdv_carrinho_vendaId_key" ON "pdv_carrinho" ("vendaId");
CREATE INDEX "pdv_carrinho_operador_estado_data_idx" ON "pdv_carrinho" ("organizacaoId", "unidadeId", "usuarioId", "status", "atualizadoEm");
ALTER TABLE "pdv_carrinho" ADD CONSTRAINT "pdv_carrinho_unidade_fkey" FOREIGN KEY ("organizacaoId","unidadeId") REFERENCES "unidade" ("organizacaoId","id") ON DELETE RESTRICT;
ALTER TABLE "pdv_carrinho" ADD CONSTRAINT "pdv_carrinho_usuario_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuario" ("id") ON DELETE RESTRICT;
ALTER TABLE "pdv_carrinho" ADD CONSTRAINT "pdv_carrinho_venda_fkey" FOREIGN KEY ("vendaId") REFERENCES "pdv_venda" ("id") ON DELETE RESTRICT;
