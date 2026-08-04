-- CreateEnum
CREATE TYPE "TipoDeResposta" AS ENUM ('SIM_NAO', 'NUMERO', 'TEXTO');

-- CreateEnum
CREATE TYPE "StatusResposta" AS ENUM ('ABERTA', 'FECHADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusPendencia" AS ENUM ('ABERTA', 'RESOLVIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "modelo_de_checklist" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,

    CONSTRAINT "modelo_de_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_de_modelo" (
    "id" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "secao" TEXT,
    "tipo" "TipoDeResposta" NOT NULL DEFAULT 'SIM_NAO',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "minimo" DECIMAL(14,3),
    "maximo" DECIMAL(14,3),
    "rotuloUnidade" TEXT,
    "exigeObservacaoSeNao" BOOLEAN NOT NULL DEFAULT true,
    "exigeFoto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "item_de_modelo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotina_de_checklist" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "recorrencia" "Recorrencia" NOT NULL,
    "diaDaSemana" INTEGER,
    "diaDoMes" INTEGER,
    "horario" TEXT,
    "responsavelId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rotina_de_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resposta_de_checklist" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "rotinaId" TEXT,
    "referencia" TIMESTAMP(3) NOT NULL,
    "status" "StatusResposta" NOT NULL DEFAULT 'ABERTA',
    "itensConformes" INTEGER NOT NULL DEFAULT 0,
    "itensNaoConformes" INTEGER NOT NULL DEFAULT 0,
    "pontuacao" DECIMAL(5,1),
    "observacao" TEXT,
    "abertaPorId" TEXT,
    "fechadaPorId" TEXT,
    "fechadaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resposta_de_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resposta_item" (
    "id" TEXT NOT NULL,
    "respostaId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "textoItem" TEXT NOT NULL,
    "secao" TEXT,
    "tipo" "TipoDeResposta" NOT NULL DEFAULT 'SIM_NAO',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "conforme" BOOLEAN,
    "naoSeAplica" BOOLEAN NOT NULL DEFAULT false,
    "valorNumero" DECIMAL(14,3),
    "valorTexto" TEXT,
    "observacao" TEXT,
    "fotoUrl" TEXT,
    "respondidoPorId" TEXT,
    "respondidoEm" TIMESTAMP(3),

    CONSTRAINT "resposta_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pendencia" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "respostaId" TEXT,
    "respostaItemId" TEXT,
    "descricao" TEXT NOT NULL,
    "responsavelId" TEXT,
    "prazo" TIMESTAMP(3),
    "status" "StatusPendencia" NOT NULL DEFAULT 'ABERTA',
    "resolucao" TEXT,
    "resolvidaEm" TIMESTAMP(3),
    "resolvidaPorId" TEXT,
    "criadaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pendencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "modelo_de_checklist_organizacaoId_ativo_idx" ON "modelo_de_checklist"("organizacaoId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "modelo_de_checklist_organizacaoId_nome_key" ON "modelo_de_checklist"("organizacaoId", "nome");

-- CreateIndex
CREATE INDEX "item_de_modelo_modeloId_ordem_idx" ON "item_de_modelo"("modeloId", "ordem");

-- CreateIndex
CREATE INDEX "rotina_de_checklist_unidadeId_ativo_idx" ON "rotina_de_checklist"("unidadeId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "rotina_de_checklist_unidadeId_modeloId_key" ON "rotina_de_checklist"("unidadeId", "modeloId");

-- CreateIndex
CREATE INDEX "resposta_de_checklist_unidadeId_referencia_idx" ON "resposta_de_checklist"("unidadeId", "referencia");

-- CreateIndex
CREATE INDEX "resposta_de_checklist_unidadeId_status_idx" ON "resposta_de_checklist"("unidadeId", "status");

-- CreateIndex
CREATE INDEX "resposta_de_checklist_modeloId_referencia_idx" ON "resposta_de_checklist"("modeloId", "referencia");

-- CreateIndex
CREATE INDEX "resposta_item_itemId_idx" ON "resposta_item"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "resposta_item_respostaId_itemId_key" ON "resposta_item"("respostaId", "itemId");

-- CreateIndex
CREATE INDEX "pendencia_unidadeId_status_idx" ON "pendencia"("unidadeId", "status");

-- CreateIndex
CREATE INDEX "pendencia_unidadeId_prazo_idx" ON "pendencia"("unidadeId", "prazo");

-- AddForeignKey
ALTER TABLE "item_de_modelo" ADD CONSTRAINT "item_de_modelo_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "modelo_de_checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotina_de_checklist" ADD CONSTRAINT "rotina_de_checklist_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "modelo_de_checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resposta_de_checklist" ADD CONSTRAINT "resposta_de_checklist_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "modelo_de_checklist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resposta_de_checklist" ADD CONSTRAINT "resposta_de_checklist_rotinaId_fkey" FOREIGN KEY ("rotinaId") REFERENCES "rotina_de_checklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resposta_item" ADD CONSTRAINT "resposta_item_respostaId_fkey" FOREIGN KEY ("respostaId") REFERENCES "resposta_de_checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resposta_item" ADD CONSTRAINT "resposta_item_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item_de_modelo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_respostaId_fkey" FOREIGN KEY ("respostaId") REFERENCES "resposta_de_checklist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_respostaItemId_fkey" FOREIGN KEY ("respostaItemId") REFERENCES "resposta_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

