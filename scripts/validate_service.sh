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
# api 4000/4001 ↔ worker 4002/4003 (ecosystem.config.js)
if [ "$IDLE_PORT" = "4000" ]; then
  NEW_WORKER="worker-blue"; NEW_WORKER_PORT=4002; OLD_WORKER="worker-green"; OTHER_API="backend-green"
else
  NEW_WORKER="worker-green"; NEW_WORKER_PORT=4003; OLD_WORKER="worker-blue"; OTHER_API="backend-blue"
fi

# 새 worker가 준비되기 전에는 옛 worker를 살려 둔다. 준비 실패면 새 worker를 내리고 옛 것을 그대로 둔다.
wait_worker_ready() {
  for j in {1..10}; do
    WCODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${NEW_WORKER_PORT}/health/ready" || true)
    if [ "$WCODE" = "200" ]; then return 0; fi
    echo "worker retry $j... (code=$WCODE)"
    sleep 3
  done
  return 1
}

echo ">> Health check on :$IDLE_PORT"
/bin/sleep 1

for i in {1..10}; do
  # 의존성(MySQL·Redis)까지 살아 있어야 트래픽을 넘긴다 — 프로세스만 보는 경로(live·profiles)로는 판정하지 않는다
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${IDLE_PORT}/health/ready" || true)

  if [ "$CODE" = "200" ]; then
    echo ">> API ready on :$IDLE_PORT. checking $NEW_WORKER on :$NEW_WORKER_PORT"
    if ! wait_worker_ready; then
      echo ">> $NEW_WORKER not ready — keeping $OLD_WORKER, stopping $NEW_WORKER"
      $PM2 stop "$NEW_WORKER" || true
      exit 1
    fi

    echo ">> OK. switch to $IDLE_PORT"
    switch_backend "$IDLE_PORT"

    # 반대편 api·worker 중지 — worker는 새 것이 ready를 통과한 뒤에만
    $PM2 stop "$OTHER_API" || true
    $PM2 stop "$OLD_WORKER" || true
    $PM2 save
    exit 0
  fi
  echo "retry $i... (code=$CODE)"
  sleep 3
done

# api가 끝내 준비되지 않으면 새 worker도 내린다 — application_start가 옛 worker를 살려 뒀으므로 둘이 같이 돌면 안 된다
echo ">> Health check failed — stopping $NEW_WORKER, keeping $OLD_WORKER"
$PM2 stop "$NEW_WORKER" || true
exit 1
