-- ===========================================================================
-- M4 · O RAZÃO DE ESTOQUE
--
-- A fundação. Tudo que mexe em estoque passa a virar uma linha em
-- `movimento_estoque`: entrada por nota, consumo por Ordem de Produção,
-- produção de pré-preparo, baixa por venda, transferência, perda e ajuste de
-- inventário. Saldo é DERIVADO daqui, nunca o contrário.
--
-- Três tabelas e quatro garantias que não são de aplicação, são de banco:
--
--   1. O razão é IMUTÁVEL. Trigger recusa UPDATE e DELETE.
--   2. Sinal bate com o tipo. Entrada não entra negativa.
--   3. Estorno é espelho exato do original — mesma quantidade, mesmo custo,
--      sinal invertido — e cada movimento só pode ser estornado uma vez.
--   4. `custoTotal` é preenchido por trigger, nunca pela aplicação.
--
-- ⚠️ SEM RLS AQUI, e isso corrige o plano original.
--    Habilitar RLS antes de a aplicação saber declarar em qual organização
--    está faria toda consulta voltar vazia. As policies entram na M8, junto
--    com a extensão do Prisma Client que define `app.organizacao_id` e com a
--    troca do usuário do banco. Até lá o isolamento é o mesmo de hoje: escopo
--    na consulta e chave estrangeira composta.
--
-- Aditiva. Não altera nenhuma tabela existente.
-- ===========================================================================


-- CreateEnum
CREATE TYPE "TipoMovimento" AS ENUM ('ENTRADA_COMPRA', 'ENTRADA_TRANSFERENCIA', 'ENTRADA_PRODUCAO', 'ENTRADA_DEVOLUCAO', 'ENTRADA_AJUSTE', 'SAIDA_VENDA', 'SAIDA_PRODUCAO', 'SAIDA_TRANSFERENCIA', 'SAIDA_PERDA', 'SAIDA_CONSUMO_INTERNO', 'SAIDA_AJUSTE');

-- CreateEnum
CREATE TYPE "OrigemMovimento" AS ENUM ('COMPRA_NOTA_FISCAL', 'ORDEM_PRODUCAO', 'PEDIDO_VENDA', 'TRANSFERENCIA', 'INVENTARIO', 'AJUSTE_MANUAL', 'IFOOD_PEDIDO', 'PDV_VENDA', 'FISCAL_NFE_SAIDA');

-- CreateEnum
CREATE TYPE "StatusLote" AS ENUM ('ATIVO', 'ESGOTADO', 'VENCIDO', 'DESCARTADO');

