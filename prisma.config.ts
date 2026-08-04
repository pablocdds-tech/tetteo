import { config as carregarEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// O Next.js lê `.env.local` sozinho; as ferramentas do Prisma, não.
carregarEnv({ path: ".env.local", quiet: true });

/**
 * Configuração do Prisma.
 *
 * A URL de conexão vive aqui (lida do ambiente), não no schema. Em
 * desenvolvimento ela vem do `.env.local`, que nunca sai da máquina; em
 * produção, das variáveis configuradas no Dokploy.
 *
 * O schema fica numa PASTA, não num arquivo único: cada camada tem o seu
 * (`core.prisma`, e depois um por App), espelhando a mesma separação do
 * código. Nenhum App mexe no arquivo de outro.
 */
export default defineConfig({
  schema: "prisma/schema",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
