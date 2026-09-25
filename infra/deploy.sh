#!/bin/bash
# 홈서버 배포 절차(E9). 배포 잡이 .env(IMAGE·IMAGE_TAG 포함)를 만든 뒤 이 디렉터리에서 부른다.
# 순서: pull → migrate(일회성) → worker 교체 → api 교체 → ready 대기 → 나머지(edge·observability·backup) 정합.
# 롤백: IMAGE_TAG를 이전 sha로 바꿔 다시 실행(workflow_dispatch) — 마이그레이션은 앞으로만 간다.
set -euo pipefail
cd "$(dirname "$0")"

wait_healthy() {
  local service=$1 deadline=$(( $(date +%s) + ${READY_TIMEOUT_SECONDS:-180} ))
  while :; do
    local state
    state=$(docker compose ps --format '{{.Service}} {{.Health}}' "$service" | awk '{print $2}')
    [ "$state" = "healthy" ] && { echo "$service healthy"; return 0; }
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "$service: ready 대기 초과(${READY_TIMEOUT_SECONDS:-180}s) — 로그:" >&2
      docker compose logs --tail 50 "$service" >&2 || true
      return 1
    fi
    sleep 5
  done
}

echo "== pull"
# --ignore-buildable: backup 이미지는 레지스트리가 아니라 ./backup에서 빌드한다 — 새 호스트에서는 pull이 실패해 set -e로 멈춘다
docker compose --profile edge --profile observability --profile migrate pull --quiet --ignore-buildable
echo "== migrate"
docker compose --profile migrate run --rm migrate
# 의존을 건너뛰지 않는다 — 새 호스트에서는 redis·rabbitmq가 아직 없다. compose가 의존(healthy)을 먼저 올린다
echo "== worker"
docker compose up -d worker
wait_healthy worker
echo "== api"
docker compose up -d api
wait_healthy api
echo "== rest"
# --build: backup 이미지는 GHCR이 아니라 여기서 빌드한다 — infra/backup 변경이 반영되게
docker compose --profile edge --profile observability up -d --build --remove-orphans
# 터널이 곧 운영 진입점 — 토큰이 비었거나 엣지에 못 붙으면 배포를 실패로 끝낸다
wait_healthy cloudflared
# 관측이 조용히 죽지 않게 — grafana(비밀 가드)·alloy(cAdvisor)·exporter(실제 스크레이프)까지 healthy를 본다
for s in grafana alloy mysqld-exporter redis-exporter; do wait_healthy "$s"; done
docker image prune -f > /dev/null
echo "== done: $(grep '^IMAGE_TAG=' .env)"
