#!/usr/bin/env bash
# Instala ou atualiza o OpenClaw da Central de comando. Idempotente.
# Roda NA VPS, como root, a partir de /opt/central-de-comando/openclaw/.
# Não imprime segredo nenhum.
set -euo pipefail

BASE=/opt/central-de-comando
AQUI=$BASE/openclaw
SEGREDOS=$BASE/segredos
ENV_FILE=$SEGREDOS/openclaw.env
IMAGEM=$(awk '/^ *image:/{print $2; exit}' "$AQUI/compose.yml")

install -d -m 700 "$SEGREDOS" "$BASE/backups"
if [ ! -f "$ENV_FILE" ]; then
  (
    umask 077
    printf 'OPENCLAW_GATEWAY_TOKEN=%s\nTETTEO_REGISTRO_URL=\nTETTEO_REGISTRO_SEGREDO=\n' "$(openssl rand -hex 32)" >"$ENV_FILE"
  )
  echo "segredos: $ENV_FILE criado (valores não exibidos)"
else
  echo "segredos: $ENV_FILE já existia, mantido"
fi
chmod 600 "$ENV_FILE"

# A ferramenta e o modelo do workspace precisam ser legíveis pelo usuário node (1000).
chmod -R a+rX "$AQUI/ferramenta" "$AQUI/workspace"

docker volume inspect central-openclaw-state >/dev/null
docker volume inspect central-openclaw-auth >/dev/null
docker pull "$IMAGEM" </dev/null >/dev/null
echo "imagem: $IMAGEM"

# Semeia o workspace sem apagar relatórios, rascunhos ou dados; cria a config só
# se ainda não existir (depois do login, ela guarda o modelo escolhido).
docker run --rm --user 0 --entrypoint sh \
  -v central-openclaw-state:/estado \
  -v central-openclaw-auth:/auth \
  -v "$AQUI/workspace":/modelo:ro \
  -v "$AQUI/openclaw.exemplo.json":/config-modelo.json:ro \
  "$IMAGEM" -c '
    set -e
    mkdir -p /estado/workspace/relatorios /estado/workspace/rascunhos /estado/workspace/dados-exemplo
    cp -r /modelo/. /estado/workspace/
    if [ -f /estado/openclaw.json ]; then
      echo "config: já existia, mantida"
    else
      cp /config-modelo.json /estado/openclaw.json
      echo "config: criada a partir do modelo"
    fi
    # O arquivo é do dono; ninguém mais no servidor precisa lê-lo.
    chmod 600 /estado/openclaw.json
    chown -R 1000:1000 /estado /auth
    chmod 700 /estado /auth
  ' </dev/null

cd "$AQUI"
docker compose run --rm --no-deps openclaw node dist/index.js config validate </dev/null
docker compose up -d </dev/null

for _ in $(seq 1 45); do
  curl -fsS http://127.0.0.1:18789/healthz >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:18789/healthz >/dev/null
echo "gateway: de pé em 127.0.0.1:18789"

docker exec central-openclaw node /opt/ferramenta/gerar-dados-exemplo.mjs /home/node/.openclaw/workspace/dados-exemplo
echo "portas do gateway no host:"
ss -tlnH | awk '{print $4}' | grep ':18789$'
