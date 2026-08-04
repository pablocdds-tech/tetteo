# =============================================================================
# TETTEO — imagem de produção
#
# Construída em três etapas. A imagem final NÃO carrega o código-fonte nem as
# ferramentas de compilação — só o servidor pronto para rodar. Menor, mais
# rápida de publicar e com menos superfície de ataque.
#
# Node 24: a mesma versão usada no desenvolvimento. Versões diferentes entre a
# máquina e o servidor são fonte clássica de "funciona aqui e quebra lá".
# =============================================================================

FROM node:24-alpine AS base
WORKDIR /app

# --- Etapa 1: dependências -------------------------------------------------
# Isolada de propósito: enquanto package.json não mudar, o Docker reaproveita
# esta camada e pula a instalação inteira. Publicação de minutos vira segundos.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Etapa 2: compilação ---------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# Endereço de banco de mentira, só para esta etapa. `prisma generate` não
# conecta em lugar nenhum — apenas lê o schema e escreve o cliente tipado —
# mas exige que a variável exista. O valor real vem do Dokploy, em execução.
ENV DATABASE_URL="postgresql://compilacao:compilacao@localhost:5432/compilacao"

# Gera o cliente do Prisma ANTES de compilar: sem isso o TypeScript não
# encontra os tipos das tabelas e a compilação falha.
RUN npx prisma generate

RUN npm run build

# --- Etapa 2b: ferramenta de migração --------------------------------------
# O CLI do Prisma é dependência de desenvolvimento e NÃO entra no pacote
# `standalone` que o Next gera — mas o contêiner precisa dele para colocar o
# banco em dia ao subir.
#
# Instalado numa pasta limpa em vez de copiado do `node_modules` do projeto:
# assim quem resolve a árvore de dependências é o npm, e não eu adivinhando
# quais pacotes o CLI arrasta junto. A versão vem do próprio package.json, o
# que impede o CLI de descolar da versão do cliente.
FROM base AS migrador
WORKDIR /migrador
COPY package.json ./referencia.json
RUN apk add --no-cache openssl \
  && VERSAO_PRISMA=$(node -p "require('/migrador/referencia.json').devDependencies.prisma") \
  && VERSAO_DOTENV=$(node -p "require('/migrador/referencia.json').devDependencies.dotenv") \
  && VERSAO_TS=$(node -p "require('/migrador/referencia.json').devDependencies.typescript") \
  && rm referencia.json \
  && npm init -y > /dev/null \
  && npm install --no-audit --no-fund \
       "prisma@${VERSAO_PRISMA}" "dotenv@${VERSAO_DOTENV}" "typescript@${VERSAO_TS}"

# --- Etapa 3: execução -----------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# O motor do Prisma é compilado contra o OpenSSL do sistema. O alpine vem sem
# ele, e a falta só aparece na hora de conectar — com uma mensagem que não diz
# o que está faltando.
RUN apk add --no-cache openssl

# Roda como usuário sem privilégios. Se algum dia a aplicação for invadida,
# quem estiver dentro não é root do contêiner.
RUN addgroup --system --gid 1001 tetteo \
  && adduser --system --uid 1001 --ingroup tetteo tetteo

COPY --from=builder --chown=tetteo:tetteo /app/.next/standalone ./
COPY --from=builder --chown=tetteo:tetteo /app/.next/static ./.next/static
COPY --from=builder --chown=tetteo:tetteo /app/public ./public

# O migrador e o que ele precisa ler: o histórico de migrações e a
# configuração que diz onde fica o banco. Fica numa pasta separada para não se
# misturar com o `node_modules` enxuto que o Next montou.
COPY --from=migrador --chown=tetteo:tetteo /migrador ./migrador
COPY --chown=tetteo:tetteo prisma ./migrador/prisma
COPY --chown=tetteo:tetteo prisma.config.ts ./migrador/prisma.config.ts
COPY --chown=tetteo:tetteo docker-entrypoint.sh ./

USER tetteo
EXPOSE 3000

# Chamado através do `sh` de propósito: o bit de executável não sobrevive ao
# trajeto Windows → Git → imagem, e o contêiner falharia com um erro que não
# tem nada a ver com a causa.
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
