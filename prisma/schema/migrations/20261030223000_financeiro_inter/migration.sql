BEGIN;
-- AlterTable
ALTER TABLE "categoria_financeira" ADD COLUMN     "codigo" TEXT,
ADD COLUMN     "paiId" TEXT;

-- AlterTable
ALTER TABLE "lancamento" ADD COLUMN     "centroCustoId" TEXT,
ADD COLUMN     "competencia" DATE,
ADD COLUMN     "composeDre" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "empresaId" TEXT,
ADD COLUMN     "historico" TEXT,
ADD COLUMN     "juros" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "multa" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "numeroNotaFiscal" TEXT,
ADD COLUMN     "numeroPedido" TEXT,
ADD COLUMN     "pessoaId" TEXT,
ADD COLUMN     "restritoMaster" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipoPagamento" TEXT,
ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "pessoa_financeira" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipoDocumento" TEXT NOT NULL DEFAULT 'cnpj',
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "categoria" TEXT,
    "contato" TEXT,
    "endereco" TEXT,
    "cidade" TEXT,
    "categoriaId" TEXT,
    "operacaoPadrao" "DirecaoDoLancamento" NOT NULL DEFAULT 'PAGAR',
    "prazoDias" INTEGER NOT NULL DEFAULT 0,
    "chavePix" TEXT,
    "observacoes" TEXT,
    "ehFuncionario" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pessoa_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centro_custo_financeiro" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "centro_custo_financeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integracao_inter" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "envKey" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL DEFAULT 'sandbox',
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ultimaSincronizacao" TIMESTAMP(3),
    "ultimoErro" TEXT,

    CONSTRAINT "integracao_inter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baixa_financeira" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "lancamentoId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "dataPagamento" DATE NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "tipoPagamento" TEXT NOT NULL,
    "complemento" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'manual',
    "interTransacaoId" TEXT,
    "chave" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estornadoEm" TIMESTAMP(3),
    "estornadoPorId" TEXT,

    CONSTRAINT "baixa_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pendencia_inter" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "integracaoId" TEXT NOT NULL,
    "interTransacaoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "direcao" "DirecaoDoLancamento" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "tipoTransacao" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "contraparteNome" TEXT,
    "contraparteDocumento" TEXT,
    "candidatosIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "resolvidaEm" TIMESTAMP(3),
    "resolvidaPorId" TEXT,
    "baixaId" TEXT,

    CONSTRAINT "pendencia_inter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencia_interna" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "origemId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estornadoEm" TIMESTAMP(3),

    CONSTRAINT "transferencia_interna_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pessoa_financeira_organizacaoId_unidadeId_ativa_idx" ON "pessoa_financeira"("organizacaoId", "unidadeId", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "pessoa_financeira_organizacaoId_unidadeId_documento_key" ON "pessoa_financeira"("organizacaoId", "unidadeId", "documento");

-- CreateIndex
CREATE UNIQUE INDEX "pessoa_financeira_unidadeId_id_key" ON "pessoa_financeira"("unidadeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "centro_custo_financeiro_unidadeId_nome_key" ON "centro_custo_financeiro"("unidadeId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "centro_custo_financeiro_unidadeId_id_key" ON "centro_custo_financeiro"("unidadeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integracao_inter_envKey_key" ON "integracao_inter"("envKey");

-- CreateIndex
CREATE UNIQUE INDEX "integracao_inter_unidadeId_empresaId_key" ON "integracao_inter"("unidadeId", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "baixa_financeira_interTransacaoId_key" ON "baixa_financeira"("interTransacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "baixa_financeira_chave_key" ON "baixa_financeira"("chave");

-- CreateIndex
CREATE INDEX "baixa_financeira_unidadeId_lancamentoId_idx" ON "baixa_financeira"("unidadeId", "lancamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "pendencia_inter_interTransacaoId_key" ON "pendencia_inter"("interTransacaoId");

-- CreateIndex
CREATE INDEX "pendencia_inter_unidadeId_status_data_idx" ON "pendencia_inter"("unidadeId", "status", "data");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_interna_chave_key" ON "transferencia_interna"("chave");

-- CreateIndex
CREATE INDEX "transferencia_interna_unidadeId_data_idx" ON "transferencia_interna"("unidadeId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "lancamento_unidadeId_id_key" ON "lancamento"("unidadeId", "id");

-- AddForeignKey
ALTER TABLE "categoria_financeira" ADD CONSTRAINT "categoria_financeira_paiId_fkey" FOREIGN KEY ("paiId") REFERENCES "categoria_financeira"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_unidadeId_empresaId_fkey" FOREIGN KEY ("unidadeId", "empresaId") REFERENCES "empresa_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_unidadeId_pessoaId_fkey" FOREIGN KEY ("unidadeId", "pessoaId") REFERENCES "pessoa_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento" ADD CONSTRAINT "lancamento_unidadeId_centroCustoId_fkey" FOREIGN KEY ("unidadeId", "centroCustoId") REFERENCES "centro_custo_financeiro"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pessoa_financeira" ADD CONSTRAINT "pessoa_financeira_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categoria_financeira"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integracao_inter" ADD CONSTRAINT "integracao_inter_unidadeId_empresaId_fkey" FOREIGN KEY ("unidadeId", "empresaId") REFERENCES "empresa_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integracao_inter" ADD CONSTRAINT "integracao_inter_unidadeId_empresaId_contaId_fkey" FOREIGN KEY ("unidadeId", "empresaId", "contaId") REFERENCES "conta_financeira"("unidadeId", "empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baixa_financeira" ADD CONSTRAINT "baixa_financeira_unidadeId_lancamentoId_fkey" FOREIGN KEY ("unidadeId", "lancamentoId") REFERENCES "lancamento"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baixa_financeira" ADD CONSTRAINT "baixa_financeira_unidadeId_contaId_fkey" FOREIGN KEY ("unidadeId", "contaId") REFERENCES "conta_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencia_inter" ADD CONSTRAINT "pendencia_inter_integracaoId_fkey" FOREIGN KEY ("integracaoId") REFERENCES "integracao_inter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_interna" ADD CONSTRAINT "transferencia_interna_unidadeId_origemId_fkey" FOREIGN KEY ("unidadeId", "origemId") REFERENCES "conta_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_interna" ADD CONSTRAINT "transferencia_interna_unidadeId_destinoId_fkey" FOREIGN KEY ("unidadeId", "destinoId") REFERENCES "conta_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Compatibilidade com baixas históricas, sem perder valor/data/autoria.
UPDATE lancamento SET competencia = vencimento::date WHERE competencia IS NULL;
UPDATE lancamento l SET "empresaId" = c."empresaId" FROM conta_financeira c WHERE l."contaId" = c.id AND l."unidadeId" = c."unidadeId" AND l."empresaId" IS NULL;
INSERT INTO baixa_financeira (id, "organizacaoId", "unidadeId", "lancamentoId", "contaId", "dataPagamento", valor, "tipoPagamento", origem, chave, "criadoPorId", "criadoEm")
SELECT md5('baixa-legada:' || l.id), u."organizacaoId", l."unidadeId", l.id, l."contaId", l."quitadoEm"::date, l."valorQuitado", 'OUTRO', 'manual', 'legado:' || l.id, COALESCE(l."quitadoPorId", l."criadoPorId", 'migracao'), l."atualizadoEm"
FROM lancamento l JOIN unidade u ON u.id=l."unidadeId"
WHERE l.status='QUITADO' AND l."contaId" IS NOT NULL AND l."quitadoEm" IS NOT NULL AND l."valorQuitado" > 0;

ALTER TABLE "pessoa_financeira" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pessoa_financeira" FORCE ROW LEVEL SECURITY;
CREATE POLICY financeiro_escopo ON "pessoa_financeira" USING ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true)) WITH CHECK ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true));

ALTER TABLE "centro_custo_financeiro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "centro_custo_financeiro" FORCE ROW LEVEL SECURITY;
CREATE POLICY financeiro_escopo ON "centro_custo_financeiro" USING ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true)) WITH CHECK ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true));

