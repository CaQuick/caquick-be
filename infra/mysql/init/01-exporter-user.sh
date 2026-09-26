#!/bin/bash
# 첫 초기화 때만 돈다(docker-entrypoint-initdb.d). mysqld_exporter 전용 사용자 — 이미 초기화된 볼륨은
# `docker compose exec mysql bash /docker-entrypoint-initdb.d/01-exporter-user.sh`로 같은 스크립트를 다시 돌린다(runbook §관측).
# 권한은 기본 컬렉터(SHOW GLOBAL STATUS/VARIABLES·information_schema.INNODB_*)에 필요한 만큼만 — 앱 스키마 SELECT는 주지 않는다.
set -euo pipefail
if [ -z "${MYSQL_EXPORTER_PASSWORD:-}" ]; then
  echo "[init] MYSQL_EXPORTER_PASSWORD 없음 — exporter 사용자를 만들지 않는다"
  exit 0
fi
# SQL 문자열 안에 들어가므로 백슬래시·작은따옴표를 이스케이프한다(임의 문자로 초기화가 반쯤 실패하거나 root 세션에서 다른 SQL이 돌지 않게)
pw=${MYSQL_EXPORTER_PASSWORD//\\/\\\\}
pw=${pw//\'/\\\'}
# 비밀번호는 argv가 아니라 MYSQL_PWD로 — /proc/*/cmdline·docker top에 남지 않게
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot <<SQL
CREATE USER IF NOT EXISTS 'exporter'@'%' IDENTIFIED WITH mysql_native_password BY '${pw}' WITH MAX_USER_CONNECTIONS 3;
ALTER USER 'exporter'@'%' IDENTIFIED WITH mysql_native_password BY '${pw}';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'exporter'@'%';
GRANT SELECT ON performance_schema.* TO 'exporter'@'%';
FLUSH PRIVILEGES;
SQL
echo "[init] exporter 사용자 준비"
