<div align="center">

<img src="./.github/assets/logo.png" alt="CaQuick Logo" width="160" />

# 케이퀵 - CaQuick Backend

**시각 기반 올인원 맞춤 케이크 주문 플랫폼**

케이크 디자인 탐색 → 디자인 수정 → 가게 매칭 → 주문·결제·픽업까지<br/>
단절된 모든 과정을 하나의 시각 기반 흐름으로 통합합니다.

<br/>

[![License](https://img.shields.io/badge/license-BUSL--1.1-blue?style=flat)](./LICENSE)
[![Node](https://img.shields.io/badge/node-24.x-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[![CI](https://img.shields.io/github/actions/workflow/status/CaQuick/caquick-be/pr-check.yml?branch=develop&style=flat&label=PR%20check)](https://github.com/CaQuick/caquick-be/actions/workflows/pr-check.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/CaQuick/caquick-be/codeql.yml?branch=develop&style=flat&label=CodeQL)](https://github.com/CaQuick/caquick-be/actions/workflows/codeql.yml)
[![codecov](https://img.shields.io/codecov/c/github/CaQuick/caquick-be?style=flat&logo=codecov&logoColor=white)](https://app.codecov.io/gh/CaQuick/caquick-be)
[![Last commit](https://img.shields.io/github/last-commit/CaQuick/caquick-be/develop?style=flat)](https://github.com/CaQuick/caquick-be/commits/develop)

</div>

## 📑 목차

- [기획 배경](#-기획-배경)
- [기술 스택](#-기술-스택)
- [아키텍처](#%EF%B8%8F-아키텍처)
- [디렉터리 구조](#-디렉터리-구조)
- [시작하기](#-시작하기)
- [GraphQL](#-graphql)
- [테스트](#-테스트)
- [CI / CD](#%EF%B8%8F-ci--cd)
- [팀](#-팀)
- [라이선스](#-라이선스)

## 🎯 기획 배경

케이크 디자인 주문은 본질적으로 **맞춤형 상품**이지만, 기존 플랫폼들은 이에 최적화되어 있지 않습니다.

| 채널           | 한계                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **인스타그램** | 디자인 영감은 풍부하지만 통합된 예약·주문·결제 흐름이 없음                                           |
| **네이버**     | 가게 검색·예약 기능은 있지만 디자인 카탈로그·탐색 UX가 약함                                          |
| **카톡·DM**    | 이미지 첨부는 가능하지만 정형 디자인 명세 양식이 없어 매번 캡처·설명·확인을 비정형으로 주고받아야 함 |

사용자는 결국 **여러 플랫폼을 옮겨 다니며 캡처 + 편집 + 설명을 조합**하는 비효율을 감내해야 합니다.

**케이퀵**은 이 단절된 과정을 시각 기반 단일 흐름으로 통합하는 서비스입니다.

## 🧱 기술 스택

### Language & Runtime

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Yarn](https://img.shields.io/badge/Yarn-2C8EBB?style=flat&logo=yarn&logoColor=white)

- **TypeScript** (strict) · **Node.js 24.x** · **Yarn 4** (Corepack)

### Framework & API

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![GraphQL](https://img.shields.io/badge/GraphQL-E10098?style=flat&logo=graphql&logoColor=white)
![Apollo](https://img.shields.io/badge/Apollo%20Server-311C87?style=flat&logo=apollographql&logoColor=white)
![Swagger](https://img.shields.io/badge/Swagger-85EA2D?style=flat&logo=swagger&logoColor=black)

- **NestJS 11** — Modules · DI · Guards · Interceptors
- **GraphQL** (schema-first SDL) · **Apollo Server 5** · `@nestjs/graphql`
- Doc / codegen 툴체인: **GraphQL Code Generator** (TS 타입 자동생성) · **SpectaQL** (GraphQL HTML 문서) · **Swagger** (REST `/rest-docs`, `@nestjs/swagger`)

### Database & ORM

![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=flat&logo=mysql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat&logo=prisma&logoColor=white)

- **MySQL 8** · **Prisma 6** (ORM + Migrations) · Custom soft-delete extension

### Auth & Validation

![OpenID](https://img.shields.io/badge/OpenID-F78C40?style=flat&logo=openid&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?style=flat&logo=jsonwebtokens&logoColor=white)
![Passport](https://img.shields.io/badge/Passport-34E27A?style=flat&logo=passport&logoColor=white)

- **OIDC** (Google · Kakao) via `openid-client`
- **JWT** (`@nestjs/jwt` + Passport) · **Argon2** (자격 증명 해시)
- `class-validator` · `class-transformer` 기반 DTO 검증

### Testing

![Jest](https://img.shields.io/badge/Jest-C21325?style=flat&logo=jest&logoColor=white)
![Testcontainers](https://img.shields.io/badge/Testcontainers-2496ED?style=flat&logo=docker&logoColor=white)

- **Jest** + **Testcontainers** (Docker 컨테이너로 실 MySQL 자동 spin-up) + **Supertest**
- DB mock 미사용 — 실 DB 통합 테스트 ([→ 테스트 섹션](#-테스트))

### Code Quality & Security

![ESLint](https://img.shields.io/badge/ESLint-4B32C3?style=flat&logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-F7B93E?style=flat&logo=prettier&logoColor=black)
![commitlint](https://img.shields.io/badge/commitlint-000000?style=flat&logo=commitlint&logoColor=white)
![Codecov](https://img.shields.io/badge/Codecov-F01F7A?style=flat&logo=codecov&logoColor=white)
![CodeQL](https://img.shields.io/badge/CodeQL-181717?style=flat)
![Dependabot](https://img.shields.io/badge/Dependabot-025E8C?style=flat&logo=dependabot&logoColor=white)

- **ESLint** (strict) · **Prettier** · **Husky** + **lint-staged**
- **commitlint** (Conventional Commits 강제) · **Codecov** (patch threshold 80%)
- **CodeQL** (GitHub Actions 기반 SAST) · **Dependabot** (의존성 자동 PR · 메이저는 ignore 정책)

### DevOps & Infrastructure

![AWS S3][aws-s3]

![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Terraform](https://img.shields.io/badge/Terraform-7B42BC?style=flat&logo=terraform&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat&logo=githubactions&logoColor=white)
![Cloudflare](https://img.shields.io/badge/Cloudflare%20Tunnel-F38020?style=flat&logo=cloudflare&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white)

- **홈서버(맥미니)**: 운영 compose([`infra/`](./infra/)) — api·worker·MySQL·Redis·RabbitMQ·백업 + 관측 스택. 외부 노출은 Cloudflare Tunnel만(인바운드 포트 없음)
- **AWS**: S3 + Presigned URL (미디어) · S3 (DB 백업)
- **Docker** — 로컬 개발 compose(MySQL·Redis·RabbitMQ) + testcontainers + 운영 이미지 1개(`Dockerfile`, api·worker 공용) + 운영 compose(`infra/compose.yml`: 앱·MySQL·Redis·RabbitMQ·cloudflared·백업, 프로필로 Alloy·Loki·Prometheus·Grafana)
- **Terraform**으로 GitHub repository / branch protection + AWS(S3 미디어·백업 버킷, 앱 IAM 사용자) 관리 (IaC)
- **GitHub Actions** — pr-check · build-image(GHCR) · deploy(셀프호스트 러너) · CodeQL · Dependabot
- **Discord webhook** — PR · push · issue 이벤트 알림
- **Winston** 구조화 로그 + `x-request-id` 상관관계 추적

## 🏗️ 아키텍처

### 레이어 의존성

요청은 항상 **단방향**으로 흐릅니다. Resolver/Service가 `PrismaService`나 `PrismaClient`에 직접 접근하는 것은 금지되어 있으며, 모든 DB 접근은 Repository를 경유합니다.

```mermaid
flowchart LR
    Client[📱 Client]
    Resolver[🧩 GraphQL Resolver<br/>I/O 조립만]
    Service[⚙️ Service<br/>비즈니스 로직]
    Repo[🗄️ Repository<br/>쿼리/트랜잭션]
    Prisma[🔷 PrismaService]
    DB[(🛢️ MySQL)]

    Client -->|GraphQL Query/Mutation| Resolver
    Resolver --> Service
    Service --> Repo
    Repo --> Prisma
    Prisma --> DB

    classDef forbidden stroke:#E0234E,stroke-dasharray:5 5
    Resolver -. "❌ 직접 접근 금지" .-> Prisma:::forbidden
    Service -. "❌ 직접 접근 금지" .-> Prisma:::forbidden
```

### Feature 모듈 구성

도메인별로 폴더가 분리되며 (`src/features/*`), 각 feature는 SDL · Resolver · Service · Repository · DTO · Constants를 colocate합니다. Feature 간에는 서로의 내부 파일을 직접 import하지 않고 **Module export provider**로만 주입받습니다.

```mermaid
flowchart TB
    subgraph features["src/features"]
        Auth[🔐 auth<br/>OIDC + JWT]
        User[👤 user<br/>마이페이지 · 프로필 · 알림 · 찜 · 리뷰]
        Product[🎂 product<br/>케이크 상품 · 카테고리]
        Order[📦 order<br/>주문 · 결제 · 픽업]
        Seller[🏪 seller<br/>판매자 가게]
        Conversation[💬 conversation<br/>채팅]
        System[🩺 system<br/>health check]
        Core[🧬 core<br/>도메인 공통]
    end

    subgraph shared["공유 레이어"]
        Common[🛠️ common<br/>무의존 유틸]
        Global[🌐 global<br/>S3 · GraphQL context · Guards]
        Config[⚙️ config]
        PrismaMod[🔷 prisma<br/>PrismaService + soft-delete]
    end

    features --> shared
    Global --> Common
    Global --> Config
```

### 핵심 설계 원칙

- **의존성 방향 강제**: `Resolver → Service → Repository → Prisma`. 역방향/우회 금지
- **Schema-First GraphQL**: SDL이 단일 소스 (`*.graphql` 파일). 변경 시 `yarn graphql:codegen`으로 타입 동기화
- **Domain Model 격리**: Prisma model 타입을 Resolver/Service에 직접 노출하지 않고 domain 모델/DTO로 매핑
- **Soft-delete 일관성**: `prisma/soft-delete.middleware.ts` Extension이 모든 READ 쿼리에 `deleted_at: null` 자동 주입 (의도적 우회 가능)
- **Fail-fast**: 운영 환경에서 JWT 시크릿 누락 시 서버 부팅 차단. GraphQL Playground 운영에서 비활성

## 📁 디렉터리 구조

```text
caquick-be/
├── src/
│   ├── main.ts                  # 부트스트랩 (NestFactory)
│   ├── app.module.ts            # 루트 모듈
│   ├── features/                # 도메인 모듈 (1 폴더 = 1 도메인)
│   │   ├── auth/                #   OIDC + JWT
│   │   ├── user/                #   마이페이지 · 프로필 · 알림 · 찜 · 리뷰 ...
│   │   ├── product/             #   케이크 상품
│   │   ├── order/               #   주문 · 결제 · 픽업
│   │   ├── seller/              #   판매자 가게
│   │   ├── conversation/        #   채팅
│   │   ├── system/              #   health check
│   │   └── core/                #   도메인 공통
│   ├── common/                  # 무의존 공용 유틸 (외부 의존 X)
│   ├── global/                  # 글로벌 (S3, Guards, GraphQL context)
│   ├── config/                  # 환경별 설정 · 검증
│   ├── prisma/                  # PrismaService · soft-delete extension
│   ├── graphql/                 # codegen 출력 (autogen, 수정 금지)
│   └── test/                    # 테스트 인프라 (factories · helpers)
├── prisma/
│   ├── schema.prisma            # DB 스키마 단일 소스
│   ├── migrations/              # 마이그레이션 히스토리
│   └── seed.ts                  # 시드 스크립트
├── infra/                       # 홈서버 운영 compose · 배포 스크립트(deploy.sh)
├── terraform/                   # GitHub repo 설정 IaC
├── .github/
│   ├── workflows/               # GitHub Actions
│   ├── dependabot.yml           # 의존성 자동 업데이트
│   └── assets/                  # README 등 GitHub 노출용 자산
├── scripts/                     # 검사·운영 스크립트(dto:check · docs:check · outbox:requeue) + spec
└── public/                      # SpectaQL HTML 문서 출력
```

## 🚀 시작하기

### Prerequisites

| 항목    | 버전               | 비고                                                   |
| ------- | ------------------ | ------------------------------------------------------ |
| Node.js | **24.x**           | `nvm install 24` 권장                                  |
| Yarn    | **4.x** (Corepack) | `corepack enable` 한 번 실행                           |
| MySQL   | **8.x**            | 로컬 또는 Docker (`docker-compose.yml` 제공)           |
| Docker  | latest             | 통합 테스트에서 testcontainers가 MySQL 컨테이너를 띄움 |

### 설치 & 실행

```bash
# 1. 의존성 설치
corepack enable
yarn install

# 2. 환경 변수 (.env 직접 생성 — 아래 "필요 환경 변수" 표 참고)
touch .env

# 3. DB 마이그레이션 (Prisma 클라이언트는 yarn install의 postinstall이 src/generated/에 생성)
yarn prisma:migrate:dev

# 4. (선택) 시드 데이터 주입
yarn prisma:seed

# 5. 개발 서버 (watch mode)
yarn start:dev
```

기본 GraphQL endpoint: `http://localhost:4000/graphql` (`PORT` 환경변수로 변경 가능). 헬스체크: `GET /health/live`(프로세스) · `GET /health/ready`(MySQL·Redis, worker는 RabbitMQ까지 — 하나라도 죽으면 503) · 메트릭: `GET /metrics`(Prometheus)

### 필요 환경 변수

> `.env.example`은 보안상 레포에 포함되지 않습니다. 아래 키를 참고해 `.env`를 직접 작성해 주세요. 정확한 검증 스키마는 [`src/config/`](./src/config/) 참고.

| 카테고리            | 키                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **서버**            | `NODE_ENV`, `PORT`, `BACKEND_BASE_URL`, `FRONTEND_BASE_URL`, `APP_ROLE`(`api`·`ws`·`worker`, 기본 `api` — worker만 outbox 디스패처·크론을 돌리고 GraphQL·문서는 싣지 않는다)                                                                                                                                                                                                                                                 |
| **DB**              | `DATABASE_URL`                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Redis (필수)**    | `REDIS_URL` — 인증 블랙리스트(정지·탈퇴·비밀번호 변경 즉시 차단) + GraphQL subscription PubSub. 미설정이면 부팅 실패(로컬은 `redis://localhost:6379`, docker-compose). `maxmemory`를 두면 `maxmemory-policy noeviction`이어야 한다 — worker 재구축이 점검해 아니면 블랙리스트 표식을 세우지 않고 경보(인증은 DB 폴백)                                                                                                        |
| **RabbitMQ (필수)** | `RABBITMQ_URL` — outbox 릴레이 → 소비자(worker) 이벤트 백본. 미설정이면 부팅 실패(로컬은 `amqp://guest:guest@localhost:5672`, docker-compose)                                                                                                                                                                                                                                                                                |
| **JWT / Auth**      | `JWT_PRIVATE_KEY_PEM_B64`(또는 `JWT_PRIVATE_KEY_PATH`) — RS256 서명키. 운영 필수, 그 외에는 미설정 시 임시 키 생성(재시작하면 토큰 무효). `JWT_PUBLIC_KEY_PEM_B64`/`JWT_PUBLIC_KEY_PATH`는 생략 시 개인키에서 유도. `JWT_ISSUER`(기본 `caquick-identity`), `JWT_AUDIENCE`(기본 `caquick-api`), `JWT_ACCESS_EXPIRES_SECONDS`, `AUTH_REFRESH_EXPIRES_DAYS`, `AUTH_COOKIE_DOMAIN`, `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAMESITE` |
| **OIDC (Google)**   | `OIDC_GOOGLE_CLIENT_ID`, `OIDC_GOOGLE_CLIENT_SECRET`, `OIDC_GOOGLE_ISSUER_URL`                                                                                                                                                                                                                                                                                                                                               |
| **OIDC (Kakao)**    | `OIDC_KAKAO_CLIENT_ID`, `OIDC_KAKAO_CLIENT_SECRET`, `OIDC_KAKAO_ISSUER_URL`                                                                                                                                                                                                                                                                                                                                                  |
| **OIDC (공통)**     | `OIDC_TEMP_COOKIE_MAX_AGE_MS`                                                                                                                                                                                                                                                                                                                                                                                                |
| **AWS S3**          | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`(IAM 사용자 `caquick-app` — Terraform이 만든 최소 권한: 미디어 put/get, 백업 put/get/list), `AWS_REGION`, `AWS_S3_BUCKET`, `S3_PRESIGN_EXPIRES_SECONDS`                                                                                                                                                                                                                          |
| **Docs**            | `DOCS_ACCESS_TOKEN` — `/gql-docs`·`/rest-docs` 접근 토큰. 운영 필수(미설정이면 production 부팅 실패), 그 외는 선택                                                                                                                                                                                                                                                                                                           |
| **메트릭**          | `METRICS_ACCESS_TOKEN` — `GET /metrics`의 Bearer 토큰. 운영 필수(api가 공개 인터넷에 있어 무인증 노출 금지), 미설정이면 로컬·CI는 열림. Prometheus가 같은 값을 보낸다                                                                                                                                                                                                                                                        |
| **경보 (선택)**     | `DISCORD_ALERT_WEBHOOK_URL` — outbox FAILED·부팅 실패 등 운영 경보를 보낼 Discord 웹훅. 미설정이면 로그로만 남긴다. `ALERT_DEDUPE_WINDOW_MS`(기본 300000) — 같은 경보 억제 창                                                                                                                                                                                                                                                |
| **Outbox (선택)**   | `OUTBOX_DISPATCH_ENABLED` — 역할이 정한다(`APP_ROLE=worker`만 켜짐). `false`로 끄기만 가능(테스트·일회성 스크립트), api에서 `true`를 줘도 켜지지 않는다(worker와 이중 전달 방지). 로컬에서 소비까지 보려면 `APP_ROLE=worker PORT=4001 yarn start:dev`를 병행. `OUTBOX_POLL_INTERVAL_MS`(1000), `OUTBOX_BATCH_SIZE`(100), `OUTBOX_MAX_ATTEMPTS`(5), `OUTBOX_PARTITION_CONCURRENCY`(4)                                         |
| **시드 (선택)**     | `ADMIN_SEED_USERNAME`, `ADMIN_SEED_PASSWORD` — 있으면 `yarn prisma:seed`가 관리자 계정 1개를 만든다. `SELLER_SEED_PASSWORD` — 시드 판매자 2곳의 로그인 비밀번호(없으면 자격증명 생략)                                                                                                                                                                                                                                        |

### 자주 쓰는 스크립트

| 명령                      | 용도                                                            |
| ------------------------- | --------------------------------------------------------------- |
| `yarn start:dev`          | NestJS watch 모드                                               |
| `yarn build`              | 프로덕션 빌드 (`dist/`)                                         |
| `yarn lint`               | ESLint --fix                                                    |
| `yarn test`               | Jest (실 DB 통합 테스트 포함)                                   |
| `yarn test:cov`           | 커버리지 측정 (임계 미달 시 비-0 종료)                          |
| `yarn dto:check`          | SDL ↔ DTO 동기화 검사 (마이그레이션 중 warning 모드)            |
| `yarn validate`           | lint + tsc + dto:check + test:cov 일괄. push 전 권장            |
| `yarn prisma:migrate:dev` | DB 마이그레이션 생성/적용 + 클라이언트 재생성                   |
| `yarn prisma:generate`    | Prisma 클라이언트 생성 (`src/generated/prisma`, 스키마 변경 후) |
| `yarn prisma:studio`      | Prisma Studio (GUI DB 브라우저)                                 |
| `yarn graphql:codegen`    | SDL → TypeScript 타입 생성                                      |
| `yarn graphql:docs`       | SpectaQL HTML 문서 빌드 (`public/`)                             |

### 컨테이너로 실행 (운영 compose)

홈서버는 앱 이미지 1개를 역할(`APP_ROLE`)만 달리해 `api`·`worker`로 띄운다. 파일과 절차는 [`infra/`](./infra/)에.

```bash
# 이미지 빌드 (멀티스테이지: deps → build → runtime, non-root)
docker build -t caquick-be:local .

# 운영 compose — 값은 infra/.env(저장소·터널)와 infra/app.env(앱) (키 목록: *.example)
# 방금 빌드한 이미지를 쓰려면 infra/.env에 IMAGE=caquick-be IMAGE_TAG=local (기본값은 GHCR :main)
cd infra
docker compose --profile migrate run --rm migrate        # prisma migrate deploy
docker compose up -d                                     # api·worker·mysql·redis·rabbitmq·backup
docker compose --profile observability up -d             # + alloy·loki·prometheus·grafana(127.0.0.1:3001)
docker compose --profile edge up -d cloudflared          # Cloudflare Tunnel(TUNNEL_TOKEN)
```

`docker compose config`가 렌더링되는지와 운영 형태(포트 미노출·noeviction·헬스체크·`mem_limit` 합계)는 `scripts/compose-config.spec.ts`가 고정한다(`yarn test:scripts`).

## 🧬 GraphQL

**Schema-First** 방식을 채택합니다. `.graphql` SDL 파일이 단일 소스이며, 변경 시 codegen으로 TypeScript 타입을 동기화합니다.

```graphql
# src/features/user/user-profile.graphql
extend type Query {
  """
  현재 로그인한 유저 정보 조회
  """
  me: MePayload!
}

type MePayload {
  accountId: ID!
  email: String
  accountType: AccountType!
  profile: UserProfile!
  """
  연동된 소셜 로그인 식별자 목록(soft-deleted 제외, 최근 로그인 순)
  """
  linkedIdentities: [LinkedIdentity!]!
}
```

```bash
# SDL 수정 후 항상 codegen 실행
yarn graphql:codegen
```

- 각 도메인은 `extend type Query` / `extend type Mutation` 패턴으로 schema를 확장
- 생성된 타입(`src/graphql/graphql.types.ts`)은 자동 생성물 — 직접 수정 금지
- 운영 환경에서 Apollo Playground는 비활성 (`introspection` off)

## 🧪 테스트

> **DB는 mock하지 않습니다.** 모든 통합 테스트는 [Testcontainers](https://node.testcontainers.org/)로 실제 MySQL 컨테이너를 자동 spin-up한 뒤 Prisma 마이그레이션까지 적용해 검증합니다.

### 왜 실DB로?

- Prisma 쿼리/관계/제약조건 동작이 mock과 미묘하게 다를 수 있어, mock이 통과해도 운영 마이그레이션이 깨지는 케이스를 사전에 잡습니다
- soft-delete extension이 `where`에 자동 주입되는 동작 등 **ORM 레이어 통합 동작**을 검증
- 트랜잭션 격리, 유니크 제약, 외래 키 cascade 동작까지 실제 DB 의미론으로 확인

### 테스트 레이어

| 레이어                 | 목적                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `*.service.spec.ts`    | 단위 + 실 DB. 분기/예외/도메인 로직                                          |
| `*.resolver.spec.ts`   | Resolver ↔ Service ↔ Repository ↔ DB 전체 경로 통합 (1~2 happy/error 케이스) |
| `*.repository.spec.ts` | Repository 단위에서만 도달 가능한 API contract                               |

```bash
# 전체 실행 (testcontainers가 MySQL 컨테이너를 띄움 — Docker 필요)
yarn test

# 특정 도메인만
yarn test src/features/user

# 커버리지 (patch threshold 80%)
yarn test:cov
```

CI에서도 동일하게 testcontainers로 격리된 MySQL을 띄우므로 로컬과 환경 차이가 거의 없습니다.

## ⚙️ CI / CD

### 워크플로우

| Workflow             | Trigger                                               | 역할                                                                                                        |
| -------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pr-check.yml`       | PR (develop/main)                                     | lint · typecheck · 통합 테스트 · 커버리지                                                                   |
| `codeql.yml`         | PR · push · 주간                                      | GitHub CodeQL SAST                                                                                          |
| `discord-notify.yml` | PR · push · issue                                     | Discord 알림                                                                                                |
| `build-image.yml`    | PR(빌드만) · main push(GHCR 푸시)                     | 앱 이미지 arm64 빌드 → `ghcr.io/caquick/caquick-be:<sha>`·`:main`                                           |
| `deploy.yml`         | `build-image` 성공(main) · 수동(롤백은 이전 sha 입력) | 셀프호스트 러너(맥미니)가 `.env`·`app.env`(600) 생성 → pull → migrate → worker → api → ready 대기 → Discord |

### 흐름

```mermaid
flowchart LR
    Dev[👨‍💻 Feature Branch]
    PR[🔀 PR to develop]
    Checks{CI Checks<br/>lint · test · coverage · CodeQL}
    Develop[🌿 develop]
    Release[🔀 Release PR<br/>develop → main]
    Main[🌲 main]
    Image[📦 build-image → GHCR]
    Deploy[🚀 deploy<br/>self-hosted macmini]

    Dev --> PR --> Checks
    Checks -->|✅ pass| Develop
    Develop --> Release --> Main
    Main --> Image --> Deploy
```

### 브랜치 보호

- **main**: PR + CI 통과 필수. 직접 push 금지
- **develop**: PR + CI 통과 권장. Repository Admin은 release sync 목적으로 fast-forward 직접 push 가능
- 필수 status check: `check`, `pr-title`, `coverage-report`, `Analyze (javascript-typescript)`
- **production Environment**: `main` 한정, `deploy.yml`만 사용. 셀프호스트 러너 라벨(`macmini`)도 `deploy.yml`만 쓴다 — 공개 레포의 PR 코드가 홈서버에서 돌지 않게
- 브랜치 보호 / 레포 설정은 [`terraform/`](./terraform/)에서 IaC로 관리

## 👤 팀

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/chanwoo7">
        <img src="https://github.com/chanwoo7.png" width="100" alt="chanwoo7" /><br/>
        <sub><b>chanwoo7</b></sub>
      </a>
      <br/>
      <sub>Backend Developer</sub>
    </td>
  </tr>
</table>

## 📜 라이선스

이 프로젝트는 **Business Source License 1.1 (BUSL-1.1)** 으로 배포됩니다.

- 비상업적 / 학습 / 평가 목적의 사용은 자유롭게 허용됩니다
- **케이크 주문 플랫폼과 경쟁하는 상업 서비스**로의 이용은 별도 라이선스 협의가 필요합니다
- Change Date(`2030-05-20`) 이후 **Apache License 2.0**으로 자동 전환됩니다

전체 조항은 [LICENSE](./LICENSE) 파일을 참고하세요.

Copyright © 2026 CaQuick. All rights reserved.

<!-- ─────────────────────────────────────────────────────────
     AWS service badge 정의 (base64-embedded SVG icons, SVGO 최적화 적용)
     SVG 출처: gilbarbara/logos (MIT) — .github/assets/aws/
     GitHub camo proxy URL 길이 ~4KB 한도 준수를 위해 SVGO multipass 처리
     ───────────────────────────────────────────────────────── -->

[aws-s3]: https://img.shields.io/badge/AWS%20S3-569A31?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNTYiIGhlaWdodD0iMjU2IiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCIgdmlld0JveD0iMCAwIDI1NiAyNTYiPjx0aXRsZT5BV1MgU2ltcGxlIFN0b3JhZ2UgU2VydmljZSAoUzMpPC90aXRsZT48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImEiIHgxPSIwJSIgeDI9IjEwMCUiIHkxPSIxMDAlIiB5Mj0iMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiMxYjY2MGYiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM2Y2FlM2UiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cGF0aCBmaWxsPSJ1cmwoI2EpIiBkPSJNMCAwaDI1NnYyNTZIMHoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJtMTk0LjY3NSAxMzcuMjU2IDEuMjI5LTguNjUyYzExLjMzIDYuNzg3IDExLjQ3OCA5LjU5IDExLjQ3NSA5LjY2Ny0uMDIuMDE2LTEuOTUyIDEuNjI5LTEyLjcwNC0xLjAxNW0tNi4yMTgtMS43MjhjLTE5LjU4NC01LjkyNi00Ni44NTctMTguNDM4LTU3Ljg5NC0yMy42NTQgMC0uMDQ1LjAxMy0uMDg2LjAxMy0uMTMxIDAtNC4yNC0zLjQ1LTcuNjktNy42OTMtNy42OS00LjIzNyAwLTcuNjg3IDMuNDUtNy42ODcgNy42OXMzLjQ1IDcuNjkgNy42ODcgNy42OWMxLjg2MiAwIDMuNTUyLS42OTUgNC44ODYtMS44IDEyLjk4NiA2LjE0OCA0MC4wNDggMTguNDc4IDU5Ljc3NiAyNC4zMDJsLTcuODAxIDU1LjA1OXEtLjAzMy4yMjUtLjAzMi40NTFjMCA0Ljg0OC0yMS40NjMgMTMuNzU0LTU2LjUzMiAxMy43NTQtMzUuNDQgMC01Ny4xMy04LjkwNi01Ny4xMy0xMy43NTRxMC0uMjItLjAyOC0uNDM1bC0xNi4zLTExOS4wNjJjMTQuMTA4IDkuNzEyIDQ0LjQ1NCAxNC44NSA3My40NzggMTQuODUgMjguOTc5IDAgNTkuMjczLTUuMTIgNzMuNDEtMTQuODAyek00OCA2NS41MjhjLjIzLTQuMjEgMjQuNDI4LTIwLjczIDc1LjItMjAuNzMgNTAuNzY0IDAgNzQuOTY2IDE2LjUxNiA3NS4yIDIwLjczdjEuNDM3Yy0yLjc4NCA5LjQ0My0zNC4xNDQgMTkuNDM0LTc1LjIgMTkuNDM0LTQxLjEyNyAwLTcyLjUwMy0xMC4wMjMtNzUuMi0xOS40Nzl6bTE1Ni44LjA3YzAtMTEuMDg3LTMxLjc5LTI3LjItODEuNi0yNy4yLTQ5LjgxMiAwLTgxLjYgMTYuMTEzLTgxLjYgMjcuMmwuMyAyLjQxNCAxNy43NTQgMTI5LjY3NmMuNDI2IDE0LjUwMyAzOS4xIDE5LjkxIDYzLjUyNiAxOS45MSAzMC4zMSAwIDYyLjUxMi02Ljk2OSA2Mi45MjgtMTkuOWw3LjY2OC01NC4wN2M0LjI2NSAxLjAyIDcuNzc2IDEuNTQyIDEwLjU5NSAxLjU0MiAzLjc4NSAwIDYuMzQ1LS45MjUgNy44OTctMi43NzQgMS4yNzQtMS41MTcgMS43Ni0zLjM1NCAxLjM5Ni01LjMxLS44My00LjQyOC02LjA4Ny05LjIwMi0xNi43OTQtMTUuMzExbDcuNjAzLTUzLjYzOXoiLz48L3N2Zz4=
