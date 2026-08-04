-- ===========================================================================
-- ROLLBACK DA M2
--
-- Executado à mão, nunca pelo Prisma.
--
-- ⚠️ DESTRUTIVO: derruba as duas tabelas com o conteúdo dentro. Só é seguro
--    enquanto ninguém tiver cadastrado conversão de verdade. A partir da M3,
--    `insumo.unidadeEstoqueId` aponta para cá — rode o rollback da M3 antes.
-- ===========================================================================

DROP TABLE "conversao_unidade";
DROP TABLE "unidade_medida";
DROP TYPE "GrandezaMedida";
