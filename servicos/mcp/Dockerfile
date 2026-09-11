# =============================================================================
# TETTEO MCP — imagem de produção
#
# Três etapas: instala, compila, e monta a imagem final só com o que roda —
# sem TypeScript, sem testes, sem ferramentas de compilação.
# Node 24, a mesma versão do app principal e do desenvolvimento.
# =============================================================================

FROM node:24-alpine AS base
WORKDIR /app

FROM base AS dependencias
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencias AS compilacao
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM base AS execucao
ENV NODE_ENV=production
ENV PORT=8080
# "Hoje" é o dia de Brasília. O código já calcula em America/Sao_Paulo; o
# fuso do contêiner deixa os registros no mesmo relógio da loja.
ENV TZ=America/Sao_Paulo

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=compilacao /app/dist ./dist
COPY sql ./sql

# Usuário sem privilégios, que já vem na imagem do Node.
USER node
EXPOSE 8080

# O Host 127.0.0.1 está na lista de hosts permitidos.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health > /dev/null || exit 1

CMD ["node", "dist/principal.js"]
