#!/bin/bash
# mysqldump → gzip → S3. 하루 1회(BACKUP_HOUR, UTC 시). BACKUP_RUN_ONCE=1이면 한 번 받고 끝난다(점검·spec).
# S3 버킷이 없으면 로컬 볼륨에만 남긴다. 실패는 로그로 남기고 다음 분에 다시 시도한다(08: Discord 경보·복구 runbook).
# run_backup은 `if` 조건으로 불려 그 안에서는 errexit가 꺼진다 — 단계마다 상태를 직접 돌려준다.
set -euo pipefail

: "${MYSQL_HOST:=mysql}" "${MYSQL_DATABASE:=CaQuick}" "${BACKUP_HOUR:=04}" "${BACKUP_DIR:=/backup}"

run_backup() {
  local stamp file
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$BACKUP_DIR/${MYSQL_DATABASE}-${stamp}.sql.gz"
  mkdir -p "$BACKUP_DIR"
  # pipefail이라 mysqldump 실패도 파이프 상태로 온다 — 부분 파일은 남기지 않는다
  if ! MYSQL_PWD="$MYSQL_PASSWORD" mysqldump -h "$MYSQL_HOST" -u "$MYSQL_USER" \
    --single-transaction --routines --triggers --set-gtid-purged=OFF --no-tablespaces "$MYSQL_DATABASE" \
    | gzip > "$file"; then
    rm -f "$file"
    echo "backup: mysqldump 실패" >&2
    return 1
  fi
  echo "backup: $file ($(wc -c < "$file" | tr -d ' ') bytes)"
  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    if ! aws s3 cp "$file" "s3://$BACKUP_S3_BUCKET/mysql/$(basename "$file")" --only-show-errors; then
      echo "backup: S3 업로드 실패 — 로컬 파일은 남김" >&2
      return 1
    fi
    echo "backup: uploaded s3://$BACKUP_S3_BUCKET/mysql/$(basename "$file")"
  else
    echo "backup: BACKUP_S3_BUCKET 미설정 — 로컬 파일만"
  fi
  # 로컬 사본은 최근 3개만(정리 실패는 백업 실패가 아니다)
  ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null || true
  return 0
}

if [ "${BACKUP_RUN_ONCE:-0}" = "1" ]; then
  run_backup
  exit $?
fi

last_day=""
while :; do
  touch /tmp/alive
  if [ "$(date -u +%H)" = "$BACKUP_HOUR" ] && [ "$last_day" != "$(date -u +%F)" ]; then
    if run_backup; then last_day=$(date -u +%F); else echo "backup: 실패 — 1분 뒤 재시도" >&2; fi
  fi
  sleep 60
done
