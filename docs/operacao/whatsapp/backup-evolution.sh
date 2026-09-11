#!/bin/sh
# =============================================================================
# BACKUP DA SESSÃO DO WHATSAPP (Evolution API 2.3.7) — roda NA VPS, como root.
#
# O que guarda: o banco da Evolution (tabela Session, entre outras) e, conforme
# a configuração do contêiner, o Redis ou o volume de instâncias. É o que
# permite recolocar o número no ar sem novo QR Code depois de um desastre.
#
# ESTE BACKUP CONTÉM SEGREDO por natureza (a sessão e a chave da instância).
# Fica numa pasta do root, com permissão 600, fora de qualquer repositório.
#
# Preencha as três variáveis abaixo com os nomes reais (docker ps). Deixe vazio
# o que não existir na sua instalação. Nada aqui pede senha: o pg_dump roda
# DENTRO do contêiner do banco, com o usuário que ele já conhece.
#
# Agendar (exemplo, 03:40 todo dia):
#   40 3 * * * root /root/backup-evolution.sh >> /var/log/backup-evolution.log 2>&1
# =============================================================================
set -eu

EVOLUTION_DB_CONTAINER=""        # ex.: evolution-postgres-xxxx
EVOLUTION_REDIS_CONTAINER=""     # ex.: evolution-redis-xxxx (vazio se não usa Redis)
EVOLUTION_INSTANCES_VOLUME=""    # ex.: evolution_instances (vazio se a sessão está no Redis)

DESTINO="/root/backups-evolution"
RETENCAO_DIAS=14
CARIMBO="$(date +%Y%m%d-%H%M%S)"

umask 077
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

if [ -z "$EVOLUTION_DB_CONTAINER" ]; then
  echo "Preencha EVOLUTION_DB_CONTAINER no topo do script." >&2
  exit 1
fi

echo "[$CARIMBO] banco da Evolution"
docker exec "$EVOLUTION_DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DESTINO/evolution-db-$CARIMBO.dump"
chmod 600 "$DESTINO/evolution-db-$CARIMBO.dump"

if [ -n "$EVOLUTION_REDIS_CONTAINER" ]; then
  echo "[$CARIMBO] redis da Evolution"
  docker exec "$EVOLUTION_REDIS_CONTAINER" redis-cli SAVE > /dev/null
  docker cp "$EVOLUTION_REDIS_CONTAINER:/data/dump.rdb" "$DESTINO/evolution-redis-$CARIMBO.rdb"
  chmod 600 "$DESTINO/evolution-redis-$CARIMBO.rdb"
fi

if [ -n "$EVOLUTION_INSTANCES_VOLUME" ]; then
  echo "[$CARIMBO] volume de instâncias"
  docker run --rm -v "$EVOLUTION_INSTANCES_VOLUME:/dados:ro" -v "$DESTINO:/saida" alpine tar czf "/saida/evolution-instances-$CARIMBO.tgz" -C /dados .
  chmod 600 "$DESTINO/evolution-instances-$CARIMBO.tgz"
fi

echo "[$CARIMBO] apagando o que tem mais de $RETENCAO_DIAS dias"
find "$DESTINO" -type f -mtime +"$RETENCAO_DIAS" -delete

echo "[$CARIMBO] pronto"
ls -la "$DESTINO" | tail -n 6
