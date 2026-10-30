BEGIN;
-- Sandbox e produção mantêm identificadores e históricos distintos na mesma empresa.
DROP INDEX "integracao_inter_unidadeId_empresaId_key";
CREATE UNIQUE INDEX "integracao_inter_unidadeId_empresaId_ambiente_key" ON "integracao_inter"("unidadeId", "empresaId", "ambiente");
COMMIT;
