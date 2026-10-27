-- CreateTable
CREATE TABLE "cardapioweb_conexao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "merchantNome" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ATIVA',
    "accessCifrado" TEXT,
    "refreshCifrado" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "escopos" TEXT NOT NULL,
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "pedidos" JSONB,
    "catalogo" JSONB,
    "consultadaEm" TIMESTAMP(3),
    "tentativaEm" TIMESTAMP(3),
    "ocupadaAte" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "conectadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desconectadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cardapioweb_conexao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cardapioweb_autorizacao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "verifierCifrado" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "consumidaEm" TIMESTAMP(3),
    "confirmadaEm" TIMESTAMP(3),
    "cancelando" BOOLEAN NOT NULL DEFAULT false,
    "merchantId" INTEGER,
    "merchantNome" TEXT,
    "accessCifrado" TEXT,
    "refreshCifrado" TEXT,
    "tokenExpiraEm" TIMESTAMP(3),
    "escopos" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cardapioweb_autorizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cardapioweb_recebimento" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "merchantNome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyCifrada" TEXT,
    "webhookTokenHash" TEXT,
    "apiPendenteCifrada" TEXT,
    "webhookPendenteHash" TEXT,
    "pendentePorId" TEXT,
    "pendenteAte" TIMESTAMP(3),
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "ultimoEventoEm" TIMESTAMP(3),
    "ultimaReconciliacaoEm" TIMESTAMP(3),
    "tentativaReconciliacaoEm" TIMESTAMP(3),
    "cursor" TIMESTAMP(3),
    "concessaoDono" TEXT,
    "concessaoAte" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cardapioweb_recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cardapioweb_evento" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "recebimentoId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'WEBHOOK',
    "tipo" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "statusInformado" TEXT NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "ultimoErro" TEXT,

    CONSTRAINT "cardapioweb_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cardapioweb_pedido" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "recebimentoId" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "displayId" TEXT,
    "estado" TEXT NOT NULL,
    "modalidade" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "totalCentavos" BIGINT NOT NULL,
    "criadoNoProvedorEm" TIMESTAMP(3) NOT NULL,
    "atualizadoNoProvedorEm" TIMESTAMP(3) NOT NULL,
    "conferidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cardapioweb_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cardapioweb_conexao_organizacaoId_unidadeId_ambiente_client_key" ON "cardapioweb_conexao"("organizacaoId", "unidadeId", "ambiente", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "cardapioweb_conexao_ambiente_clientId_merchantId_key" ON "cardapioweb_conexao"("ambiente", "clientId", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "cardapioweb_autorizacao_stateHash_key" ON "cardapioweb_autorizacao"("stateHash");

-- CreateIndex
CREATE INDEX "cardapioweb_autorizacao_organizacaoId_unidadeId_usuarioId_e_idx" ON "cardapioweb_autorizacao"("organizacaoId", "unidadeId", "usuarioId", "expiraEm");

-- CreateIndex
CREATE INDEX "cardapioweb_recebimento_organizacaoId_unidadeId_ambiente_idx" ON "cardapioweb_recebimento"("organizacaoId", "unidadeId", "ambiente");

-- CreateIndex
CREATE UNIQUE INDEX "cardapioweb_recebimento_ambiente_merchantId_key" ON "cardapioweb_recebimento"("ambiente", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "cardapioweb_recebimento_organizacaoId_unidadeId_id_key" ON "cardapioweb_recebimento"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE INDEX "cardapioweb_evento_recebimentoId_estado_proximaTentativaEm_idx" ON "cardapioweb_evento"("recebimentoId", "estado", "proximaTentativaEm");

-- CreateIndex
CREATE UNIQUE INDEX "cardapioweb_evento_recebimentoId_eventId_key" ON "cardapioweb_evento"("recebimentoId", "eventId");

-- CreateIndex
CREATE INDEX "cardapioweb_pedido_organizacaoId_unidadeId_atualizadoNoProv_idx" ON "cardapioweb_pedido"("organizacaoId", "unidadeId", "atualizadoNoProvedorEm");

-- CreateIndex
CREATE UNIQUE INDEX "cardapioweb_pedido_recebimentoId_orderId_key" ON "cardapioweb_pedido"("recebimentoId", "orderId");

-- AddForeignKey
ALTER TABLE "cardapioweb_conexao" ADD CONSTRAINT "cardapioweb_conexao_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapioweb_autorizacao" ADD CONSTRAINT "cardapioweb_autorizacao_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapioweb_recebimento" ADD CONSTRAINT "cardapioweb_recebimento_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapioweb_evento" ADD CONSTRAINT "cardapioweb_evento_organizacaoId_unidadeId_recebimentoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "recebimentoId") REFERENCES "cardapioweb_recebimento"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapioweb_pedido" ADD CONSTRAINT "cardapioweb_pedido_organizacaoId_unidadeId_recebimentoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "recebimentoId") REFERENCES "cardapioweb_recebimento"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
