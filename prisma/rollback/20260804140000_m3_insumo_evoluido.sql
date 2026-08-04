-- ===========================================================================
-- ROLLBACK DA M3
--
-- Seguro: `custoMedio` e `unidadeMedida` nunca foram tocados pela M3 e
-- continuam com os valores originais. Nada do que se perde aqui existia antes.
--
-- Perde-se apenas o que foi cadastrado DEPOIS da M3: tipo MANIPULADO,
-- controle de lote, validade e as exceções por loja.
-- ===========================================================================

DROP TABLE "insumo_por_unidade";

ALTER TABLE "insumo" DROP CONSTRAINT "insumo_organizacaoId_unidadeCompraId_fkey";
ALTER TABLE "insumo" DROP CONSTRAINT "insumo_organizacaoId_unidadeEstoqueId_fkey";

ALTER TABLE "insumo" DROP CONSTRAINT "insumo_validade_positiva";
ALTER TABLE "insumo" DROP CONSTRAINT "insumo_estoque_minimo_nao_negativo";
ALTER TABLE "insumo" DROP CONSTRAINT "insumo_custo_nao_negativo";

ALTER TABLE "insumo"
  DROP COLUMN "validadeDias",
  DROP COLUMN "controlaLote",
  DROP COLUMN "custoReferencia",
  DROP COLUMN "unidadeCompraId",
  DROP COLUMN "unidadeEstoqueId",
  DROP COLUMN "tipo";

DROP TYPE "TipoInsumo";
