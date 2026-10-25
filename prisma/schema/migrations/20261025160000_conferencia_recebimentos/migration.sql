-- CreateTable
CREATE TABLE "conferencia_importacao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "contaRef" TEXT NOT NULL,
    "arquivoHash" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "original" BYTEA NOT NULL,
    "parserVersao" TEXT NOT NULL,
    "configuracao" JSONB NOT NULL,
    "de" TEXT NOT NULL,
    "ate" TEXT NOT NULL,
    "lidas" INTEGER NOT NULL,
    "aceitas" INTEGER NOT NULL,
    "rejeitadas" INTEGER NOT NULL,
    "ignoradas" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'PREVIA',
    "motivoRevisao" TEXT,
    "enviadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmadoEm" TIMESTAMP(3),

    CONSTRAINT "conferencia_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_linha" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "importacaoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "fonte" TEXT NOT NULL,
    "contaRef" TEXT NOT NULL,
    "identidade" TEXT,
    "dia" TEXT,
    "bruto" JSONB NOT NULL,
    "normalizado" JSONB,
    "erros" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conferencia_linha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_contrato" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "estabelecimento" TEXT NOT NULL,
    "bandeira" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "parcelasDe" INTEGER NOT NULL,
    "parcelasAte" INTEGER NOT NULL,
    "de" TEXT NOT NULL,
    "ate" TEXT,
    "taxaBps" INTEGER NOT NULL,
    "fixaCentavos" INTEGER NOT NULL DEFAULT 0,
    "toleranciaCentavos" INTEGER NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conferencia_contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_execucao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "chavePedido" TEXT NOT NULL,
    "de" TEXT NOT NULL,
    "ate" TEXT NOT NULL,
    "periodoEfetivo" JSONB NOT NULL,
    "fontesVersao" JSONB NOT NULL,
    "regrasVersao" TEXT NOT NULL,
    "cobertura" JSONB NOT NULL,
    "totais" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'CONCLUIDA',
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conferencia_execucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_caso" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conferencia_caso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_correspondencia" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "execucaoId" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "dados" JSONB NOT NULL,

    CONSTRAINT "conferencia_correspondencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_lote" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "execucaoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "liquidoCentavos" INTEGER NOT NULL,
    "componentes" JSONB NOT NULL,

    CONSTRAINT "conferencia_lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_alocacao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "bancoId" TEXT NOT NULL,
    "centavos" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "aprovadoPorId" TEXT,

    CONSTRAINT "conferencia_alocacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_decisao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "decisao" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "evidenciaIds" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "anteriorId" TEXT,
    "autorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conferencia_decisao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_evidencia" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "hash" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conferencia_evidencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_evento" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conferencia_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conferencia_importacao_organizacaoId_unidadeId_fonte_de_ate_idx" ON "conferencia_importacao"("organizacaoId", "unidadeId", "fonte", "de", "ate");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_importacao_organizacaoId_unidadeId_fonte_contaR_key" ON "conferencia_importacao"("organizacaoId", "unidadeId", "fonte", "contaRef", "arquivoHash");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_importacao_organizacaoId_unidadeId_id_key" ON "conferencia_importacao"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE INDEX "conferencia_linha_organizacaoId_unidadeId_fonte_ativa_dia_idx" ON "conferencia_linha"("organizacaoId", "unidadeId", "fonte", "ativa", "dia");

