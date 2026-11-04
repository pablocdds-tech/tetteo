-- Ampliação aditiva: preserva modelos, respostas e notas existentes.
ALTER TYPE "TipoDeResposta" ADD VALUE 'SELECAO_UNICA';
ALTER TYPE "TipoDeResposta" ADD VALUE 'MULTIPLA_ESCOLHA';

ALTER TABLE "item_de_modelo"
  ADD COLUMN "exigeVideo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opcoes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "analisarIA" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "criterioIA" TEXT;

ALTER TABLE "resposta_de_checklist"
  ADD COLUMN "responsavelId" TEXT,
  ADD COLUMN "prazoEm" TIMESTAMP(3),
  ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "resposta_item"
  ADD COLUMN "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "exigeObservacaoSeNao" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "exigeFoto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "exigeVideo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rotuloUnidade" TEXT,
  ADD COLUMN "minimo" DECIMAL(14,3),
  ADD COLUMN "maximo" DECIMAL(14,3),
  ADD COLUMN "opcoes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "analisarIA" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "criterioIA" TEXT,
  ADD COLUMN "valorSelecao" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "resultadoIA" TEXT NOT NULL DEFAULT 'NAO_SOLICITADA',
  ADD COLUMN "motivoIA" TEXT,
  ADD COLUMN "confiancaIA" DOUBLE PRECISION,
  ADD COLUMN "analisadaVersao" INTEGER,
  ADD COLUMN "analiseIniciadaEm" TIMESTAMP(3),
  ADD COLUMN "revisadoPorId" TEXT,
  ADD COLUMN "revisadoEm" TIMESTAMP(3);

-- As regras históricas anteriores não eram versionadas: esta é a regra
-- atualmente associada à pergunta. Daqui em diante a abertura a congela.
UPDATE "resposta_item" r SET
  "obrigatorio" = i."obrigatorio",
  "exigeObservacaoSeNao" = i."exigeObservacaoSeNao",
  "exigeFoto" = i."exigeFoto",
  "rotuloUnidade" = i."rotuloUnidade",
  "minimo" = i."minimo",
  "maximo" = i."maximo"
FROM "item_de_modelo" i WHERE r."itemId" = i."id";

UPDATE "resposta_de_checklist" r SET "responsavelId" = t."responsavelId"
FROM "rotina_de_checklist" t WHERE r."rotinaId" = t."id" AND r."status" = 'ABERTA';

CREATE TABLE "checklist_evidencia" (
  "id" TEXT NOT NULL,
  "respostaItemId" TEXT NOT NULL,
  "arquivoId" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "excluidoEm" TIMESTAMP(3),
  CONSTRAINT "checklist_evidencia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checklist_evidencia_respostaItemId_fkey" FOREIGN KEY ("respostaItemId") REFERENCES "resposta_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "checklist_evidencia_arquivoId_fkey" FOREIGN KEY ("arquivoId") REFERENCES "arquivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "checklist_evidencia_arquivoId_key" ON "checklist_evidencia"("arquivoId");
CREATE INDEX "checklist_evidencia_respostaItemId_excluidoEm_idx" ON "checklist_evidencia"("respostaItemId", "excluidoEm");
