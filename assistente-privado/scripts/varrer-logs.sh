#!/usr/bin/env bash
# Procura segredos onde não deviam estar. Mostra só CONTAGENS, nunca valores.
# Roda NA VPS, como root. Resultado esperado: tudo 0.
set -euo pipefail

ENV_FILE=/opt/central-de-comando/segredos/openclaw.env
C=central-openclaw
token=$(sed -n 's/^OPENCLAW_GATEWAY_TOKEN=//p' "$ENV_FILE")
tetteo=$(sed -n 's/^TETTEO_REGISTRO_SEGREDO=//p' "$ENV_FILE")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

docker logs "$C" >"$tmp/docker.log" 2>&1 || true
docker exec "$C" sh -c 'cat /tmp/openclaw/*.log 2>/dev/null || true' >"$tmp/arquivos-de-log.log"
docker exec "$C" sh -c 'cd /home/node/.openclaw/workspace && find . -type f -exec cat {} + 2>/dev/null || true' >"$tmp/workspace.txt"
docker exec "$C" sh -c 'find /home/node/.openclaw/agents -name "*.jsonl" -exec cat {} + 2>/dev/null || true' >"$tmp/transcricoes.txt"

conta() {
  local rotulo=$1 alvo=$2
  shift 2
  if [ -z "$alvo" ]; then
    echo "$rotulo: vazio neste ambiente, nada a procurar"
    return
  fi
  for f in "$@"; do
    printf '%s em %s: %s\n' "$rotulo" "$(basename "$f")" "$(grep -c -a -F -- "$alvo" "$f" || true)"
  done
}

textos=("$tmp"/*.log "$tmp"/*.txt)
conta "token do gateway" "$token" "${textos[@]}"
conta "segredo do Tetteo" "$tetteo" "${textos[@]}"
for f in "${textos[@]}"; do
  printf 'padrão sk- em %s: %s\n' "$(basename "$f")" "$(grep -c -a -E 'sk-[A-Za-z0-9_-]{20,}' "$f" || true)"
  printf 'padrão JWT em %s: %s\n' "$(basename "$f")" "$(grep -c -a -E 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.' "$f" || true)"
done

# Nos bancos SQLite o login OAuth mora por desenho; ali só os dois segredos nossos.
mkdir -p "$tmp/sqlite"
for db in $(docker exec "$C" sh -c 'find /home/node/.openclaw -name "*.sqlite" 2>/dev/null'); do
  docker cp "$C:$db" "$tmp/sqlite/$(echo "$db" | tr '/' '_')" >/dev/null
done
conta "token do gateway (sqlite)" "$token" "$tmp"/sqlite/*
conta "segredo do Tetteo (sqlite)" "$tetteo" "$tmp"/sqlite/*
