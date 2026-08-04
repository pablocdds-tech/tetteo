-- ===========================================================================
-- M1 · FUNDAÇÃO DE INTEGRIDADE
--
-- Não cria nenhuma tabela. Existe só para que o razão de estoque (M4) nasça
-- em terreno íntegro — corrigir isto depois, com movimento gravado em cima,
-- é ordens de grandeza mais caro.
--
-- Quatro coisas:
--   1. A chave estrangeira que faltava em `insumo`
--   2. Os alvos das chaves estrangeiras COMPOSTAS que vêm nas próximas
--   3. Nome de insumo único só entre os NÃO excluídos
--   4. Quantidade e dinheiro na mesma escala decimal
--
-- Aditiva. Nenhum DROP de tabela ou de coluna, nenhuma perda de dado.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. VERIFICAÇÃO PRÉVIA
--
-- `insumo.organizacaoId` nunca teve chave estrangeira, então nada impediu, até
-- hoje, um insumo apontando para organização inexistente. Se houver algum, o
-- ALTER lá embaixo falharia com uma mensagem que não diz o que fazer. Aqui a
-- migration para antes e diz.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  orfaos INT;
BEGIN
  SELECT COUNT(*) INTO orfaos
  FROM "insumo" i
  LEFT JOIN "organizacao" o ON o."id" = i."organizacaoId"
  WHERE o."id" IS NULL;

  IF orfaos > 0 THEN
    RAISE EXCEPTION
      'M1 abortada: % insumo(s) apontam para organização inexistente. Liste-os com: SELECT i.id, i."organizacaoId", i.nome FROM "insumo" i LEFT JOIN "organizacao" o ON o.id = i."organizacaoId" WHERE o.id IS NULL; — corrija ou exclua antes de rodar.',
      orfaos;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. LIBERA O NOME `UnidadeMedida` PARA A TABELA DA M2
--
-- A M2 cria a TABELA `unidade_medida`, que substitui este enum. O Prisma não
-- deixa um enum e um model dividirem o mesmo nome, então o tipo antigo vira
-- `UnidadeMedidaLegado` e some na M9.
--
-- RENAME de tipo não toca em dado: a coluna `insumo.unidadeMedida` continua
-- com os mesmos valores, agora sob o nome novo.
-- ---------------------------------------------------------------------------
ALTER TYPE "UnidadeMedida" RENAME TO "UnidadeMedidaLegado";

-- ---------------------------------------------------------------------------
-- 2. QUANTIDADE NA MESMA ESCALA DO DINHEIRO
--
-- Era DECIMAL(14,3), o dinheiro é DECIMAL(14,4). Alargar escala é lossless —
-- 1.234 vira 1.2340. Estreitar é que arredondaria, e não é o que acontece aqui.
-- ---------------------------------------------------------------------------
ALTER TABLE "insumo" ALTER COLUMN "estoqueMinimo" TYPE DECIMAL(14,4);

-- ---------------------------------------------------------------------------
-- 3. OS ALVOS DAS CHAVES ESTRANGEIRAS COMPOSTAS
--
-- A partir da M4, toda FK entre tabelas de domínio carrega `organizacaoId`
-- junto: `movimento_estoque (organizacaoId, insumoId)` → `insumo (organizacaoId,
-- id)`. Uma FK composta precisa de um índice único composto do outro lado.
--
-- É isto que transforma "toda FK valida o mesmo tenant" de intenção em
-- garantia física: o Postgres passa a RECUSAR um lançamento da organização A
-- que aponte para um insumo da organização B, mesmo que a aplicação erre.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "unidade_organizacaoId_id_key" ON "unidade"("organizacaoId", "id");
CREATE UNIQUE INDEX "insumo_organizacaoId_id_key" ON "insumo"("organizacaoId", "id");

-- ---------------------------------------------------------------------------
-- 4. A CHAVE ESTRANGEIRA QUE FALTAVA
--
-- As 13 tabelas do Core têm 24 FKs. `insumo`, criada depois, não tinha nenhuma.
-- RESTRICT e não CASCADE: apagar uma organização não pode levar o catálogo
-- junto em silêncio.
-- ---------------------------------------------------------------------------
ALTER TABLE "insumo"
  ADD CONSTRAINT "insumo_organizacaoId_fkey"
  FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. NOME ÚNICO SÓ ENTRE OS VIVOS
--
-- A trava antiga valia para TODAS as linhas, inclusive as logicamente
-- excluídas. Efeito: excluir "Mussarela" queimava o nome para sempre —
-- recadastrar devolvia "Já existe um insumo com esse nome" apontando para um
-- registro que a tela não mostra mais.
--
-- O índice novo é estritamente mais permissivo que o antigo, então nenhum dado
-- existente pode violá-lo — não há verificação a fazer aqui.
--
-- ⚠️ O Prisma não expressa `WHERE` em índice e vai propor derrubar este.
--    Está registrado em `prisma/schema/README.md`. Nunca aceite.
-- ---------------------------------------------------------------------------
DROP INDEX "insumo_organizacaoId_nome_key";

CREATE UNIQUE INDEX "insumo_nome_ativo_uk"
  ON "insumo"("organizacaoId", "nome")
  WHERE "excluidoEm" IS NULL;
