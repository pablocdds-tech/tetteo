-- ===========================================================================
-- ROLLBACK DA M4
--
-- ⚠️ DESTRUTIVO E, DEPOIS DO PRIMEIRO MOVIMENTO REAL, IRREVERSÍVEL.
--
--    O razão é a única fonte de verdade do estoque. Derrubá-lo apaga o
--    histórico de tudo que entrou, saiu, foi produzido e foi perdido — e não
--    existe de onde reconstruir, porque não há outra cópia por desenho.
--
--    Antes de rodar isto em qualquer banco com dado real:
--      COPY (SELECT * FROM "movimento_estoque") TO '/backup/razao.csv' CSV HEADER;
--
--    Só é seguro sem cerimônia enquanto a tabela estiver vazia.
-- ===========================================================================

DROP VIEW "saldo_divergente";

DROP TRIGGER "movimento_estoque_antes_de_inserir" ON "movimento_estoque";
DROP FUNCTION "movimento_estoque_antes_de_inserir"();

DROP TRIGGER "movimento_estoque_imutavel" ON "movimento_estoque";
DROP FUNCTION "movimento_estoque_imutavel"();

-- `movimento_estoque` primeiro: ela referencia `lote`.
DROP TABLE "movimento_estoque";
DROP TABLE "saldo_estoque";
DROP TABLE "lote";

DROP TYPE "StatusLote";
DROP TYPE "OrigemMovimento";
DROP TYPE "TipoMovimento";
