#!/usr/bin/env bash
# Runs on EC2 from CI. GHCR token arrives as the first line of stdin.
# Env: IMAGE_TAG, IMAGE_PREFIX, DEPLOY_DIR, GHCR_USER
set -euo pipefail

IFS= read -r GHCR_TOKEN

cd "$DEPLOY_DIR"
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
unset GHCR_TOKEN

export IMAGE_TAG IMAGE_PREFIX
docker compose pull
docker compose up -d --remove-orphans
docker logout ghcr.io

echo "$IMAGE_TAG $(date -u +%FT%TZ)" >> deployments.log
docker image prune -f
