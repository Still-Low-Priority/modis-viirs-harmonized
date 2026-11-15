#!/usr/bin/env bash
# Runs on EC2 from CI. GHCR token arrives as the first line of stdin; every
# following line is KEY=VALUE and is upserted into $DEPLOY_DIR/.env.
# Env: IMAGE_TAG, IMAGE_PREFIX, DEPLOY_DIR, GHCR_USER
set -euo pipefail

IFS= read -r GHCR_TOKEN

cd "$DEPLOY_DIR"
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
unset GHCR_TOKEN

# App env from CI secrets (CELERY_BROKER_URL, CELERY_RESULT_BACKEND, ...).
# An empty value means the secret is not set: keep whatever the server has.
touch .env
while IFS= read -r line; do
  [ -n "$line" ] || continue
  key=${line%%=*}
  if [[ "$line" != *=* || ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "remote-deploy: malformed env line from CI" >&2
    exit 1
  fi
  [ -n "${line#*=}" ] || continue
  { grep -vE "^[[:space:]]*${key}[[:space:]]*=" .env || true; } > .env.tmp
  printf '%s\n' "$line" >> .env.tmp
  chmod 600 .env.tmp
  mv .env.tmp .env
done

export IMAGE_TAG IMAGE_PREFIX
docker compose pull
docker compose up -d --remove-orphans
docker logout ghcr.io

echo "$IMAGE_TAG $(date -u +%FT%TZ)" >> deployments.log
docker image prune -f
