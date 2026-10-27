-- Recebimento separado da criação/produção: nenhum pagamento ou fecho antigo é inventado.
ALTER TABLE "pdv_venda"
  ADD COLUMN "caixaRecebimentoId" TEXT,
  ADD COLUMN "recebidoEm" TIMESTAMP(3),
  ADD COLUMN "recebidoPorId" TEXT,
  ADD COLUMN "recebidoPorNome" TEXT,
  ADD COLUMN "recebimentoChave" TEXT,
  ADD COLUMN "recebimentoHash" TEXT,
  ADD COLUMN "versaoFinanceira" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "pdv_venda_recebimento_chave_key" ON "pdv_venda" ("organizacaoId","unidadeId","recebimentoChave");
CREATE INDEX "pdv_venda_status_data_idx" ON "pdv_venda" ("organizacaoId","unidadeId","status","criadaEm");
CREATE UNIQUE INDEX "pdv_pedido_escopo_venda_key" ON "pdv_pedido" ("organizacaoId","unidadeId","vendaId");
ALTER TABLE "pdv_venda" ADD CONSTRAINT "pdv_venda_recebimento_caixa_fkey" FOREIGN KEY ("organizacaoId","unidadeId","caixaRecebimentoId") REFERENCES "pdv_caixa" ("organizacaoId","unidadeId","id") ON DELETE RESTRICT;

ALTER TABLE "pdv_venda" DROP CONSTRAINT "pdv_venda_valida";
ALTER TABLE "pdv_venda" ADD CONSTRAINT "pdv_venda_valida" CHECK ("status" IN ('PENDENTE','CONCLUIDA','CANCELADA') AND "subtotalCentavos" >= 0 AND "descontoCentavos" >= 0 AND "taxaCentavos" >= 0 AND "freteCentavos" >= 0 AND "totalCentavos" > 0 AND "trocoCentavos" >= 0 AND "totalCentavos" = "subtotalCentavos" - "descontoCentavos" + "taxaCentavos" + "freteCentavos");
ALTER TABLE "pdv_venda" ADD CONSTRAINT "pdv_venda_financeiro_valido" CHECK (
  "versaoFinanceira" >= 1 AND ("status" <> 'PENDENTE' OR (
    "pagamentos" = '[]'::jsonb AND "trocoCentavos" = 0 AND "caixaRecebimentoId" IS NULL
    AND "recebidoEm" IS NULL AND "recebidoPorId" IS NULL AND "recebidoPorNome" IS NULL
    AND "recebimentoChave" IS NULL AND "recebimentoHash" IS NULL
  ))
);
-- Pagas antigas continuam válidas com recebimento NULL e são contabilizadas
-- no caixa original por fallback. Novos recebimentos usam a relação explícita.