ALTER TABLE "integracao_inter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integracao_inter" FORCE ROW LEVEL SECURITY;
CREATE POLICY financeiro_escopo ON "integracao_inter" USING ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true)) WITH CHECK ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true));

ALTER TABLE "baixa_financeira" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "baixa_financeira" FORCE ROW LEVEL SECURITY;
CREATE POLICY financeiro_escopo ON "baixa_financeira" USING ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true)) WITH CHECK ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true));

ALTER TABLE "pendencia_inter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pendencia_inter" FORCE ROW LEVEL SECURITY;
CREATE POLICY financeiro_escopo ON "pendencia_inter" USING ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true)) WITH CHECK ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true));

ALTER TABLE "transferencia_interna" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transferencia_interna" FORCE ROW LEVEL SECURITY;
CREATE POLICY financeiro_escopo ON "transferencia_interna" USING ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true)) WITH CHECK ("organizacaoId" = current_setting('tetteo.financeiro_organizacao', true) AND "unidadeId" = current_setting('tetteo.financeiro_unidade', true));

-- A proteção de abertura existente passa a considerar os novos movimentos.
CREATE OR REPLACE FUNCTION proteger_abertura_bancaria() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "lancamento" WHERE "contaId" = OLD.id)
     OR EXISTS (SELECT 1 FROM "baixa_financeira" WHERE "contaId" = OLD.id)
     OR EXISTS (SELECT 1 FROM "integracao_inter" WHERE "contaId" = OLD.id)
     OR EXISTS (SELECT 1 FROM "transferencia_interna" WHERE "origemId" = OLD.id OR "destinoId" = OLD.id)
     OR EXISTS (SELECT 1 FROM "transferencia_financeira" WHERE "origemId" = OLD.id OR "destinoId" = OLD.id) THEN
    IF (OLD."saldoInicialCentavos" IS NOT NULL AND NEW."saldoInicialCentavos" IS DISTINCT FROM OLD."saldoInicialCentavos")
       OR NEW."saldoInicial" <> OLD."saldoInicial"
       OR NEW."iniciadaEm" <> OLD."iniciadaEm" OR NEW."corteAplicado" <> OLD."corteAplicado"
       OR NEW.tipo <> OLD.tipo
       OR (OLD."empresaId" IS NOT NULL AND NEW."empresaId" IS DISTINCT FROM OLD."empresaId")
       OR (OLD."banco" IS NOT NULL AND NEW."banco" IS DISTINCT FROM OLD."banco")
       OR (OLD."agencia" IS NOT NULL AND NEW."agencia" IS DISTINCT FROM OLD."agencia")
       OR (OLD."numero" IS NOT NULL AND NEW."numero" IS DISTINCT FROM OLD."numero")
       OR (OLD."identidade" IS NOT NULL AND NEW."identidade" IS DISTINCT FROM OLD."identidade")
       OR (OLD."modalidade" IS NOT NULL AND NEW."modalidade" IS DISTINCT FROM OLD."modalidade")
       OR (OLD."titularidade" IS NOT NULL AND NEW."titularidade" IS DISTINCT FROM OLD."titularidade")
       OR (OLD."nomeTitular" IS NOT NULL AND NEW."nomeTitular" IS DISTINCT FROM OLD."nomeTitular")
       OR NEW."compensacao" <> OLD."compensacao" THEN
      RAISE EXCEPTION 'Dados de abertura de conta com movimentos são imutáveis';
    END IF;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE baixa_financeira ADD CONSTRAINT baixa_valor_positivo CHECK (valor > 0);
ALTER TABLE transferencia_interna ADD CONSTRAINT transferencia_interna_valida CHECK (valor > 0 AND "origemId" <> "destinoId");
COMMIT;
