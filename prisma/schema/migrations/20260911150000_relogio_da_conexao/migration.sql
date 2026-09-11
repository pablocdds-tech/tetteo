-- A batida do relógio, carimbada em cada conexão: é o que permite a tela
-- responder "a tarefa agendada está rodando?" sem ninguém entrar no servidor.
ALTER TABLE "instancia_whatsapp" ADD COLUMN "relogioEm" TIMESTAMP(3);
