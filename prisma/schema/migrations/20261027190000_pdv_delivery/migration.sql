-- Cadastros por unidade e snapshot de entrega. Preserva todas as vendas antigas.
CREATE TABLE "pdv_area_entrega" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "nomeChave" TEXT NOT NULL,
  "cidade" TEXT NOT NULL,
  "uf" TEXT NOT NULL,
  "bairros" JSONB NOT NULL,
  "freteCentavos" INTEGER NOT NULL,
  "prazoMinutos" INTEGER NOT NULL,
  "ativa" BOOLEAN NOT NULL DEFAULT true,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "ultimoHash" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pdv_area_entrega_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pdv_area_entrega_valida" CHECK ("versao" >= 1 AND "freteCentavos" BETWEEN 0 AND 100000000 AND "prazoMinutos" BETWEEN 1 AND 1440 AND jsonb_typeof("bairros") = 'array' AND "uf" IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'))
);
CREATE UNIQUE INDEX "pdv_area_entrega_nome_key" ON "pdv_area_entrega" ("organizacaoId","unidadeId","nomeChave");
CREATE INDEX "pdv_area_entrega_organizacaoId_unidadeId_ativa_idx" ON "pdv_area_entrega" ("organizacaoId","unidadeId","ativa");
ALTER TABLE "pdv_area_entrega" ADD CONSTRAINT "pdv_area_entrega_unidade_fkey" FOREIGN KEY ("organizacaoId","unidadeId") REFERENCES "unidade" ("organizacaoId","id") ON DELETE RESTRICT;

CREATE TABLE "pdv_entregador" (
  "id" TEXT NOT NULL,
  "organizacaoId" TEXT NOT NULL,
  "unidadeId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "telefone" TEXT NOT NULL DEFAULT '',
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "ultimoHash" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pdv_entregador_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pdv_entregador_versao_valida" CHECK ("versao" >= 1)
);
CREATE UNIQUE INDEX "pdv_entregador_organizacaoId_unidadeId_id_key" ON "pdv_entregador" ("organizacaoId","unidadeId","id");
CREATE INDEX "pdv_entregador_organizacaoId_unidadeId_ativo_idx" ON "pdv_entregador" ("organizacaoId","unidadeId","ativo");
ALTER TABLE "pdv_entregador" ADD CONSTRAINT "pdv_entregador_unidade_fkey" FOREIGN KEY ("organizacaoId","unidadeId") REFERENCES "unidade" ("organizacaoId","id") ON DELETE RESTRICT;

ALTER TABLE "pdv_venda" ADD COLUMN "freteCentavos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "entrega" JSONB;
ALTER TABLE "pdv_venda" DROP CONSTRAINT "pdv_venda_valida";
ALTER TABLE "pdv_venda" ADD CONSTRAINT "pdv_venda_valida" CHECK ("status" IN ('CONCLUIDA','CANCELADA') AND "subtotalCentavos" >= 0 AND "descontoCentavos" >= 0 AND "taxaCentavos" >= 0 AND "freteCentavos" >= 0 AND "totalCentavos" > 0 AND "trocoCentavos" >= 0 AND "totalCentavos" = "subtotalCentavos" - "descontoCentavos" + "taxaCentavos" + "freteCentavos");
ALTER TABLE "pdv_pedido" ADD COLUMN "entregadorId" TEXT,
  ADD COLUMN "entregadorNome" TEXT;
ALTER TABLE "pdv_pedido" ADD CONSTRAINT "pdv_pedido_entregador_fkey" FOREIGN KEY ("organizacaoId","unidadeId","entregadorId") REFERENCES "pdv_entregador" ("organizacaoId","unidadeId","id") ON DELETE RESTRICT;
