#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)" || true

ABSDIR=$(dirname "$(readlink -f "$BASH_SOURCE")")
source "${ABSDIR}/function/profile.sh"
source "${ABSDIR}/function/switch.sh"
source "${ABSDIR}/function/get_pm2.sh"

IDLE_PORT=$(find_idle_port)
PM2=$(get_pm2_executable)

echo ">> Health check on :$IDLE_PORT"
/bin/sleep 1

for i in {1..10}; do
  # 우선 /health/profiles, 실패 시 /health
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${IDLE_PORT}/health/profiles" || true)
  if [ "$CODE" != "200" ]; then
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${IDLE_PORT}/health" || true)
  fi

  if [ "$CODE" = "200" ]; then
    echo ">> OK. switch to $IDLE_PORT"
    switch_backend "$IDLE_PORT"

    # 반대편 중지
    OTHER=$([ "$IDLE_PORT" = "4000" ] && echo "backend-green" || echo "backend-blue")
    $PM2 stop "$OTHER" || true
    $PM2 save
    exit 0
  fi
  echo "retry $i... (code=$CODE)"
  sleep 3
done

echo ">> Health check failed"; exit 1
