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

# DB 마이그레이션 적용 (신규 테이블/컬럼이 있을 때만 실행됨, 변경 없으면 no-op)
echo ">> Running Prisma migrate deploy..."
npx prisma migrate deploy
echo ">> Prisma migrate deploy complete."

if [ ! -f "$ECOSYS" ]; then
  echo "ecosystem file not found: $ECOSYS"
  exit 1
fi

if $PM2 list | grep -q "backend-${IDLE_PROFILE}"; then
  $PM2 reload "backend-${IDLE_PROFILE}" --update-env
else
  $PM2 start "$ECOSYS" --only "backend-${IDLE_PROFILE}"
fi

# worker는 한 번에 하나만(outbox 디스패처·크론이 겹치면 같은 작업이 두 번 돈다) — 반대편을 먼저 멈추고 새 코드로 띄운다
OTHER_PROFILE=$([ "$IDLE_PROFILE" = "blue" ] && echo "green" || echo "blue")
$PM2 stop "worker-${OTHER_PROFILE}" || true
if $PM2 list | grep -q "worker-${IDLE_PROFILE}"; then
  $PM2 reload "worker-${IDLE_PROFILE}" --update-env
else
  $PM2 start "$ECOSYS" --only "worker-${IDLE_PROFILE}"
fi

$PM2 save
