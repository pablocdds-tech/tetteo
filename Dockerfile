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
RUN npm run build

# --- Etapa 3: execução -----------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Roda como usuário sem privilégios. Se algum dia a aplicação for invadida,
# quem estiver dentro não é root do contêiner.
RUN addgroup --system --gid 1001 tetteo \
  && adduser --system --uid 1001 --ingroup tetteo tetteo

COPY --from=builder --chown=tetteo:tetteo /app/.next/standalone ./
COPY --from=builder --chown=tetteo:tetteo /app/.next/static ./.next/static
COPY --from=builder --chown=tetteo:tetteo /app/public ./public

USER tetteo
EXPOSE 3000

CMD ["node", "server.js"]
