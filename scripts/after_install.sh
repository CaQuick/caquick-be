#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)" || true

ABSDIR=$(dirname "$(readlink -f "$BASH_SOURCE")")
source "${ABSDIR}/function/profile.sh"

IDLE_PROFILE=$(find_idle_profile)  # blue | green
DEPLOY_DIR="/home/ubuntu/project/caquick-backend/${IDLE_PROFILE}"
TMP_DIR="/tmp/caquick-backend"

echo ">> AfterInstall | DEPLOY_DIR=$DEPLOY_DIR"

mkdir -p "$DEPLOY_DIR"

# 기존 .env 보존
[ -f "$DEPLOY_DIR/.env" ] && cp "$DEPLOY_DIR/.env" "$TMP_DIR/.env.bak" || true

rm -rf "${DEPLOY_DIR:?}/"*
cp -r "$TMP_DIR/"* "$DEPLOY_DIR" || true

# .env 복구
[ -f "$TMP_DIR/.env.bak" ] && mv "$TMP_DIR/.env.bak" "$DEPLOY_DIR/.env" || true

# 권한
chown -R ubuntu:ubuntu "$DEPLOY_DIR"

# 에코시스템 파일 루트 배치(덮어쓰기)
if [ -f "$TMP_DIR/ecosystem.config.js" ]; then
  cp "$TMP_DIR/ecosystem.config.js" "/home/ubuntu/project/caquick-backend/ecosystem.config.js"
  chown ubuntu:ubuntu "/home/ubuntu/project/caquick-backend/ecosystem.config.js"
fi
