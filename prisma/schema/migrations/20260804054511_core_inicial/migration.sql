-- CreateEnum
CREATE TYPE "StatusUsuario" AS ENUM ('ATIVO', 'CONVIDADO', 'SUSPENSO');

-- CreateEnum
CREATE TYPE "StatusAcesso" AS ENUM ('ATIVO', 'SUSPENSO');

-- CreateEnum
CREATE TYPE "StatusEntrega" AS ENUM ('PENDENTE', 'PROCESSADO', 'FALHOU');

-- CreateEnum
CREATE TYPE "AcaoAuditoria" AS ENUM ('CRIOU', 'ALTEROU', 'EXCLUIU', 'ACESSOU');

-- CreateEnum
CREATE TYPE "PrioridadeNotificacao" AS ENUM ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE');

-- CreateTable
CREATE TABLE "organizacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "documento" TEXT,
    "logoUrl" TEXT,
    "corPrimaria" TEXT,
    "fusoHorario" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "organizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidade" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "documento" TEXT,
    "endereco" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "telefone" TEXT,
    "fusoHorario" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "avatarUrl" TEXT,
    "senhaHash" TEXT,
    "status" "StatusUsuario" NOT NULL DEFAULT 'CONVIDADO',
    "ultimoAcessoEm" TIMESTAMP(3),
    "tema" TEXT NOT NULL DEFAULT 'light',
    "idioma" TEXT NOT NULL DEFAULT 'pt-BR',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "papel" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ehSistema" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "papel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "papel_permissao" (
    "id" TEXT NOT NULL,
    "papelId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,

    CONSTRAINT "papel_permissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acesso" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "papelId" TEXT NOT NULL,
    "status" "StatusAcesso" NOT NULL DEFAULT 'ATIVO',
    "concedidoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "acesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "dispositivo" TEXT,
    "ip" TEXT,
    "navegador" TEXT,
    "unidadeAtivaId" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "ultimaAtividadeEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),

    CONSTRAINT "sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convite" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papelId" TEXT NOT NULL,
    "unidadeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token" TEXT NOT NULL,
    "convidadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "aceitoEm" TIMESTAMP(3),

    CONSTRAINT "convite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_instalado" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "chaveApp" TEXT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "configuracoes" JSONB NOT NULL DEFAULT '{}',
    "instaladoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_instalado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "atorUsuarioId" TEXT,
    "dados" JSONB NOT NULL,
    "correlacaoId" TEXT NOT NULL,
    "causaEventoId" TEXT,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrega_evento" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "appDestino" TEXT NOT NULL,
    "status" "StatusEntrega" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "processadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entrega_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "usuarioId" TEXT,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "acao" "AcaoAuditoria" NOT NULL,
    "valoresAntes" JSONB,
    "valoresDepois" JSONB,
    "ip" TEXT,
    "navegador" TEXT,
    "quando" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id" TEXT NOT NULL,
    "destinatarioId" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "appOrigem" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT,
    "link" TEXT,
    "prioridade" "PrioridadeNotificacao" NOT NULL DEFAULT 'NORMAL',
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lidaEm" TIMESTAMP(3),

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizacao_slug_key" ON "organizacao"("slug");

-- CreateIndex
CREATE INDEX "unidade_organizacaoId_idx" ON "unidade"("organizacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "unidade_organizacaoId_codigo_key" ON "unidade"("organizacaoId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "papel_organizacaoId_nome_key" ON "papel"("organizacaoId", "nome");

-- CreateIndex
CREATE INDEX "papel_permissao_chave_idx" ON "papel_permissao"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "papel_permissao_papelId_chave_key" ON "papel_permissao"("papelId", "chave");

-- CreateIndex
CREATE INDEX "acesso_usuarioId_idx" ON "acesso"("usuarioId");

-- CreateIndex
CREATE INDEX "acesso_organizacaoId_unidadeId_idx" ON "acesso"("organizacaoId", "unidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "acesso_usuarioId_organizacaoId_unidadeId_key" ON "acesso"("usuarioId", "organizacaoId", "unidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_tokenHash_key" ON "sessao"("tokenHash");

-- CreateIndex
CREATE INDEX "sessao_usuarioId_idx" ON "sessao"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "convite_token_key" ON "convite"("token");

-- CreateIndex
CREATE INDEX "convite_organizacaoId_idx" ON "convite"("organizacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "app_instalado_organizacaoId_chaveApp_key" ON "app_instalado"("organizacaoId", "chaveApp");

-- CreateIndex
CREATE INDEX "evento_tipo_ocorridoEm_idx" ON "evento"("tipo", "ocorridoEm");

-- CreateIndex
CREATE INDEX "evento_correlacaoId_idx" ON "evento"("correlacaoId");

-- CreateIndex
CREATE INDEX "evento_organizacaoId_unidadeId_ocorridoEm_idx" ON "evento"("organizacaoId", "unidadeId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "entrega_evento_status_criadoEm_idx" ON "entrega_evento"("status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "entrega_evento_eventoId_appDestino_key" ON "entrega_evento"("eventoId", "appDestino");

-- CreateIndex
CREATE INDEX "auditoria_entidade_entidadeId_idx" ON "auditoria"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "auditoria_organizacaoId_quando_idx" ON "auditoria"("organizacaoId", "quando");

-- CreateIndex
CREATE INDEX "auditoria_usuarioId_quando_idx" ON "auditoria"("usuarioId", "quando");

-- CreateIndex
CREATE INDEX "notificacao_destinatarioId_lidaEm_idx" ON "notificacao"("destinatarioId", "lidaEm");

-- AddForeignKey
ALTER TABLE "unidade" ADD CONSTRAINT "unidade_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papel" ADD CONSTRAINT "papel_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papel_permissao" ADD CONSTRAINT "papel_permissao_papelId_fkey" FOREIGN KEY ("papelId") REFERENCES "papel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acesso" ADD CONSTRAINT "acesso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acesso" ADD CONSTRAINT "acesso_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acesso" ADD CONSTRAINT "acesso_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acesso" ADD CONSTRAINT "acesso_papelId_fkey" FOREIGN KEY ("papelId") REFERENCES "papel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acesso" ADD CONSTRAINT "acesso_concedidoPorId_fkey" FOREIGN KEY ("concedidoPorId") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_unidadeAtivaId_fkey" FOREIGN KEY ("unidadeAtivaId") REFERENCES "unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convite" ADD CONSTRAINT "convite_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convite" ADD CONSTRAINT "convite_papelId_fkey" FOREIGN KEY ("papelId") REFERENCES "papel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convite" ADD CONSTRAINT "convite_convidadoPorId_fkey" FOREIGN KEY ("convidadoPorId") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_instalado" ADD CONSTRAINT "app_instalado_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento" ADD CONSTRAINT "evento_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento" ADD CONSTRAINT "evento_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento" ADD CONSTRAINT "evento_atorUsuarioId_fkey" FOREIGN KEY ("atorUsuarioId") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento" ADD CONSTRAINT "evento_causaEventoId_fkey" FOREIGN KEY ("causaEventoId") REFERENCES "evento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrega_evento" ADD CONSTRAINT "entrega_evento_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "evento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_destinatarioId_fkey" FOREIGN KEY ("destinatarioId") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
