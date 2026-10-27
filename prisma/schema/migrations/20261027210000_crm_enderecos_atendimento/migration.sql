-- CRM escreve o cadastro; a operação guarda apenas referências e hash para retry.
CREATE TABLE "crm_endereco_atendimento" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "rotulo" TEXT NOT NULL,
  "principal" BOOLEAN NOT NULL DEFAULT false,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "endereco" JSONB NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_endereco_atendimento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_endereco_atendimento_valido" CHECK ("versao" >= 1 AND ("ativo" OR NOT "principal") AND jsonb_typeof("endereco")='object')
);
CREATE UNIQUE INDEX "crm_endereco_atendimento_escopo_key" ON "crm_endereco_atendimento" ("storeId","contactId","id");
CREATE INDEX "crm_endereco_atendimento_cliente_idx" ON "crm_endereco_atendimento" ("storeId","contactId","ativo");
CREATE UNIQUE INDEX "crm_endereco_atendimento_principal_key" ON "crm_endereco_atendimento" ("storeId","contactId") WHERE "ativo"=true AND "principal"=true;
ALTER TABLE "crm_endereco_atendimento" ADD CONSTRAINT "crm_endereco_atendimento_contact_fkey" FOREIGN KEY ("storeId","contactId") REFERENCES "CrmContact" ("storeId","id") ON DELETE RESTRICT;

CREATE TABLE "crm_atendimento_operacao" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "enderecoId" TEXT,
  "versaoEndereco" INTEGER,
  "contatoAtualizadoEm" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_atendimento_operacao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_atendimento_operacao_tipo_valido" CHECK ("tipo" IN ('CRIAR_CLIENTE','CRIAR_ENDERECO','ALTERAR_ENDERECO'))
);
CREATE UNIQUE INDEX "crm_atendimento_operacao_chave_key" ON "crm_atendimento_operacao" ("storeId","chave");
ALTER TABLE "crm_atendimento_operacao" ADD CONSTRAINT "crm_atendimento_operacao_contact_fkey" FOREIGN KEY ("storeId","contactId") REFERENCES "CrmContact" ("storeId","id") ON DELETE RESTRICT;
ALTER TABLE "crm_atendimento_operacao" ADD CONSTRAINT "crm_atendimento_operacao_endereco_fkey" FOREIGN KEY ("storeId","contactId","enderecoId") REFERENCES "crm_endereco_atendimento" ("storeId","contactId","id") ON DELETE RESTRICT;
