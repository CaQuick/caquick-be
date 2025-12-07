#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)" || true

ABSDIR=$(dirname "$(readlink -f "$BASH_SOURCE")")
source "${ABSDIR}/function/profile.sh"
source "${ABSDIR}/function/get_pm2.sh"

IDLE_PROFILE=$(find_idle_profile)   # blue | green
RUN_PATH="/home/ubuntu/project/caquick-backend/${IDLE_PROFILE}"
PM2=$(get_pm2_executable)
ECOSYS="/home/ubuntu/project/caquick-backend/ecosystem.config.js"

cd "$RUN_PATH"

if [ ! -f "$ECOSYS" ]; then
  echo "ecosystem file not found: $ECOSYS"
  exit 1
fi

if $PM2 list | grep -q "backend-${IDLE_PROFILE}"; then
  $PM2 reload "backend-${IDLE_PROFILE}" --update-env
else
  $PM2 start "$ECOSYS" --only "backend-${IDLE_PROFILE}"
fi

$PM2 save
