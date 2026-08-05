-- CreateEnum
CREATE TYPE "TipoAgente" AS ENUM ('AVISO', 'COLETA', 'MODULO');

-- CreateEnum
CREATE TYPE "GatilhoAgente" AS ENUM ('HORARIO', 'ROTINA_VENCIDA', 'MENSAGEM_RECEBIDA');

-- CreateEnum
CREATE TYPE "EstadoConversa" AS ENUM ('ABERTA', 'AGUARDANDO_CONFIRMACAO', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "DirecaoMensagem" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "TipoMensagem" AS ENUM ('TEXTO', 'IMAGEM', 'DOCUMENTO', 'AUDIO');

-- CreateEnum
CREATE TYPE "StatusMensagem" AS ENUM ('PENDENTE', 'ENVIADA', 'ENTREGUE', 'FALHOU');

-- CreateTable
CREATE TABLE "instancia_whatsapp" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "numeroProprio" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "conectadaEm" TIMESTAMP(3),
    "desconectadaEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "instancia_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculo_whatsapp" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "confirmadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "vinculo_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agente_severina" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "nome" TEXT NOT NULL,
    "tipo" "TipoAgente" NOT NULL DEFAULT 'AVISO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "gatilho" "GatilhoAgente" NOT NULL,
    "gatilhoConfig" JSONB NOT NULL DEFAULT '{}',
    "destinatariosPapeis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "destinatariosUsuarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instrucoes" TEXT NOT NULL,
    "perguntas" JSONB NOT NULL DEFAULT '[]',
    "ferramentasLiberadas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "limites" JSONB NOT NULL DEFAULT '{}',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "agente_severina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversa_whatsapp" (
    "id" TEXT NOT NULL,
    "instanciaId" TEXT NOT NULL,
    "agenteId" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "remoteJid" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "referenciaTipo" TEXT,
    "referenciaId" TEXT,
    "estado" "EstadoConversa" NOT NULL DEFAULT 'ABERTA',
    "acaoPendente" JSONB,
    "ultimaMensagemEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversa_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagem_whatsapp" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "direcao" "DirecaoMensagem" NOT NULL,
    "tipo" "TipoMensagem" NOT NULL DEFAULT 'TEXTO',
    "idExterno" TEXT,
    "texto" TEXT,
    "midiaUrl" TEXT,
    "status" "StatusMensagem" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "origem" TEXT,
    "agendadaPara" TIMESTAMP(3),
    "enviadaEm" TIMESTAMP(3),
    "recebidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagem_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instancia_whatsapp_organizacaoId_nome_key" ON "instancia_whatsapp"("organizacaoId", "nome");

-- CreateIndex
CREATE INDEX "vinculo_whatsapp_organizacaoId_telefone_idx" ON "vinculo_whatsapp"("organizacaoId", "telefone");

-- CreateIndex
CREATE INDEX "vinculo_whatsapp_organizacaoId_usuarioId_idx" ON "vinculo_whatsapp"("organizacaoId", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "vinculo_whatsapp_organizacaoId_remoteJid_key" ON "vinculo_whatsapp"("organizacaoId", "remoteJid");

-- CreateIndex
CREATE INDEX "agente_severina_organizacaoId_ativo_idx" ON "agente_severina"("organizacaoId", "ativo");

-- CreateIndex
CREATE INDEX "conversa_whatsapp_organizacaoId_ultimaMensagemEm_idx" ON "conversa_whatsapp"("organizacaoId", "ultimaMensagemEm");

-- CreateIndex
CREATE INDEX "conversa_whatsapp_agenteId_estado_idx" ON "conversa_whatsapp"("agenteId", "estado");

-- CreateIndex
CREATE INDEX "conversa_whatsapp_usuarioId_idx" ON "conversa_whatsapp"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_whatsapp_idExterno_key" ON "mensagem_whatsapp"("idExterno");

-- CreateIndex
CREATE INDEX "mensagem_whatsapp_status_direcao_agendadaPara_idx" ON "mensagem_whatsapp"("status", "direcao", "agendadaPara");

-- CreateIndex
CREATE INDEX "mensagem_whatsapp_conversaId_criadoEm_idx" ON "mensagem_whatsapp"("conversaId", "criadoEm");

-- CreateIndex
CREATE INDEX "mensagem_whatsapp_origem_idx" ON "mensagem_whatsapp"("origem");

-- AddForeignKey
ALTER TABLE "conversa_whatsapp" ADD CONSTRAINT "conversa_whatsapp_instanciaId_fkey" FOREIGN KEY ("instanciaId") REFERENCES "instancia_whatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa_whatsapp" ADD CONSTRAINT "conversa_whatsapp_agenteId_fkey" FOREIGN KEY ("agenteId") REFERENCES "agente_severina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_whatsapp" ADD CONSTRAINT "mensagem_whatsapp_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversa_whatsapp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
