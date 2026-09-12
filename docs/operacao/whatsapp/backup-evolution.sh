#!/bin/sh
# =============================================================================
# BACKUP DA SESSÃO DO WHATSAPP (Evolution API 2.3.7) — roda NA VPS, como root.
#
# O que guarda: o banco da Evolution (a sessão do número vive nele), o Redis,
# se houver, e o volume de instâncias, se houver. É o que permite recolocar o
# número no ar sem novo QR Code depois de um desastre.
#
# ESTE BACKUP CONTÉM SEGREDO por natureza: a sessão e a chave da instância.
# Fica numa pasta do root, com permissão 600, fora de qualquer repositório.
#
# COMO INSTALAR — uma vez, na VPS, como root. O repositório é privado, mas o
# Dokploy já baixou o código na máquina. No terminal da VPS, digite:
#
#   find /etc/dokploy -name backup-evolution.sh -exec sh {} ;
#
# O script se copia para /root/backup-evolution.sh, roda de lá, descobre
# sozinho os nomes dos contêineres, faz o primeiro backup e se agenda para as
# 03:40 de todo dia. Rodar de novo não duplica o agendamento.
#
# Variantes:
#   SEM_CRON=1 sh /root/backup-evolution.sh          quem agenda é outro
#   SEM_COPIA=1 sh <caminho>                         rodar sem copiar
#   EVOLUTION_DB_CONTAINER=nome /root/backup-evolution.sh   nomes na mão
#
# Se o find não achar nada, procure no disco inteiro:
#   find / -name backup-evolution.sh -not -path "*/node_modules/*" 2>/dev/null
# =============================================================================
set -eu

DESTINO="${DESTINO:-/root/backups-evolution}"
RETENCAO_DIAS="${RETENCAO_DIAS:-14}"
CRON="/etc/cron.d/evolution-backup"
CARIMBO="$(date +%Y%m%d-%H%M%S)"
EU="$(readlink -f "$0")"

# Chamado de dentro do código que o Dokploy baixou? Então me copio para o
# /root e sigo de lá. O agendamento precisa de um caminho que não desapareça
# no próximo deploy, e o backup não pode morar junto do repositório.
CASA="/root/backup-evolution.sh"
if [ "$EU" != "$CASA" ] && [ -z "${SEM_COPIA:-}" ]; then
  cp "$EU" "$CASA"
  chmod 700 "$CASA"
  echo "copiei o script para $CASA e sigo por ele"
  exec /bin/sh "$CASA"
fi

umask 077
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

# --- Descoberta: qual contêiner é o quê -------------------------------------
achar() { # $1 = pedaço do nome, $2 = pedaço da imagem
  docker ps --format '{{.Names}} {{.Image}}' |
    awk -v n="$1" -v i="$2" 'tolower($1) ~ n && tolower($2) ~ i { print $1; exit }'
}

DB="${EVOLUTION_DB_CONTAINER:-$(achar evolution postgres)}"
REDIS="${EVOLUTION_REDIS_CONTAINER:-$(achar evolution redis)}"
VOLUME="${EVOLUTION_INSTANCES_VOLUME:-$(docker volume ls --format '{{.Name}}' | grep -i -m1 -E 'evolution.*(instance|data)' || true)}"

echo "[$CARIMBO] banco:  ${DB:-(não achei)}"
echo "[$CARIMBO] redis:  ${REDIS:-(não usa)}"
echo "[$CARIMBO] volume: ${VOLUME:-(não usa)}"

if [ -z "$DB" ]; then
  echo "Não achei o contêiner do banco da Evolution. Rode 'docker ps' e repita com:" >&2
  echo "  EVOLUTION_DB_CONTAINER=<nome> $EU" >&2
  exit 1
fi

# --- O banco ----------------------------------------------------------------
ARQUIVO="$DESTINO/evolution-db-$CARIMBO.dump"
docker exec "$DB" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$ARQUIVO"
chmod 600 "$ARQUIVO"

# Um dump vazio é pior do que nenhum: parece backup e não é.
TAMANHO="$(wc -c < "$ARQUIVO")"
if [ "$TAMANHO" -lt 1000 ]; then
  echo "O dump saiu com $TAMANHO bytes. Algo está errado — não conte com ele." >&2
  exit 1
fi
echo "[$CARIMBO] banco guardado: $TAMANHO bytes"

# --- O Redis, se houver -----------------------------------------------------
if [ -n "$REDIS" ]; then
  docker exec "$REDIS" redis-cli SAVE > /dev/null
  docker cp "$REDIS:/data/dump.rdb" "$DESTINO/evolution-redis-$CARIMBO.rdb"
  chmod 600 "$DESTINO/evolution-redis-$CARIMBO.rdb"
  echo "[$CARIMBO] redis guardado"
fi

# --- O volume de instâncias, se houver --------------------------------------
if [ -n "$VOLUME" ]; then
  docker run --rm -v "$VOLUME:/dados:ro" -v "$DESTINO:/saida" alpine \
    tar czf "/saida/evolution-instances-$CARIMBO.tgz" -C /dados . 2>/dev/null
  chmod 600 "$DESTINO/evolution-instances-$CARIMBO.tgz"
  echo "[$CARIMBO] volume guardado"
fi

# --- Limpeza e agendamento --------------------------------------------------
find "$DESTINO" -type f -mtime +"$RETENCAO_DIAS" -delete

if [ -n "${SEM_CRON:-}" ]; then
  echo "[$CARIMBO] SEM_CRON: quem agenda é outro, não mexi no cron"
elif [ ! -f "$CRON" ]; then
  # O agendamento chama o interpretador na mão: continua funcionando mesmo
  # que o arquivo perca a permissão de execução numa cópia às pressas.
  printf '40 3 * * * root /bin/sh %s >> /var/log/backup-evolution.log 2>&1
' "$EU" > "$CRON"
  chmod 644 "$CRON"
  echo "[$CARIMBO] agendado: todo dia às 03:40 ($CRON)"
else
  echo "[$CARIMBO] agendamento já existia ($CRON)"
fi

echo "[$CARIMBO] pronto"
ls -la "$DESTINO" | tail -n 6
