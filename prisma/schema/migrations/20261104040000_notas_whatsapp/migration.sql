CREATE TABLE "conversa_nota_whatsapp" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "instanciaId" TEXT NOT NULL,
  "vinculoId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "notaAtivaId" TEXT,
  "padroes" JSONB,
  "leaseAte" TIMESTAMP(3),
  "leaseDono" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversa_nota_whatsapp_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "nota_fiscal_whatsapp" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "instanciaId" TEXT NOT NULL,
  "vinculoId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "mensagemId" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'RECEBIDA',
  "arquivoId" TEXT,
  "imagemHash" TEXT,
  "leitura" JSONB,
  "rascunho" JSONB,
  "pergunta" JSONB,
  "revisao" INTEGER NOT NULL DEFAULT 0,
  "codigo" TEXT,
  "resumoHash" TEXT,
  "resumoEm" TIMESTAMP(3),
  "expiraEm" TIMESTAMP(3),
  "confirmacaoId" TEXT,
  "resultado" JSONB,
  "erro" TEXT,
  "custoMicros" INTEGER NOT NULL DEFAULT 0,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "leituraTentadaEm" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nota_fiscal_whatsapp_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "mensagem_nota_whatsapp" (
  "id" TEXT NOT NULL,
  "conversaId" TEXT NOT NULL,
  "instanciaId" TEXT NOT NULL,
  "idExterno" TEXT NOT NULL,
  "direcao" TEXT NOT NULL,
  "tipo" TEXT NOT NULL DEFAULT 'TEXTO',
  "texto" TEXT,
  "notaId" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "enviadaEm" TIMESTAMP(3),
  "idEnviado" TEXT,
  "recebidoEm" TIMESTAMP(3) NOT NULL,
  "aplicadaEm" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mensagem_nota_whatsapp_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "vinculo_item_nota_whatsapp" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "fornecedor" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "unidadeNota" TEXT NOT NULL,
  "insumoId" TEXT NOT NULL,
  "fator" DECIMAL(14,6) NOT NULL,
  "confirmadoPorId" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vinculo_item_nota_whatsapp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversa_nota_whatsapp_instanciaId_vinculoId_key" ON "conversa_nota_whatsapp"("instanciaId", "vinculoId");
CREATE INDEX "conversa_nota_whatsapp_organizacaoId_unidadeId_idx" ON "conversa_nota_whatsapp"("organizacaoId", "unidadeId");
CREATE UNIQUE INDEX "nota_fiscal_whatsapp_mensagemId_key" ON "nota_fiscal_whatsapp"("mensagemId");
CREATE INDEX "nota_fiscal_whatsapp_organizacaoId_unidadeId_criadoEm_idx" ON "nota_fiscal_whatsapp"("organizacaoId", "unidadeId", "criadoEm");
CREATE INDEX "nota_fiscal_whatsapp_instanciaId_vinculoId_estado_idx" ON "nota_fiscal_whatsapp"("instanciaId", "vinculoId", "estado");
CREATE INDEX "nota_fiscal_whatsapp_unidadeId_imagemHash_idx" ON "nota_fiscal_whatsapp"("unidadeId", "imagemHash");
CREATE UNIQUE INDEX "mensagem_nota_whatsapp_instanciaId_idExterno_key" ON "mensagem_nota_whatsapp"("instanciaId", "idExterno");
CREATE INDEX "mensagem_nota_whatsapp_conversaId_direcao_estado_recebidoEm_idx" ON "mensagem_nota_whatsapp"("conversaId", "direcao", "estado", "recebidoEm");
CREATE UNIQUE INDEX "vinculo_item_nota_whatsapp_organizacaoId_unidadeId_forneced_key" ON "vinculo_item_nota_whatsapp"("organizacaoId", "unidadeId", "fornecedor", "descricao", "unidadeNota");
ALTER TABLE "mensagem_nota_whatsapp" ADD CONSTRAINT "mensagem_nota_whatsapp_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversa_nota_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
