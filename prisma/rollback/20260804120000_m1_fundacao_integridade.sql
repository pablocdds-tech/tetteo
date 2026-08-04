-- ===========================================================================
-- ROLLBACK DA M1
--
-- Executado à mão, nunca pelo Prisma. Devolve o banco ao estado anterior.
--
-- ⚠️ O passo 5 pode FALHAR — de propósito. Se algum insumo excluído dividir o
--    nome com um ativo (situação que a M1 passou a permitir), a trava antiga
--    não cabe mais. Nesse caso resolva o conflito antes; não force.
-- ===========================================================================

-- 5. Volta a travar o nome inclusive entre os excluídos
DROP INDEX "insumo_nome_ativo_uk";
CREATE UNIQUE INDEX "insumo_organizacaoId_nome_key" ON "insumo"("organizacaoId", "nome");

-- 4. Remove a chave estrangeira
ALTER TABLE "insumo" DROP CONSTRAINT "insumo_organizacaoId_fkey";

-- 3. Remove os alvos das FKs compostas
DROP INDEX "insumo_organizacaoId_id_key";
DROP INDEX "unidade_organizacaoId_id_key";

-- 2. Estreita a escala de volta.
--    ATENÇÃO: perde a 4ª casa decimal. Só é seguro se nada tiver gravado nela.
ALTER TABLE "insumo" ALTER COLUMN "estoqueMinimo" TYPE DECIMAL(14,3);

-- 1. Devolve o nome do tipo
ALTER TYPE "UnidadeMedidaLegado" RENAME TO "UnidadeMedida";
