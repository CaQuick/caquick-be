#!/usr/bin/env bash
set -euo pipefail

get_pm2_executable() {
  # 1) PATH
  if command -v pm2 &>/dev/null; then
    command -v pm2
    return 0
  fi
  # 2) /usr/local/bin
  if [ -x "/usr/local/bin/pm2" ]; then
    echo "/usr/local/bin/pm2"
    return 0
  fi
  # 3) /usr/bin
  if [ -x "/usr/bin/pm2" ]; then
    echo "/usr/bin/pm2"
    return 0
  fi
  echo "Error: pm2 not found" >&2
  return 1
}
