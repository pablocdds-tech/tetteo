-- CreateEnum
CREATE TYPE "ProvedorWhatsapp" AS ENUM ('EVOLUTION_BAILEYS', 'SIMULADO');

-- CreateEnum
CREATE TYPE "EstadoConexao" AS ENUM ('DESCONECTADO', 'CONECTANDO', 'CONECTADO', 'ATENCAO');

-- CreateEnum
CREATE TYPE "StatusEventoWhatsapp" AS ENUM ('RECEBIDO', 'PROCESSADO', 'IGNORADO', 'FALHOU');

-- CreateEnum
CREATE TYPE "StatusAvisoWhatsapp" AS ENUM ('RASCUNHO', 'CONFIRMADO', 'NA_FILA', 'ACEITO', 'ENTREGUE', 'LIDO', 'INCERTO', 'FALHOU', 'DESCARTADO');

-- AlterTable
ALTER TABLE "instancia_whatsapp" ADD COLUMN     "agendamentosPausados" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "estado" "EstadoConexao" NOT NULL DEFAULT 'DESCONECTADO',
ADD COLUMN     "estadoDesde" TIMESTAMP(3),
ADD COLUMN     "eventosConfiguradosEm" TIMESTAMP(3),
ADD COLUMN     "motivoAtencao" TEXT,
ADD COLUMN     "provedor" "ProvedorWhatsapp" NOT NULL DEFAULT 'EVOLUTION_BAILEYS',
ADD COLUMN     "ultimoEnvioEm" TIMESTAMP(3),
ADD COLUMN     "unidadeId" TEXT,
ADD COLUMN     "vistoEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vinculo_whatsapp" ADD COLUMN     "autorizadoEm" TIMESTAMP(3),
ADD COLUMN     "autorizadoPorId" TEXT;

-- CreateTable
CREATE TABLE "evento_whatsapp" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "instanciaId" TEXT NOT NULL,
    "idExterno" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" "StatusEventoWhatsapp" NOT NULL DEFAULT 'RECEBIDO',
    "motivo" TEXT,
    "resumo" JSONB NOT NULL DEFAULT '{}',
    "repeticoes" INTEGER NOT NULL DEFAULT 0,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "ultimaRepeticaoEm" TIMESTAMP(3),

    CONSTRAINT "evento_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aviso_whatsapp" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "instanciaId" TEXT NOT NULL,
    "idPedido" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "origemTipo" TEXT NOT NULL,
    "origemId" TEXT,
    "permissaoNecessaria" TEXT,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "link" TEXT,
    "destinatarioRef" TEXT,
    "status" "StatusAvisoWhatsapp" NOT NULL DEFAULT 'RASCUNHO',
    "idMensagemProvedor" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "tentativaIniciadaEm" TIMESTAMP(3),
    "verificacoes" INTEGER NOT NULL DEFAULT 0,
    "verificadoEm" TIMESTAMP(3),
    "erro" TEXT,
    "solicitadoPorId" TEXT,
    "confirmadoPorId" TEXT,
    "descartadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "confirmadoEm" TIMESTAMP(3),
    "enfileiradoEm" TIMESTAMP(3),
    "aceitoEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "lidoEm" TIMESTAMP(3),
    "falhouEm" TIMESTAMP(3),
    "descartadoEm" TIMESTAMP(3),

    CONSTRAINT "aviso_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evento_whatsapp_organizacaoId_recebidoEm_idx" ON "evento_whatsapp"("organizacaoId", "recebidoEm");

-- CreateIndex
CREATE INDEX "evento_whatsapp_status_recebidoEm_idx" ON "evento_whatsapp"("status", "recebidoEm");

-- CreateIndex
CREATE UNIQUE INDEX "evento_whatsapp_instanciaId_idExterno_key" ON "evento_whatsapp"("instanciaId", "idExterno");

-- CreateIndex
CREATE INDEX "aviso_whatsapp_organizacaoId_status_criadoEm_idx" ON "aviso_whatsapp"("organizacaoId", "status", "criadoEm");

-- CreateIndex
CREATE INDEX "aviso_whatsapp_status_proximaTentativaEm_idx" ON "aviso_whatsapp"("status", "proximaTentativaEm");

-- CreateIndex
CREATE UNIQUE INDEX "aviso_whatsapp_organizacaoId_idPedido_key" ON "aviso_whatsapp"("organizacaoId", "idPedido");

-- CreateIndex
CREATE UNIQUE INDEX "aviso_whatsapp_instanciaId_idMensagemProvedor_key" ON "aviso_whatsapp"("instanciaId", "idMensagemProvedor");

-- CreateIndex
CREATE UNIQUE INDEX "aviso_whatsapp_referencia_key" ON "aviso_whatsapp"("referencia");

-- AddForeignKey
ALTER TABLE "evento_whatsapp" ADD CONSTRAINT "evento_whatsapp_instanciaId_fkey" FOREIGN KEY ("instanciaId") REFERENCES "instancia_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aviso_whatsapp" ADD CONSTRAINT "aviso_whatsapp_instanciaId_fkey" FOREIGN KEY ("instanciaId") REFERENCES "instancia_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