-- CreateIndex
CREATE INDEX "conferencia_linha_organizacaoId_unidadeId_identidade_idx" ON "conferencia_linha"("organizacaoId", "unidadeId", "identidade");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_linha_importacaoId_numero_key" ON "conferencia_linha"("importacaoId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_linha_organizacaoId_unidadeId_id_key" ON "conferencia_linha"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE INDEX "conferencia_contrato_organizacaoId_unidadeId_provedor_estab_idx" ON "conferencia_contrato"("organizacaoId", "unidadeId", "provedor", "estabelecimento", "de");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_contrato_organizacaoId_unidadeId_id_key" ON "conferencia_contrato"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE INDEX "conferencia_execucao_organizacaoId_unidadeId_de_ate_criadoE_idx" ON "conferencia_execucao"("organizacaoId", "unidadeId", "de", "ate", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_execucao_organizacaoId_unidadeId_chavePedido_key" ON "conferencia_execucao"("organizacaoId", "unidadeId", "chavePedido");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_execucao_organizacaoId_unidadeId_id_key" ON "conferencia_execucao"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_caso_organizacaoId_unidadeId_chave_key" ON "conferencia_caso"("organizacaoId", "unidadeId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_caso_organizacaoId_unidadeId_id_key" ON "conferencia_caso"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE INDEX "conferencia_correspondencia_organizacaoId_unidadeId_execuca_idx" ON "conferencia_correspondencia"("organizacaoId", "unidadeId", "execucaoId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_correspondencia_execucaoId_casoId_key" ON "conferencia_correspondencia"("execucaoId", "casoId");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_correspondencia_organizacaoId_unidadeId_id_key" ON "conferencia_correspondencia"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_lote_execucaoId_chave_key" ON "conferencia_lote"("execucaoId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_lote_organizacaoId_unidadeId_id_key" ON "conferencia_lote"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE INDEX "conferencia_alocacao_organizacaoId_unidadeId_bancoId_idx" ON "conferencia_alocacao"("organizacaoId", "unidadeId", "bancoId");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_alocacao_loteId_bancoId_key" ON "conferencia_alocacao"("loteId", "bancoId");

-- CreateIndex
CREATE INDEX "conferencia_decisao_organizacaoId_unidadeId_casoId_criadoEm_idx" ON "conferencia_decisao"("organizacaoId", "unidadeId", "casoId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_decisao_casoId_versao_key" ON "conferencia_decisao"("casoId", "versao");

-- CreateIndex
CREATE INDEX "conferencia_evidencia_organizacaoId_unidadeId_casoId_idx" ON "conferencia_evidencia"("organizacaoId", "unidadeId", "casoId");

-- CreateIndex
CREATE INDEX "conferencia_evento_organizacaoId_unidadeId_entidadeId_criad_idx" ON "conferencia_evento"("organizacaoId", "unidadeId", "entidadeId", "criadoEm");

-- AddForeignKey
ALTER TABLE "conferencia_importacao" ADD CONSTRAINT "conferencia_importacao_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_linha" ADD CONSTRAINT "conferencia_linha_organizacaoId_unidadeId_importacaoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "importacaoId") REFERENCES "conferencia_importacao"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_contrato" ADD CONSTRAINT "conferencia_contrato_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_execucao" ADD CONSTRAINT "conferencia_execucao_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_caso" ADD CONSTRAINT "conferencia_caso_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_correspondencia" ADD CONSTRAINT "conferencia_correspondencia_organizacaoId_unidadeId_execuc_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "execucaoId") REFERENCES "conferencia_execucao"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_correspondencia" ADD CONSTRAINT "conferencia_correspondencia_organizacaoId_unidadeId_casoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "casoId") REFERENCES "conferencia_caso"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_lote" ADD CONSTRAINT "conferencia_lote_organizacaoId_unidadeId_execucaoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "execucaoId") REFERENCES "conferencia_execucao"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_alocacao" ADD CONSTRAINT "conferencia_alocacao_organizacaoId_unidadeId_loteId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "loteId") REFERENCES "conferencia_lote"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_alocacao" ADD CONSTRAINT "conferencia_alocacao_organizacaoId_unidadeId_bancoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "bancoId") REFERENCES "conferencia_linha"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_decisao" ADD CONSTRAINT "conferencia_decisao_organizacaoId_unidadeId_casoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "casoId") REFERENCES "conferencia_caso"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_evidencia" ADD CONSTRAINT "conferencia_evidencia_organizacaoId_unidadeId_casoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "casoId") REFERENCES "conferencia_caso"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_evento" ADD CONSTRAINT "conferencia_evento_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Uma identidade estável só pode participar uma vez da fonte ativa.
CREATE UNIQUE INDEX conferencia_linha_identidade_ativa ON conferencia_linha
  ("organizacaoId", "unidadeId", fonte, "contaRef", identidade)
  WHERE ativa AND identidade IS NOT NULL;

ALTER TABLE conferencia_importacao ADD CONSTRAINT conferencia_importacao_limites
  CHECK (octet_length(original) BETWEEN 1 AND 2097152 AND rejeitadas >= 0 AND aceitas >= 0 AND lidas >= aceitas + rejeitadas AND "de" <= ate);
ALTER TABLE conferencia_alocacao ADD CONSTRAINT conferencia_alocacao_positiva CHECK (centavos >= 0);
ALTER TABLE conferencia_contrato ADD CONSTRAINT conferencia_contrato_limites
  CHECK ("taxaBps" BETWEEN 0 AND 10000 AND "fixaCentavos" >= 0 AND "toleranciaCentavos" >= 0 AND "parcelasDe" BETWEEN 1 AND 48 AND "parcelasAte" BETWEEN "parcelasDe" AND 48);

-- Imutabilidade inclusive contra gravações acidentais fora dos serviços.
CREATE FUNCTION conferencia_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro de conferencia imutavel';
END $$;
DO $$
DECLARE tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['conferencia_decisao','conferencia_evidencia','conferencia_evento','conferencia_execucao','conferencia_correspondencia','conferencia_lote','conferencia_alocacao','conferencia_contrato'] LOOP
    EXECUTE format('CREATE TRIGGER imutavel BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION conferencia_imutavel()', tabela);
  END LOOP;
END $$;
CREATE FUNCTION conferencia_original_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Original nao pode ser apagado'; END IF;
  IF (to_jsonb(NEW) - ARRAY['estado','motivoRevisao','ignoradas','confirmadoEm']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['estado','motivoRevisao','ignoradas','confirmadoEm']) THEN
    RAISE EXCEPTION 'Original e leitura nao podem ser alterados';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER original_imutavel BEFORE UPDATE OR DELETE ON conferencia_importacao
  FOR EACH ROW EXECUTE FUNCTION conferencia_original_imutavel();
CREATE FUNCTION conferencia_linha_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Linha original nao pode ser apagada'; END IF;
  IF (to_jsonb(NEW) - 'ativa') IS DISTINCT FROM (to_jsonb(OLD) - 'ativa') THEN
    RAISE EXCEPTION 'Linha original e interpretacao nao podem ser alteradas';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER linha_imutavel BEFORE UPDATE OR DELETE ON conferencia_linha
  FOR EACH ROW EXECUTE FUNCTION conferencia_linha_imutavel();

-- O mesmo crédito pode aparecer em execuções históricas, mas a soma dentro
-- de UMA execução nunca supera o valor do crédito nem o líquido do lote.
CREATE FUNCTION conferencia_limitar_alocacao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE credito bigint; direcao text; origem text; execucao text; liquido bigint; usado bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."bancoId"));
  SELECT (normalizado->>'amountCents')::bigint, normalizado->>'direction', fonte
    INTO credito, direcao, origem FROM conferencia_linha WHERE id = NEW."bancoId";
  SELECT "execucaoId", "liquidoCentavos" INTO execucao, liquido FROM conferencia_lote WHERE id = NEW."loteId";
  IF origem IS DISTINCT FROM 'BANCO' OR direcao IS DISTINCT FROM 'CREDIT' OR credito IS NULL THEN
    RAISE EXCEPTION 'Alocacao exige credito bancario';
  END IF;
  SELECT COALESCE(sum(a.centavos),0) INTO usado FROM conferencia_alocacao a
    JOIN conferencia_lote l ON l.id = a."loteId" WHERE a."bancoId" = NEW."bancoId" AND l."execucaoId" = execucao;
  IF usado + NEW.centavos > credito THEN RAISE EXCEPTION 'Credito excedido na execucao'; END IF;
  SELECT COALESCE(sum(centavos),0) INTO usado FROM conferencia_alocacao WHERE "loteId" = NEW."loteId";
  IF usado + NEW.centavos > liquido THEN RAISE EXCEPTION 'Liquido do lote excedido'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER limitar_alocacao BEFORE INSERT ON conferencia_alocacao
  FOR EACH ROW EXECUTE FUNCTION conferencia_limitar_alocacao();