-- CreateTable
CREATE TABLE "movimento_estoque" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "loteId" TEXT,
    "tipo" "TipoMovimento" NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidadeMedidaId" TEXT NOT NULL,
    "quantidadeBase" DECIMAL(14,4) NOT NULL,
    "custoUnitario" DECIMAL(18,8) NOT NULL,
    "custoTotal" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "origemTipo" "OrigemMovimento" NOT NULL,
    "origemId" TEXT,
    "estornaMovimentoId" TEXT,
    "chaveIdempotencia" TEXT NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT,
    "observacao" TEXT,

    CONSTRAINT "movimento_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saldo_estoque" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "custoMedio" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "ultimoMovimentoId" TEXT,
    "ultimoMovimentoEm" TIMESTAMP(3),
    "reconciliadoEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saldo_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lote" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "produzidoEm" TIMESTAMP(3),
    "validadeEm" TIMESTAMP(3),
    "responsavelId" TEXT,
    "ordemProducaoId" TEXT,
    "quantidadeInicial" DECIMAL(14,4) NOT NULL,
    "quantidadeAtual" DECIMAL(14,4) NOT NULL,
    "status" "StatusLote" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "lote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimento_estoque_organizacaoId_unidadeId_insumoId_ocorrido_idx" ON "movimento_estoque"("organizacaoId", "unidadeId", "insumoId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "movimento_estoque_organizacaoId_unidadeId_ocorridoEm_idx" ON "movimento_estoque"("organizacaoId", "unidadeId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "movimento_estoque_organizacaoId_origemTipo_origemId_idx" ON "movimento_estoque"("organizacaoId", "origemTipo", "origemId");

-- CreateIndex
CREATE INDEX "movimento_estoque_organizacaoId_loteId_idx" ON "movimento_estoque"("organizacaoId", "loteId");

-- CreateIndex
CREATE UNIQUE INDEX "movimento_estoque_organizacaoId_chaveIdempotencia_key" ON "movimento_estoque"("organizacaoId", "chaveIdempotencia");

-- CreateIndex
CREATE INDEX "saldo_estoque_organizacaoId_unidadeId_idx" ON "saldo_estoque"("organizacaoId", "unidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "saldo_estoque_organizacaoId_unidadeId_insumoId_key" ON "saldo_estoque"("organizacaoId", "unidadeId", "insumoId");

-- CreateIndex
CREATE INDEX "lote_organizacaoId_unidadeId_validadeEm_idx" ON "lote"("organizacaoId", "unidadeId", "validadeEm");

-- CreateIndex
CREATE UNIQUE INDEX "lote_organizacaoId_id_key" ON "lote"("organizacaoId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lote_organizacaoId_unidadeId_insumoId_codigo_key" ON "lote"("organizacaoId", "unidadeId", "insumoId", "codigo");

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_organizacaoId_insumoId_fkey" FOREIGN KEY ("organizacaoId", "insumoId") REFERENCES "insumo"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_organizacaoId_loteId_fkey" FOREIGN KEY ("organizacaoId", "loteId") REFERENCES "lote"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_organizacaoId_unidadeMedidaId_fkey" FOREIGN KEY ("organizacaoId", "unidadeMedidaId") REFERENCES "unidade_medida"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_estornaMovimentoId_fkey" FOREIGN KEY ("estornaMovimentoId") REFERENCES "movimento_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_organizacaoId_insumoId_fkey" FOREIGN KEY ("organizacaoId", "insumoId") REFERENCES "insumo"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote" ADD CONSTRAINT "lote_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote" ADD CONSTRAINT "lote_organizacaoId_insumoId_fkey" FOREIGN KEY ("organizacaoId", "insumoId") REFERENCES "insumo"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote" ADD CONSTRAINT "lote_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- DAQUI PRA BAIXO, O QUE O PRISMA NÃO ENXERGA
-- Registrado em `prisma/schema/README.md`. `migrate dev` vai propor derrubar.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- CHECKs DO RAZÃO
-- ---------------------------------------------------------------------------

-- Movimento de quantidade zero não é movimento — é linha de ruído que some
-- na soma e atrapalha em toda auditoria de extrato.
ALTER TABLE "movimento_estoque"
  ADD CONSTRAINT "movimento_estoque_quantidade_nao_zero"
  CHECK ("quantidade" <> 0 AND "quantidadeBase" <> 0);

-- A quantidade lançada e a convertida precisam apontar para o mesmo lado.
-- Sinais opostos significam erro na conversão, e o saldo sairia invertido.
ALTER TABLE "movimento_estoque"
  ADD CONSTRAINT "movimento_estoque_sinais_coerentes"
  CHECK (sign("quantidade") = sign("quantidadeBase"));

-- O sinal precisa bater com o tipo. É por isto que os valores do enum têm
-- prefixo: `ENTRADA%` entra positivo, `SAIDA%` sai negativo.
--
-- Estorno inverte a regra: ele desfaz, então uma entrada estornada é negativa.
-- Repare que o estorno mantém o TIPO do original em vez de ter um tipo
-- próprio. É o que faz `SUM(quantidadeBase) WHERE tipo='ENTRADA_COMPRA'` já
-- vir líquido de devoluções, sem ninguém precisar lembrar de descontar.
ALTER TABLE "movimento_estoque"
  ADD CONSTRAINT "movimento_estoque_sinal_do_tipo"
  CHECK (
    CASE WHEN "estornaMovimentoId" IS NULL
      THEN (("tipo"::text LIKE 'ENTRADA%' AND "quantidadeBase" > 0)
         OR ("tipo"::text LIKE 'SAIDA%'   AND "quantidadeBase" < 0))
      ELSE (("tipo"::text LIKE 'ENTRADA%' AND "quantidadeBase" < 0)
         OR ("tipo"::text LIKE 'SAIDA%'   AND "quantidadeBase" > 0))
    END
  );

ALTER TABLE "movimento_estoque"
  ADD CONSTRAINT "movimento_estoque_custo_nao_negativo"
  CHECK ("custoUnitario" >= 0);

-- Cada movimento é estornado no máximo uma vez. Sem isto, dois estornos do
-- mesmo lançamento zeram o saldo e ainda tiram mais.
CREATE UNIQUE INDEX "movimento_estoque_estorno_unico_uk"
  ON "movimento_estoque"("estornaMovimentoId")
  WHERE "estornaMovimentoId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- CHECKs DO LOTE
-- ---------------------------------------------------------------------------
ALTER TABLE "lote"
  ADD CONSTRAINT "lote_quantidade_inicial_positiva"
  CHECK ("quantidadeInicial" > 0);

ALTER TABLE "lote"
  ADD CONSTRAINT "lote_validade_depois_da_producao"
  CHECK ("validadeEm" IS NULL OR "produzidoEm" IS NULL OR "validadeEm" > "produzidoEm");

-- ---------------------------------------------------------------------------
-- O RAZÃO É IMUTÁVEL
--
-- A regra "movimento lançado nunca é editado nem apagado" só vale de verdade
-- se o banco recusar. Enquanto for convenção, alguém vai "só corrigir" um
-- lançamento numa madrugada de fechamento — e é exatamente aí que o histórico
-- deixa de bater e ninguém consegue mais reconstruir o que aconteceu.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "movimento_estoque_imutavel"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'movimento_estoque é append-only: % recusado no movimento %. Para corrigir, lance um ESTORNO apontando para ele em estornaMovimentoId.',
    TG_OP, OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "movimento_estoque_imutavel"
  BEFORE UPDATE OR DELETE ON "movimento_estoque"
  FOR EACH ROW EXECUTE FUNCTION "movimento_estoque_imutavel"();

-- ---------------------------------------------------------------------------
-- O QUE ACONTECE ANTES DE CADA INSERÇÃO
--
-- Duas coisas que a aplicação não deve poder errar:
--
-- 1. `custoTotal` é DERIVADO. Deixá-lo por conta de quem chama cria o estado
--    em que quantidade, custo unitário e total discordam entre si — e é o
--    total que vai para o CMV.
--
-- 2. Estorno é ESPELHO EXATO: mesma organização, loja, insumo e tipo; mesma
--    quantidade com sinal invertido; mesmo custo unitário. Estorno parcial
--    não existe de propósito — "entraram 8, não 10" se resolve estornando os
--    10 e lançando os 8, o que deixa a correção legível no extrato em vez de
--    escondida num delta.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "movimento_estoque_antes_de_inserir"() RETURNS trigger AS $$
DECLARE
  original "movimento_estoque"%ROWTYPE;
BEGIN
  NEW."custoTotal" := ROUND(NEW."quantidadeBase" * NEW."custoUnitario", 4);

  IF NEW."estornaMovimentoId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original FROM "movimento_estoque" WHERE "id" = NEW."estornaMovimentoId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estorno aponta para um movimento que não existe (%).', NEW."estornaMovimentoId";
  END IF;

  IF original."estornaMovimentoId" IS NOT NULL THEN
    RAISE EXCEPTION
      'O movimento % já é um estorno. Estornar um estorno recriaria o lançamento original por um caminho que o extrato não explica — lance um movimento novo.',
      original."id";
  END IF;

  IF original."organizacaoId" <> NEW."organizacaoId"
     OR original."unidadeId" <> NEW."unidadeId"
     OR original."insumoId" <> NEW."insumoId" THEN
    RAISE EXCEPTION 'Estorno precisa ser da mesma organização, loja e insumo do movimento original.';
  END IF;

  IF original."tipo" <> NEW."tipo" THEN
    RAISE EXCEPTION 'Estorno precisa repetir o tipo do original (%), só com o sinal invertido.', original."tipo";
  END IF;

  IF NEW."quantidadeBase" <> -original."quantidadeBase" THEN
    RAISE EXCEPTION
      'Estorno é total, não parcial: esperado %, veio %. Para acertar quantidade, estorne tudo e lance o valor certo.',
      -original."quantidadeBase", NEW."quantidadeBase";
  END IF;

  IF NEW."custoUnitario" <> original."custoUnitario" THEN
    RAISE EXCEPTION
      'Estorno precisa usar o custo unitário do original (%), senão o valor do estoque não volta ao que era.',
      original."custoUnitario";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "movimento_estoque_antes_de_inserir"
  BEFORE INSERT ON "movimento_estoque"
  FOR EACH ROW EXECUTE FUNCTION "movimento_estoque_antes_de_inserir"();

-- ---------------------------------------------------------------------------
-- A CONFERÊNCIA DO CACHE
--
-- `saldo_estoque` é cache. Esta visão é como se descobre que ele mentiu:
-- devolve só as linhas em que o cache discorda da soma do razão. Vazia é o
-- estado saudável.
--
-- O job de reconciliação consulta isto. Quando houver divergência, o razão
-- está certo — o cache é que se refaz.
-- ---------------------------------------------------------------------------
CREATE VIEW "saldo_divergente" AS
SELECT
  s."organizacaoId",
  s."unidadeId",
  s."insumoId",
  s."quantidade"                        AS "saldoCache",
  COALESCE(r."total", 0)                AS "saldoRazao",
  s."quantidade" - COALESCE(r."total", 0) AS "diferenca"
FROM "saldo_estoque" s
LEFT JOIN (
  SELECT "organizacaoId", "unidadeId", "insumoId", SUM("quantidadeBase") AS "total"
  FROM "movimento_estoque"
  GROUP BY "organizacaoId", "unidadeId", "insumoId"
) r
  ON  r."organizacaoId" = s."organizacaoId"
  AND r."unidadeId"     = s."unidadeId"
  AND r."insumoId"      = s."insumoId"
WHERE s."quantidade" <> COALESCE(r."total", 0);
