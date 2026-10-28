-- AlterTable
ALTER TABLE "cardapioweb_pedido" ADD COLUMN     "pdvPublicadoEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pdv_pedido" ADD COLUMN     "recebidoId" TEXT,
ADD COLUMN     "revisaoOrigemEm" TIMESTAMP(3),
ALTER COLUMN "vendaId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "pedido_recebido" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "numeroOrigem" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "conteudo" JSONB NOT NULL,
    "criadoNaOrigemEm" TIMESTAMP(3) NOT NULL,
    "atualizadoNaOrigemEm" TIMESTAMP(3) NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedido_recebido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pedido_recebido_organizacaoId_unidadeId_recebidoEm_idx" ON "pedido_recebido"("organizacaoId", "unidadeId", "recebidoEm");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_recebido_referencia_key" ON "pedido_recebido"("organizacaoId", "unidadeId", "origem", "referencia");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_recebido_escopo_key" ON "pedido_recebido"("organizacaoId", "unidadeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pdv_pedido_recebidoId_key" ON "pdv_pedido"("recebidoId");

-- AddForeignKey
ALTER TABLE "pdv_pedido" ADD CONSTRAINT "pdv_pedido_organizacaoId_unidadeId_recebidoId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId", "recebidoId") REFERENCES "pedido_recebido"("organizacaoId", "unidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_recebido" ADD CONSTRAINT "pedido_recebido_organizacaoId_unidadeId_fkey" FOREIGN KEY ("organizacaoId", "unidadeId") REFERENCES "unidade"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cada cartão é de uma venda local OU de um pedido recebido, nunca dos dois.
ALTER TABLE "pdv_pedido" ADD CONSTRAINT "pdv_pedido_origem_unica_check"
CHECK (("vendaId" IS NULL) <> ("recebidoId" IS NULL));

-- O horário de pedidos externos vem da origem, sem antecedência local inventada.
-- As condições dos agendamentos locais permanecem iguais.
ALTER TABLE "pdv_pedido" DROP CONSTRAINT "pdv_pedido_agendamento_valido";
ALTER TABLE "pdv_pedido" ADD CONSTRAINT "pdv_pedido_agendamento_valido" CHECK (
  ("recebidoId" IS NOT NULL AND (
    ("agendadoPara" IS NULL AND "iniciarPreparoEm" IS NULL AND "antecedenciaMinutos" IS NULL AND "status" <> 'AGENDADO')
    OR ("agendadoPara" IS NOT NULL AND "iniciarPreparoEm" IS NOT NULL AND "antecedenciaMinutos" IS NOT NULL
      AND "iniciarPreparoEm" = "agendadoPara" AND "antecedenciaMinutos" = 0)
  )) OR ("recebidoId" IS NULL AND (
    ("agendadoPara" IS NULL AND "iniciarPreparoEm" IS NULL AND "antecedenciaMinutos" IS NULL AND "status" <> 'AGENDADO')
    OR ("agendadoPara" IS NOT NULL AND "iniciarPreparoEm" IS NOT NULL AND "antecedenciaMinutos" IS NOT NULL
      AND "antecedenciaMinutos" BETWEEN 1 AND 1440
      AND "iniciarPreparoEm" = "agendadoPara" - "antecedenciaMinutos" * INTERVAL '1 minute'
      AND ("status" <> 'AGENDADO' OR "preparoIniciadoEm" IS NULL)
      AND ("status" IN ('AGENDADO','CANCELADO') OR "preparoIniciadoEm" IS NOT NULL))
  ))
);
