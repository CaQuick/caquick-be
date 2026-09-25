# 운영 runbook — 백업·복구·롤백

## 백업

- `backup` 컨테이너가 매일 `BACKUP_HOUR`(UTC)에 `mysqldump --single-transaction` → gzip → `s3://caquick-db-backup/mysql/CaQuick-<UTC>.sql.gz`. 로컬 볼륨(`backup-data`)에는 최근 3개.
- 보관: S3 수명주기 14일(Terraform `aws_s3_bucket_lifecycle_configuration.backup`). 버전 없음.
- 실패: 컨테이너 로그 + Discord 경보(`DISCORD_ALERT_WEBHOOK_URL`, 1시간에 1번). 1분 뒤 재시도.
- 있는지 보기(호스트에 aws cli가 없어도 된다 — backup 이미지의 aws와 `BACKUP_AWS_*` 키를 쓴다):
  ```bash
  docker compose run --rm --no-deps --entrypoint aws backup s3 ls s3://caquick-db-backup/mysql/
  ```
- 지금 바로 한 번: `docker compose run --rm -e BACKUP_RUN_ONCE=1 backup`

## 복구

1. 덤프 고르기·받기 — backup 컨테이너의 aws(`BACKUP_AWS_*`, IAM `caquick-backup`)로 `backup-data` 볼륨(`/backup`)에 받는다. 호스트 도구 불필요. `--no-deps`: MySQL이 죽어 있을 때(복구가 필요한 바로 그 상황) mysql healthy를 기다리지 않는다
   ```bash
   docker compose run --rm --no-deps --entrypoint aws backup s3 ls s3://caquick-db-backup/mysql/
   docker compose run --rm --no-deps --entrypoint aws backup s3 cp s3://caquick-db-backup/mysql/CaQuick-<stamp>.sql.gz /backup/restore.sql.gz
   ```
2. 먼저 **별도 DB로** 복구해 내용을 확인한다(운영 DB는 아직 건드리지 않는다)
   ```bash
   # mysql 컨테이너도 backup-data 볼륨을 /backup(읽기 전용)으로 본다 — 파일을 옮길 필요가 없다
   docker compose exec mysql bash -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE restored" && gunzip < /backup/restore.sql.gz | mysql -uroot -p"$MYSQL_ROOT_PASSWORD" restored'
   docker compose exec mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT COUNT(*) FROM restored.account; SELECT MAX(finished_at) FROM restored._prisma_migrations; SELECT COUNT(*) FROM restored.\`order\`"
   ```
3. 운영 DB 교체 — 쓰기를 멈추고 바꾼다
   ```bash
   docker compose stop api worker
   docker compose exec mysql bash -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE CaQuick; CREATE DATABASE CaQuick CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" && gunzip < /backup/restore.sql.gz | mysql -uroot -p"$MYSQL_ROOT_PASSWORD" CaQuick'
   docker compose --profile migrate run --rm migrate   # 덤프 이후 마이그레이션이 있으면 적용
   docker compose up -d worker api && docker compose ps
   ```
4. 검증: `curl -s http://127.0.0.1:4000/health/ready`, 관리자 로그인, 최근 주문 조회. `restored`는 `DROP DATABASE restored`.
5. 덤프 이후의 outbox 이벤트는 사라진다 — RabbitMQ 큐에 남은 메시지는 소비자가 멱등이라 그대로 두면 된다.

리허설: `scripts/backup-restore.spec.ts`가 실제 mysqldump → 새 DB 복구 → 행·루틴 일치를 CI마다 돈다.

## 롤백(배포)

Actions → `Deploy` → Run workflow → `image_tag`에 이전 sha. 마이그레이션은 앞으로만 간다(되돌리려면 위 복구).

## outbox 재처리

전부 worker 컨테이너 안에서 돈다(소스·ts-node·DATABASE_URL이 거기 있다).

- `FAILED`(릴레이 상한 초과): `docker compose exec worker yarn outbox:requeue --event-type=<type>` 또는 `--id=<n>`
- 소비 DLQ(`q.<Consumer>.dlq`): 원인 해소 뒤 `docker compose exec worker yarn outbox:requeue --event-id=<uuid> --republish`(경보 메시지의 명령 앞에 `docker compose exec worker`를 붙인다)
