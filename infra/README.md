# infra/ — 홈서버 운영 compose

홈서버 운영 형태. 앱 이미지 1개(`../Dockerfile`)를 `api`·`worker`로 띄우고, MySQL·Redis·RabbitMQ·백업이 같이 돈다. 인바운드 포트는 열지 않는다 — 외부는 Cloudflare Tunnel(`cloudflared`)만.

| 파일                       | 역할                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose.yml`              | 서비스 정의. 프로필 `edge`(cloudflared) · `observability`(alloy·loki·prometheus·grafana) · `migrate`(마이그레이션 일회성)                                                                                   |
| `.env.example`             | `.env` 키 목록(값 없음) — compose 보간 + 저장소·터널·Grafana 비밀. 컨테이너에 주입하지 않는다                                                                                                               |
| `app.env.example`          | `app.env` 키 목록 — 앱(api·worker·migrate)이 읽는 값만. 두 파일 다 배포 잡이 GitHub Environment secrets(`DOTENV`·`APP_ENV`)로 만든다(600)                                                                   |
| `backup/`                  | mysqldump → gzip → S3(하루 1회, `BACKUP_HOUR` UTC, 실패 시 Discord). `BACKUP_RUN_ONCE=1`이면 한 번만. 복구·롤백은 [`runbook.md`](./runbook.md)                                                              |
| `rabbitmq/enabled_plugins` | management + prometheus 플러그인                                                                                                                                                                            |
| `prometheus/`              | 스크레이프: 앱 api·worker(`/metrics`, Bearer = `.env`의 `METRICS_ACCESS_TOKEN` → compose secret), RabbitMQ 플러그인, mysqld·redis exporter. 컨테이너 자원은 alloy가 remote write                            |
| `alloy/`                   | docker logs → Loki(이 프로젝트만, 앱 로그는 `level`·`role` 라벨) + cAdvisor(raw cgroup `/caquick/<service>/…` — compose `cgroup_parent`) → Prometheus                                                       |
| `loki/`                    | 단일 바이너리, 14일 보존                                                                                                                                                                                    |
| `grafana/`                 | 데이터소스 2 · 대시보드 2(앱 요청·outbox·큐 / 컨테이너 자원) · **통합 경보 → Discord**(`DISCORD_ALERT_WEBHOOK_URL`): 스크레이프 실패 3분, 큐 적체 > 500 5분, 컨테이너 메모리 > 90% 10분, outbox FAILED, DLQ |
| `mysql/init/`              | 첫 초기화 때 mysqld_exporter 사용자(`MYSQL_EXPORTER_PASSWORD`). 이미 있는 볼륨은 runbook §관측                                                                                                              |

## 절차

```bash
cd infra && cp .env.example .env && cp app.env.example app.env   # 값 채우기 (운영은 배포 잡이 대신 한다)
docker compose --profile migrate run --rm migrate
docker compose up -d                          # 앱 + 저장소 + 백업
docker compose --profile observability up -d  # 관측
docker compose --profile edge up -d           # 터널(TUNNEL_TOKEN 없으면 cloudflared가 바로 죽는다)
docker compose ps                             # healthy 확인 — api·worker는 /health/ready
```

배포(`.github/workflows/deploy.yml` → `deploy.sh`)는 `.env`·`app.env` 생성 → `compose pull` → `migrate` → `worker` 교체(ready) → `api` 교체(ready) → 나머지 프로필 → Discord 순서. 롤백은 Actions에서 `deploy` 수동 실행에 이전 sha를 넣는다(마이그레이션은 앞으로만). 셀프호스트 러너·Environment `production`·secrets(`DOTENV`·`APP_ENV`·`DISCORD_WEBHOOK_URL`)·`vars.DEPLOY_DIR`(기본 `/opt/caquick`)는 GitHub 설정. 맥 러너의 GHCR login은 키체인 helper를 피하려고 잡 전용 `DOCKER_CONFIG`(auths 항목 선기입)를 쓴다 — launchd 세션에서는 키체인 UI가 없어 `-25308`로 죽기 때문이며, 러너 사용자의 `~/.docker`는 건드리지 않는다.

메모리 상한(`mem_limit`)은 홈서버 실측(유휴·부하)으로 확정했다 — 표는 [`runbook.md`](./runbook.md) §관측(합계 ≤ 6 GB, spec이 고정).
