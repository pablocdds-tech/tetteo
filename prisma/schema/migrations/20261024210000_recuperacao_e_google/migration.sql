ALTER TABLE "usuario" ADD COLUMN "googleSubject" TEXT,
  ADD COLUMN "versaoSessao" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "usuario_googleSubject_key" ON "usuario"("googleSubject");

CREATE TABLE "recuperacao_senha" (
  "id" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "usadoEm" TIMESTAMP(3),
  CONSTRAINT "recuperacao_senha_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recuperacao_senha_usuarioId_fkey" FOREIGN KEY ("usuarioId")
    REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "recuperacao_senha_tokenHash_key" ON "recuperacao_senha"("tokenHash");
CREATE INDEX "recuperacao_senha_usuarioId_expiraEm_idx" ON "recuperacao_senha"("usuarioId", "expiraEm");

CREATE TABLE "limite_autenticacao" (
  "chave" TEXT NOT NULL,
  "tentativas" INTEGER NOT NULL DEFAULT 1,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "limite_autenticacao_pkey" PRIMARY KEY ("chave")
);
CREATE INDEX "limite_autenticacao_expiraEm_idx" ON "limite_autenticacao"("expiraEm");
