-- DropIndex
DROP INDEX "conta_financeira_unidadeId_nome_key";

-- AlterTable
ALTER TABLE "conta_financeira" ADD COLUMN     "agencia" TEXT,
ADD COLUMN     "banco" TEXT,
ADD COLUMN     "compensacao" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cor" TEXT NOT NULL DEFAULT '#0066cc',
ADD COLUMN     "corteAplicado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "empresaId" TEXT,
ADD COLUMN     "identidade" TEXT,
ADD COLUMN     "modalidade" TEXT,
ADD COLUMN     "nomeTitular" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "saldoInicialCentavos" BIGINT,
ADD COLUMN     "titularidade" TEXT,
ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "empresa_financeira" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "emiteNota" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencia_financeira" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "origemId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "valorCentavos" BIGINT NOT NULL,
    "data" DATE NOT NULL,
    "descricao" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chave" TEXT NOT NULL,
    "assinatura" TEXT NOT NULL,
    "estornoDeId" TEXT,

    CONSTRAINT "transferencia_financeira_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresa_financeira_unidadeId_id_key" ON "empresa_financeira"("unidadeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_financeira_unidadeId_cnpj_key" ON "empresa_financeira"("unidadeId", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_financeira_estornoDeId_key" ON "transferencia_financeira"("estornoDeId");

-- CreateIndex
CREATE INDEX "transferencia_financeira_unidadeId_origemId_data_idx" ON "transferencia_financeira"("unidadeId", "origemId", "data");

-- CreateIndex
CREATE INDEX "transferencia_financeira_unidadeId_destinoId_data_idx" ON "transferencia_financeira"("unidadeId", "destinoId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_financeira_unidadeId_chave_key" ON "transferencia_financeira"("unidadeId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "conta_financeira_unidadeId_id_key" ON "conta_financeira"("unidadeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conta_financeira_unidadeId_empresaId_id_key" ON "conta_financeira"("unidadeId", "empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conta_financeira_unidadeId_empresaId_nome_key" ON "conta_financeira"("unidadeId", "empresaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "conta_financeira_unidadeId_identidade_key" ON "conta_financeira"("unidadeId", "identidade");

-- AddForeignKey
ALTER TABLE "conta_financeira" ADD CONSTRAINT "conta_financeira_unidadeId_empresaId_fkey" FOREIGN KEY ("unidadeId", "empresaId") REFERENCES "empresa_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_financeira" ADD CONSTRAINT "transferencia_financeira_unidadeId_empresaId_fkey" FOREIGN KEY ("unidadeId", "empresaId") REFERENCES "empresa_financeira"("unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_financeira" ADD CONSTRAINT "transferencia_financeira_unidadeId_empresaId_origemId_fkey" FOREIGN KEY ("unidadeId", "empresaId", "origemId") REFERENCES "conta_financeira"("unidadeId", "empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_financeira" ADD CONSTRAINT "transferencia_financeira_unidadeId_empresaId_destinoId_fkey" FOREIGN KEY ("unidadeId", "empresaId", "destinoId") REFERENCES "conta_financeira"("unidadeId", "empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_financeira" ADD CONSTRAINT "transferencia_financeira_estornoDeId_fkey" FOREIGN KEY ("estornoDeId") REFERENCES "transferencia_financeira"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Compatibilidade: dados antigos não são reescritos nem atribuídos a um CNPJ.
ALTER TABLE "categoria_financeira" ADD COLUMN "entraDre" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "conta_financeira" ADD CONSTRAINT "conta_saldo_centavos_consistente"
  CHECK (("saldoInicialCentavos" IS NULL OR "saldoInicialCentavos" = "saldoInicial" * 100)
    AND (NOT "corteAplicado" OR "saldoInicialCentavos" IS NOT NULL));
ALTER TABLE "conta_financeira" ADD CONSTRAINT "conta_dados_bancarios_validos"
  CHECK (("titularidade" IS NULL OR "titularidade" IN ('PF','PJ'))
    AND ("modalidade" IS NULL OR "modalidade" IN ('CORRENTE','POUPANCA','DINHEIRO','APLICACAO','OUTRO'))
    AND (NOT "compensacao" OR ("titularidade" IS NOT NULL AND "modalidade" IS NOT NULL
      AND "titularidade" = 'PJ' AND "modalidade" = 'OUTRO'
      AND "empresaId" IS NOT NULL AND COALESCE("agencia",'') = '' AND COALESCE("numero",'') = ''
      AND "saldoInicialCentavos" IS NOT NULL AND "saldoInicialCentavos" = 0)));
CREATE UNIQUE INDEX "conta_nome_legado_unico" ON "conta_financeira" ("unidadeId","nome") WHERE "empresaId" IS NULL;
CREATE UNIQUE INDEX "empresa_emissora_unica" ON "empresa_financeira" ("unidadeId") WHERE "emiteNota";
ALTER TABLE "empresa_financeira" ADD CONSTRAINT "empresa_pertence_unidade"
  FOREIGN KEY ("organizacaoId","unidadeId") REFERENCES "unidade" ("organizacaoId","id") ON DELETE RESTRICT;
ALTER TABLE "transferencia_financeira" ADD CONSTRAINT "transferencia_criador"
  FOREIGN KEY ("criadoPorId") REFERENCES "usuario" ("id") ON DELETE RESTRICT;
ALTER TABLE "transferencia_financeira" ADD CONSTRAINT "transferencia_valida"
  CHECK ("valorCentavos" > 0 AND "valorCentavos" <= 99999999999999 AND "origemId" <> "destinoId");

-- As identidades e aberturas movimentadas são protegidas mesmo fora da aplicação.
CREATE FUNCTION proteger_abertura_bancaria() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "lancamento" WHERE "contaId" = OLD.id)
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
CREATE TRIGGER conta_proteger_abertura BEFORE UPDATE ON "conta_financeira"
  FOR EACH ROW EXECUTE FUNCTION proteger_abertura_bancaria();

CREATE FUNCTION validar_transferencia_bancaria() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "transferencia_financeira"%ROWTYPE; abertura date; disponivel boolean;
BEGIN
  -- Mesma ordem em ambas as pernas, evitando bloqueio circular.
  PERFORM id FROM "conta_financeira" WHERE id IN (NEW."origemId",NEW."destinoId") ORDER BY id FOR UPDATE;
  SELECT max((c."iniciadaEm" AT TIME ZONE 'UTC' AT TIME ZONE u."fusoHorario")::date),
    bool_and(c.ativa AND e.ativa)
    INTO abertura, disponivel
    FROM "conta_financeira" c
    JOIN "empresa_financeira" e ON e.id = c."empresaId" AND e."unidadeId" = c."unidadeId"
    JOIN "unidade" u ON u.id = c."unidadeId"
    WHERE c.id IN (NEW."origemId",NEW."destinoId");
  IF NEW.data < abertura THEN RAISE EXCEPTION 'Transferência anterior à abertura'; END IF;
  IF NEW."estornoDeId" IS NULL THEN
    IF NOT disponivel THEN RAISE EXCEPTION 'Contas e empresa precisam estar ativas'; END IF;
  ELSE
    SELECT * INTO original FROM "transferencia_financeira" WHERE id = NEW."estornoDeId";
    IF NOT FOUND OR original."estornoDeId" IS NOT NULL
       OR original."unidadeId" <> NEW."unidadeId" OR original."empresaId" <> NEW."empresaId"
       OR original."origemId" <> NEW."destinoId" OR original."destinoId" <> NEW."origemId"
       OR original."valorCentavos" <> NEW."valorCentavos" OR NEW.data < original.data THEN
      RAISE EXCEPTION 'Estorno inválido';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transferencia_validar BEFORE INSERT ON "transferencia_financeira"
  FOR EACH ROW EXECUTE FUNCTION validar_transferencia_bancaria();
CREATE FUNCTION manter_transferencia_bancaria() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Transferências são imutáveis; registre um estorno'; END $$;
CREATE TRIGGER transferencia_imutavel BEFORE UPDATE OR DELETE ON "transferencia_financeira"
  FOR EACH ROW EXECUTE FUNCTION manter_transferencia_bancaria();
