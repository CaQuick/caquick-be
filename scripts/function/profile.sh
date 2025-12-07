#!/usr/bin/env bash
set -euo pipefail

# 현재 backend-upstream.inc가 가리키는 포트로 활성 프로필 판정
current_backend_port() {
  grep -oE '127\.0\.0\.1:[0-9]+' /etc/nginx/conf.d/backend-upstream.inc \
    | sed 's/127\.0\.0\.1://'
}

find_idle_profile() {
  local cur
  cur=$(current_backend_port || echo "4000")
  if [ "$cur" = "4000" ]; then echo "green"; else echo "blue"; fi
}

find_idle_port() {
  local idle
  idle=$(find_idle_profile)
  if [ "$idle" = "blue" ]; then echo "4000"; else echo "4001"; fi
}
