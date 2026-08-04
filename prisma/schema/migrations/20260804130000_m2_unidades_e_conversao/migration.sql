-- ===========================================================================
-- M2 · UNIDADES DE MEDIDA E CONVERSÃO
--
-- O primeiro dos três níveis de estoque exige responder "quanto é isto em
-- quilos?" para qualquer coisa que entre. Compra-se em saco, guarda-se em kg,
-- usa-se em grama na ficha técnica — e as três coisas precisam fechar.
--
-- Duas tabelas, uma pergunta cada:
--   `unidade_medida`    → quanto vale 1 grama em quilos?   (aritmética)
--   `conversao_unidade` → quanto pesa 1 saco DISTO?        (depende do insumo)
--
-- Aditiva. Não toca em `insumo` — a ligação entre as duas coisas é a M3.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "GrandezaMedida" AS ENUM ('MASSA', 'VOLUME', 'CONTAGEM');

-- CreateTable
CREATE TABLE "unidade_medida" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "grandeza" "GrandezaMedida" NOT NULL,
    "fatorParaBase" DECIMAL(18,8) NOT NULL,
    "ehBase" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "atualizadoPorId" TEXT,

    CONSTRAINT "unidade_medida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversao_unidade" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "unidadeOrigemId" TEXT NOT NULL,
    "unidadeDestinoId" TEXT NOT NULL,
    "fator" DECIMAL(18,8) NOT NULL,
    "vigenteDe" TIMESTAMP(3) NOT NULL,
    "vigenteAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT,

    CONSTRAINT "conversao_unidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unidade_medida_organizacaoId_grandeza_idx" ON "unidade_medida"("organizacaoId", "grandeza");

-- CreateIndex
CREATE UNIQUE INDEX "unidade_medida_organizacaoId_id_key" ON "unidade_medida"("organizacaoId", "id");

-- CreateIndex
CREATE INDEX "conversao_unidade_organizacaoId_insumoId_vigenteDe_idx" ON "conversao_unidade"("organizacaoId", "insumoId", "vigenteDe");

-- AddForeignKey
ALTER TABLE "unidade_medida" ADD CONSTRAINT "unidade_medida_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversao_unidade" ADD CONSTRAINT "conversao_unidade_organizacaoId_insumoId_fkey" FOREIGN KEY ("organizacaoId", "insumoId") REFERENCES "insumo"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversao_unidade" ADD CONSTRAINT "conversao_unidade_organizacaoId_unidadeOrigemId_fkey" FOREIGN KEY ("organizacaoId", "unidadeOrigemId") REFERENCES "unidade_medida"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversao_unidade" ADD CONSTRAINT "conversao_unidade_organizacaoId_unidadeDestinoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeDestinoId") REFERENCES "unidade_medida"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- DAQUI PRA BAIXO, O QUE O PRISMA NÃO ENXERGA
--
-- Índices parciais e CHECKs não cabem no schema do Prisma. `prisma migrate dev`
-- vai propor derrubá-los a cada rodada. Estão registrados em
-- `prisma/schema/README.md`. Nunca aceite.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Código único só entre as unidades vivas.
--
-- Mesmo motivo do nome do insumo na M1: com `@@unique` comum, excluir a
-- unidade "cx" queimaria o código para sempre.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "unidade_medida_codigo_ativo_uk"
  ON "unidade_medida"("organizacaoId", "codigo")
  WHERE "excluidoEm" IS NULL;

-- ---------------------------------------------------------------------------
-- Exatamente UMA unidade base por grandeza.
--
-- Duas bases para MASSA significaria que 1 kg vale 1 e 1 g também vale 1 —
-- todo custo calculado depois disso sairia errado por um fator de mil, em
-- silêncio. É o tipo de erro que só aparece no fechamento do mês.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "unidade_medida_base_unica_uk"
  ON "unidade_medida"("organizacaoId", "grandeza")
  WHERE "ehBase" = true AND "excluidoEm" IS NULL;

-- ---------------------------------------------------------------------------
-- Uma conversão vigente por (insumo, origem, destino).
--
-- Duas vigentes ao mesmo tempo tornariam o resultado dependente da ordem em
-- que o banco devolvesse as linhas.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "conversao_unidade_vigente_uk"
  ON "conversao_unidade"("organizacaoId", "insumoId", "unidadeOrigemId", "unidadeDestinoId")
  WHERE "vigenteAte" IS NULL;

-- ---------------------------------------------------------------------------
-- CHECKs
--
-- Fator zero ou negativo não é conversão — é divisão por zero esperando
-- acontecer, três tabelas adiante, dentro de um cálculo de custo.
-- ---------------------------------------------------------------------------
ALTER TABLE "unidade_medida"
  ADD CONSTRAINT "unidade_medida_fator_positivo" CHECK ("fatorParaBase" > 0);

ALTER TABLE "unidade_medida"
  ADD CONSTRAINT "unidade_medida_base_fator_um"
  CHECK ("ehBase" = false OR "fatorParaBase" = 1);

ALTER TABLE "conversao_unidade"
  ADD CONSTRAINT "conversao_unidade_fator_positivo" CHECK ("fator" > 0);

-- Converter kg em kg é ruído que só serve para criar ambiguidade na busca.
ALTER TABLE "conversao_unidade"
  ADD CONSTRAINT "conversao_unidade_origem_diferente"
  CHECK ("unidadeOrigemId" <> "unidadeDestinoId");

ALTER TABLE "conversao_unidade"
  ADD CONSTRAINT "conversao_unidade_vigencia_coerente"
  CHECK ("vigenteAte" IS NULL OR "vigenteAte" > "vigenteDe");

-- ===========================================================================
-- SEED — as unidades que toda cozinha usa
--
-- Semeadas para as organizações que JÁ existem. Organização criada daqui pra
-- frente recebe as suas pela aplicação, no mesmo passo que a cria.
--
-- Sobre o `id`: estas linhas nascem com UUID, não com o `cuid()` que a
-- aplicação gera — não há gerador de cuid dentro do Postgres. As duas formas
-- atendem o que importa (`src/server/README.md:20-22`): identificador não
-- sequencial, que ninguém adivinha incrementando o anterior.
--
-- Idempotente: o `WHERE NOT EXISTS` deixa rodar de novo sem duplicar.
-- ===========================================================================
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
