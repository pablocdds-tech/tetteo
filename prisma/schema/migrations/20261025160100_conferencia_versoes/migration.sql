ALTER TABLE conferencia_importacao ADD COLUMN "chaveConfirmacao" TEXT;
CREATE UNIQUE INDEX conferencia_importacao_confirmacao_unica ON conferencia_importacao ("organizacaoId", "unidadeId", "chaveConfirmacao");
ALTER TABLE conferencia_contrato ADD COLUMN ativa BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE conferencia_contrato ADD COLUMN "substituiId" TEXT;
CREATE UNIQUE INDEX conferencia_contrato_sucessor_unico ON conferencia_contrato ("organizacaoId", "unidadeId", "substituiId");
ALTER TABLE conferencia_contrato ADD CONSTRAINT conferencia_contrato_anterior_mesmo_escopo FOREIGN KEY ("organizacaoId", "unidadeId", "substituiId") REFERENCES conferencia_contrato ("organizacaoId", "unidadeId", id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION conferencia_original_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Original nao pode ser apagado'; END IF;
  IF (to_jsonb(NEW) - ARRAY['estado','motivoRevisao','ignoradas','confirmadoEm','chaveConfirmacao']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['estado','motivoRevisao','ignoradas','confirmadoEm','chaveConfirmacao']) THEN
    RAISE EXCEPTION 'Original e leitura nao podem ser alterados';
  END IF;
  IF OLD."chaveConfirmacao" IS NOT NULL AND NEW."chaveConfirmacao" IS DISTINCT FROM OLD."chaveConfirmacao" THEN
    RAISE EXCEPTION 'Chave de confirmacao imutavel';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER imutavel ON conferencia_contrato;
CREATE FUNCTION conferencia_contrato_versionado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contrato nao pode ser apagado'; END IF;
  IF (to_jsonb(NEW) - 'ativa') IS DISTINCT FROM (to_jsonb(OLD) - 'ativa') OR NOT OLD.ativa OR NEW.ativa THEN
    RAISE EXCEPTION 'Contrato so pode ser substituido por nova versao';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contrato_versionado BEFORE UPDATE OR DELETE ON conferencia_contrato
  FOR EACH ROW EXECUTE FUNCTION conferencia_contrato_versionado();
