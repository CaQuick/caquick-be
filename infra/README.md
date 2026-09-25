# infra/ — 홈서버 운영 compose

로드맵 v2(모듈러 모놀리스 + 이벤트 백본)의 운영 형태. 앱 이미지 1개(`../Dockerfile`)를 `api`·`worker`로 띄우고, MySQL·Redis·RabbitMQ·백업이 같이 돈다. 인바운드 포트는 열지 않는다 — 외부는 Cloudflare Tunnel(`cloudflared`)만.

| 파일                                         | 역할                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose.yml`                                | 서비스 정의. 프로필 `edge`(cloudflared) · `observability`(alloy·loki·prometheus·grafana) · `migrate`(마이그레이션 일회성)                                     |
| `.env.example`                               | `.env` 키 목록(값 없음) — compose 보간 + 저장소·터널·Grafana 비밀. 컨테이너에 주입하지 않는다                                                                 |
| `app.env.example`                            | `app.env` 키 목록 — 앱(api·worker·migrate)이 읽는 값만. 두 파일 다 배포 잡이 GitHub Environment secrets(`DOTENV`·`APP_ENV`)로 만든다(600)                     |
| `backup/`                                    | mysqldump → gzip → S3(하루 1회, `BACKUP_HOUR` UTC, 실패 시 Discord). `BACKUP_RUN_ONCE=1`이면 한 번만. 복구·롤백은 [`runbook.md`](./runbook.md)                |
| `rabbitmq/enabled_plugins`                   | management + prometheus 플러그인                                                                                                                              |
| `prometheus/`, `loki/`, `alloy/`, `grafana/` | 관측 스택 최소 설정(09에서 경보 규칙·대시보드·exporter 추가). 앱 `/metrics` 토큰은 `.env`의 `METRICS_ACCESS_TOKEN`이 compose secret으로 Prometheus에 들어간다 |

## 절차

```bash
cd infra && cp .env.example .env && cp app.env.example app.env   # 값 채우기 (운영은 배포 잡이 대신 한다)
docker compose --profile migrate run --rm migrate
docker compose up -d                          # 앱 + 저장소 + 백업
docker compose --profile observability up -d  # 관측
docker compose --profile edge up -d           # 터널(TUNNEL_TOKEN 없으면 cloudflared가 바로 죽는다)
docker compose ps                             # healthy 확인 — api·worker는 /health/ready
```

배포(`.github/workflows/deploy.yml` → `deploy.sh`)는 `.env`·`app.env` 생성 → `compose pull` → `migrate` → `worker` 교체(ready) → `api` 교체(ready) → 나머지 프로필 → Discord 순서(E9). 롤백은 Actions에서 `deploy` 수동 실행에 이전 sha를 넣는다(마이그레이션은 앞으로만). 셀프호스트 러너·Environment `production`·secrets(`DOTENV`·`APP_ENV`·`DISCORD_WEBHOOK_URL`)·`vars.DEPLOY_DIR`(기본 `/opt/caquick`)는 GitHub 설정.

메모리 상한(`mem_limit`)은 로드맵 v2 §1 초안이며 10에서 실측으로 확정한다(합계 ≤ 6 GB, spec이 고정).
