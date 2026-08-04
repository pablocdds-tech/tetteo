-- ===========================================================================
-- M3 · INSUMO EVOLUÍDO
--
-- Liga o insumo às unidades de medida da M2 e separa duas coisas que hoje
-- moram na mesma coluna: o custo que a pessoa DIGITA no cadastro e o custo
-- que o sistema CALCULA a partir das compras.
--
-- Também acrescenta o que o razão da M4 vai precisar perguntar ao insumo:
-- é bruto ou manipulado, controla lote, quantos dias dura.
--
-- Aditiva. `custoMedio` e `unidadeMedida` continuam intactos e populados —
-- a interface atual os lê. Só somem na M9.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "TipoInsumo" AS ENUM ('BRUTO', 'MANIPULADO');

-- ---------------------------------------------------------------------------
-- 1. COLUNAS NOVAS
--
-- `unidadeEstoqueId` nasce NULA de propósito. O Prisma geraria
-- `ADD COLUMN ... TEXT NOT NULL` direto, o que o Postgres recusa em tabela
-- com linhas dentro: não há valor para as que já existem.
--
-- O caminho é sempre este: nasce nula → recebe o backfill → vira obrigatória.
-- ---------------------------------------------------------------------------
ALTER TABLE "insumo"
  ADD COLUMN "tipo"             "TipoInsumo"  NOT NULL DEFAULT 'BRUTO',
  ADD COLUMN "unidadeEstoqueId" TEXT,
  ADD COLUMN "unidadeCompraId"  TEXT,
  ADD COLUMN "custoReferencia"  DECIMAL(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN "controlaLote"     BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN "validadeDias"     INTEGER;

-- ---------------------------------------------------------------------------
-- 2. GARANTE AS UNIDADES ANTES DE APONTAR PARA ELAS
--
-- A M2 semeou as organizações que existiam NAQUELE momento. Qualquer rede
-- criada entre a M2 e a M3 não tem unidade nenhuma — e o backfill logo abaixo
-- deixaria os insumos dela sem para onde apontar.
--
-- Repetir o seed aqui é o que torna esta migration independente de quando
-- cada organização nasceu. É idempotente: o `WHERE NOT EXISTS` não duplica
-- nada de quem já foi semeado pela M2.
-- ---------------------------------------------------------------------------
INSERT INTO "unidade_medida"
  ("id", "organizacaoId", "codigo", "nome", "grandeza", "fatorParaBase", "ehBase", "criadoEm", "atualizadoEm")
SELECT
  gen_random_uuid()::text,
  o."id",
  padrao."codigo",
  padrao."nome",
  padrao."grandeza"::"GrandezaMedida",
  padrao."fator"::DECIMAL(18,8),
  padrao."ehBase",
  now(),
  now()
FROM "organizacao" o
CROSS JOIN (VALUES
  ('kg', 'Quilograma', 'MASSA',    1,     true),
  ('g',  'Grama',      'MASSA',    0.001, false),
  ('L',  'Litro',      'VOLUME',   1,     true),
  ('ml', 'Mililitro',  'VOLUME',   0.001, false),
  ('un', 'Unidade',    'CONTAGEM', 1,     true)
) AS padrao("codigo", "nome", "grandeza", "fator", "ehBase")
WHERE NOT EXISTS (
  SELECT 1 FROM "unidade_medida" existente
  WHERE existente."organizacaoId" = o."id"
    AND existente."codigo" = padrao."codigo"
    AND existente."excluidoEm" IS NULL
);

-- ---------------------------------------------------------------------------
-- 3. BACKFILL · o enum vira ponteiro para a tabela
--
-- Cada insumo aponta para a linha de `unidade_medida` com o código
-- equivalente ao que o enum guardava, dentro da MESMA organização.
-- ---------------------------------------------------------------------------
UPDATE "insumo" i
SET "unidadeEstoqueId" = um."id"
FROM "unidade_medida" um
WHERE um."organizacaoId" = i."organizacaoId"
  AND um."excluidoEm" IS NULL
  AND um."codigo" = CASE i."unidadeMedida"
        WHEN 'KG' THEN 'kg'
        WHEN 'G'  THEN 'g'
        WHEN 'L'  THEN 'L'
        WHEN 'ML' THEN 'ml'
        WHEN 'UN' THEN 'un'
      END
  AND i."unidadeEstoqueId" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. BACKFILL · o custo digitado vira custo de referência
--
-- `custoMedio` nunca foi calculado por nada: é o número que a pessoa digitou
-- no formulário. O nome mentia sobre o que a coluna era. `custoReferencia`
-- diz a verdade, e a partir da M4 o custo médio de verdade passa a ser
-- calculado em `saldo_estoque`, por loja.
--
-- A escala vai de (14,4) para (18,8) — alargamento, sem perda.
-- ---------------------------------------------------------------------------
UPDATE "insumo" SET "custoReferencia" = "custoMedio" WHERE "custoMedio" <> 0;

-- ---------------------------------------------------------------------------
-- 5. VERIFICAÇÃO DO BACKFILL
--
-- Se sobrou insumo sem unidade, a organização dele não tem as unidades
-- semeadas — e o SET NOT NULL abaixo falharia com uma mensagem que não
-- explica nada. Aqui a migration para e diz onde olhar.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sem_unidade INT;
BEGIN
  SELECT COUNT(*) INTO sem_unidade FROM "insumo" WHERE "unidadeEstoqueId" IS NULL;

  IF sem_unidade > 0 THEN
    RAISE EXCEPTION
      'M3 abortada: % insumo(s) ficaram sem unidade de estoque. Provável causa: a organização deles não recebeu o seed da M2. Verifique com: SELECT DISTINCT i."organizacaoId" FROM "insumo" i WHERE i."unidadeEstoqueId" IS NULL;',
      sem_unidade;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. AGORA SIM, OBRIGATÓRIA
--
-- Insumo sem unidade de estoque é insumo cujo saldo não pode ser somado. O
-- razão da M4 depende desta coluna em toda linha que gravar.
-- ---------------------------------------------------------------------------
ALTER TABLE "insumo" ALTER COLUMN "unidadeEstoqueId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "insumo" ADD CONSTRAINT "insumo_organizacaoId_unidadeEstoqueId_fkey" FOREIGN KEY ("organizacaoId", "unidadeEstoqueId") REFERENCES "unidade_medida"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumo" ADD CONSTRAINT "insumo_organizacaoId_unidadeCompraId_fkey" FOREIGN KEY ("organizacaoId", "unidadeCompraId") REFERENCES "unidade_medida"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 7. A EXCEÇÃO POR LOJA
--
-- `insumo` é da rede. O que varia legitimamente por unidade — trabalha ou não
-- com o item, ponto de reposição próprio — mora aqui. Sem esta tabela, a
-- saída seria duplicar o cadastro por loja, e o mesmo insumo passaria a ter
-- dois nomes e dois custos que ninguém consolida depois.
-- ---------------------------------------------------------------------------
CREATE TABLE "insumo_por_unidade" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "estoqueMinimo" DECIMAL(14,4),
    "estoqueMaximo" DECIMAL(14,4),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,
    "atualizadoPorId" TEXT,

    CONSTRAINT "insumo_por_unidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insumo_por_unidade_organizacaoId_unidadeId_idx" ON "insumo_por_unidade"("organizacaoId", "unidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "insumo_por_unidade_organizacaoId_unidadeId_insumoId_key" ON "insumo_por_unidade"("organizacaoId", "unidadeId", "insumoId");

-- AddForeignKey
ALTER TABLE "insumo_por_unidade" ADD CONSTRAINT "insumo_por_unidade_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumo_por_unidade" ADD CONSTRAINT "insumo_por_unidade_organizacaoId_insumoId_fkey" FOREIGN KEY ("organizacaoId", "insumoId") REFERENCES "insumo"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECKs (invisíveis ao Prisma — ver `prisma/schema/README.md`)
-- ---------------------------------------------------------------------------
ALTER TABLE "insumo"
  ADD CONSTRAINT "insumo_custo_nao_negativo" CHECK ("custoReferencia" >= 0);

ALTER TABLE "insumo"
  ADD CONSTRAINT "insumo_estoque_minimo_nao_negativo" CHECK ("estoqueMinimo" >= 0);

-- Validade de zero dia não é "não perece" — é erro de digitação. Quem não
-- perece deixa a coluna nula.
ALTER TABLE "insumo"
  ADD CONSTRAINT "insumo_validade_positiva"
  CHECK ("validadeDias" IS NULL OR "validadeDias" > 0);

ALTER TABLE "insumo_por_unidade"
  ADD CONSTRAINT "insumo_por_unidade_limites_coerentes"
  CHECK (
    "estoqueMinimo" IS NULL OR "estoqueMaximo" IS NULL
    OR "estoqueMaximo" >= "estoqueMinimo"
  );
