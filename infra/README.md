# infra/ — 홈서버 운영 compose

로드맵 v2(모듈러 모놀리스 + 이벤트 백본)의 운영 형태. 앱 이미지 1개(`../Dockerfile`)를 `api`·`worker`로 띄우고, MySQL·Redis·RabbitMQ·백업이 같이 돈다. 인바운드 포트는 열지 않는다 — 외부는 Cloudflare Tunnel(`cloudflared`)만.

| 파일                                         | 역할                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose.yml`                                | 서비스 정의. 프로필 `edge`(cloudflared) · `observability`(alloy·loki·prometheus·grafana) · `migrate`(마이그레이션 일회성)                               |
| `.env.example`                               | `.env` 키 목록(값 없음). 실제 `.env`는 배포 잡이 GitHub Environment secrets로 만든다(600)                                                               |
| `backup/`                                    | mysqldump → gzip → S3(하루 1회, `BACKUP_HOUR` UTC). `BACKUP_RUN_ONCE=1`이면 한 번만                                                                     |
| `rabbitmq/enabled_plugins`                   | management + prometheus 플러그인                                                                                                                        |
| `prometheus/`, `loki/`, `alloy/`, `grafana/` | 관측 스택 최소 설정(09에서 경보 규칙·대시보드·exporter 추가). `prometheus/secrets/metrics.token`(gitignore)은 배포 잡이 `METRICS_ACCESS_TOKEN`으로 쓴다 |

## 절차

```bash
cd infra && cp .env.example .env   # 값 채우기 (운영은 배포 잡이 대신 한다)
docker compose --profile migrate run --rm migrate
docker compose up -d                          # 앱 + 저장소 + 백업
docker compose --profile observability up -d  # 관측
docker compose --profile edge up -d           # 터널
docker compose ps                             # healthy 확인 — api·worker는 /health/ready
```

배포(07)는 `.env` 생성 → `compose pull` → `migrate` → `worker` 교체 → `api` 교체 → ready 대기 → Discord 순서(E9). 롤백은 `IMAGE_TAG=<이전 sha> docker compose up -d api worker`.

메모리 상한(`mem_limit`)은 로드맵 v2 §1 초안이며 10에서 실측으로 확정한다(합계 ≤ 6 GB, spec이 고정).
