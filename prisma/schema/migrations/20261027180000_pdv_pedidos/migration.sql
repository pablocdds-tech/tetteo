-- Acompanhamento somente para novas vendas. Nenhum legado vai para a cozinha
-- nem é marcado como entregue sem evidência; permanece no histórico financeiro.
CREATE UNIQUE INDEX "pdv_venda_escopo_id_key" ON "pdv_venda" ("organizacaoId","unidadeId","id");

CREATE TABLE "pdv_pedido" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "vendaId" TEXT NOT NULL,
  "numero" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COZINHA',
  "versao" INTEGER NOT NULL DEFAULT 1,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  "prontoEm" TIMESTAMP(3),
  "saiuEntregaEm" TIMESTAMP(3),
  "entregueEm" TIMESTAMP(3),
  "canceladoEm" TIMESTAMP(3),
  CONSTRAINT "pdv_pedido_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pdv_pedido_estado_valido" CHECK (
    "versao" >= 1 AND "numero" > 0 AND
    "status" IN ('COZINHA','AGUARDANDO_COLETA','SAIU_ENTREGA','ENTREGUE','CANCELADO') AND
    ("status" <> 'ENTREGUE' OR "entregueEm" IS NOT NULL) AND
    ("status" <> 'CANCELADO' OR "canceladoEm" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "pdv_pedido_vendaId_key" ON "pdv_pedido" ("vendaId");
CREATE UNIQUE INDEX "pdv_pedido_organizacaoId_unidadeId_id_key" ON "pdv_pedido" ("organizacaoId","unidadeId","id");
CREATE UNIQUE INDEX "pdv_pedido_organizacaoId_unidadeId_numero_key" ON "pdv_pedido" ("organizacaoId","unidadeId","numero");
CREATE INDEX "pdv_pedido_unidade_status_data_idx" ON "pdv_pedido" ("organizacaoId","unidadeId","status","criadoEm");
CREATE INDEX "pdv_pedido_organizacaoId_unidadeId_entregueEm_idx" ON "pdv_pedido" ("organizacaoId","unidadeId","entregueEm");
CREATE INDEX "pdv_pedido_organizacaoId_unidadeId_canceladoEm_idx" ON "pdv_pedido" ("organizacaoId","unidadeId","canceladoEm");
ALTER TABLE "pdv_pedido" ADD CONSTRAINT "pdv_pedido_venda_fkey" FOREIGN KEY ("organizacaoId","unidadeId","vendaId") REFERENCES "pdv_venda" ("organizacaoId","unidadeId","id") ON DELETE RESTRICT;
ALTER TABLE "pdv_pedido" ADD CONSTRAINT "pdv_pedido_unidade_fkey" FOREIGN KEY ("organizacaoId","unidadeId") REFERENCES "unidade" ("organizacaoId","id") ON DELETE RESTRICT;

CREATE TABLE "pdv_pedido_evento" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "pedidoId" TEXT NOT NULL,
  "de" TEXT,
  "para" TEXT NOT NULL,
  "versao" INTEGER NOT NULL,
  "usuarioId" TEXT,
  "operador" TEXT NOT NULL,
  "observacao" TEXT NOT NULL DEFAULT '',
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pdv_pedido_evento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pdv_pedido_evento_valido" CHECK (
    "versao" >= 1 AND
    ("de" IS NULL OR "de" IN ('COZINHA','AGUARDANDO_COLETA','SAIU_ENTREGA','ENTREGUE','CANCELADO')) AND
    "para" IN ('COZINHA','AGUARDANDO_COLETA','SAIU_ENTREGA','ENTREGUE','CANCELADO')
  )
);
CREATE UNIQUE INDEX "pdv_pedido_evento_pedidoId_versao_key" ON "pdv_pedido_evento" ("pedidoId","versao");
ALTER TABLE "pdv_pedido_evento" ADD CONSTRAINT "pdv_pedido_evento_pedido_fkey" FOREIGN KEY ("organizacaoId","unidadeId","pedidoId") REFERENCES "pdv_pedido" ("organizacaoId","unidadeId","id") ON DELETE RESTRICT;
