#!/usr/bin/env bash
set -euo pipefail

switch_backend() {
  local port="$1"
  echo "set \$backend_upstream http://127.0.0.1:${port};" \
    | sudo tee /etc/nginx/conf.d/backend-upstream.inc >/dev/null
  sudo nginx -t
  sudo systemctl reload nginx
}
