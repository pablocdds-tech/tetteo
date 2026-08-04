#!/bin/sh
# =============================================================================
# O que roda quando o contêiner sobe.
#
# Existe por um motivo só: garantir que o BANCO nunca fique atrás do CÓDIGO.
# Antes desta etapa, cada mudança de tabela exigia entrar no servidor à mão —
# e o dia em que alguém esquecesse, a aplicação subiria consultando colunas
# que não existem, quebrando na cara de quem estivesse usando.
#
# `migrate deploy` só APLICA migrações já escritas e versionadas. Ele nunca
# inventa nem apaga nada: se o histórico do repositório divergir do banco, ele
# recusa e para. É a diferença para o `migrate dev`, que jamais deve chegar
# perto de produção.
#
# Falhar aqui derruba o contêiner de propósito. Servir a aplicação com o banco
# errado é pior do que não servir: o Dokploy mantém a versão anterior no ar e
# mostra o erro, em vez de aceitar dados corrompidos em silêncio.
# =============================================================================
set -e

echo "▸ Tetteo: aplicando migrações pendentes"
cd /app/migrador
./node_modules/.bin/prisma migrate deploy

echo "▸ Tetteo: banco em dia, subindo o servidor"
cd /app
exec node server.js
