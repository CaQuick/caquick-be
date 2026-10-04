# 아키텍처 컨벤션

이 레포의 구조적 규칙과 **그 이유**를 적는다. CLAUDE.md는 "무엇을 강제하는가"만 짧게 두고, 근거·경계·예외는 여기가 정본이다. 규칙마다 "규칙 → 왜 → 어기면 무엇이 잡는가"로 쓴다.

> 핵심 원칙: "최적"은 단일 정답이 아니라 제약(단일 구현 여부·변경 빈도·경계)에 따른 의도적 선택이다. 각 규칙은 trade-off를 함께 둔다.

---

## 1. 의존성 주입 — 구체 클래스가 기본, 토큰은 세 경우만

**규칙.** 단일 구현 내부 협력자는 토큰·인터페이스 없이 구체 클래스로 주입한다. 토큰(또는 abstract class)은 다음 중 하나일 때만 둔다.

- (a) 2번째 구현이 현실적으로 예상됨
- (b) 외부 부수효과 어댑터(OIDC 클라이언트, 경보 전송 함수, 시계, ID 생성기)라 테스트에서 stub이 필요
- (c) 여러 feature가 광범위하게 주입하는 cross-cutting 포트 — `audit-log`(`AUDIT_LOG_REPOSITORY`), `store`의 `CatalogQuery`(conversation이 묻는 읽기 포트), `order`의 예약 수량 포트

**왜.** NestJS DI는 클래스 토큰도 `Test.overrideProvider(Class)`로 바꿀 수 있어 **테스트 용이성은 토큰 도입 근거가 아니다**. 전 repository에 1:1 인터페이스를 강제하면 lockstep 유지 비용만 늘고 얻는 게 없다(YAGNI, speculative generality).

**새 토큰을 만들 때.** `Symbol + interface`보다 **abstract class를 토큰으로** — 런타임에 존재하고 `@Inject()` 없이 타입으로 주입되며 계약과 mock을 모두 제공한다. 토큰 패턴인 feature는 구체 repository 클래스를 배럴로 노출하지 않는다(계약 우회 경로가 생긴다).

---

## 2. feature 경계 — 배럴(`index.ts`)이 공개 API

**규칙.** feature 사이의 import는 대상 feature의 `index.ts`로만 한다(ESLint `boundaries`가 차단). 배럴은 다른 feature가 실제로 쓰는 것만 노출한다: `Module`, 주입 대상(구체 주입이면 서비스·repository 클래스, 토큰 패턴이면 토큰과 인터페이스 타입), 그리고 계약(DTO·출력 타입·이벤트·상수·순수 헬퍼). 토큰 패턴인 feature는 구체 repository 클래스를 노출하지 않는다(계약 우회 경로가 된다). 노출 목록이 곧 공개 API이므로 새 export는 "밖에서 쓰는가"로 판단하고, 쓰는 곳이 사라지면 뺀다(`knip`이 미사용 export를 리포트한다). 밖에서 쓰이지 않는 feature(`core`·`dashboard`·`mypage`·`system`)는 배럴이 없고 `app.module`이 직접 경로로 import한다.

**왜.** NestJS 모듈의 진짜 경계는 `exports` 배열(런타임)이다. 배럴은 그 위의 컴파일타임 경계이고 둘은 일관돼야 한다. 배럴이 없는 feature에 배럴을 만들면 "누군가 써도 된다"는 신호가 된다.

**레이어.** `src/common`은 무의존(`@/features`·`@/global`·`@/prisma` 금지, `common/utils`는 DI-free 순수 함수), `src/global`은 `@/features`·`@/prisma`를 import하지 않는다. feature가 global에 무언가를 등록해야 하면(메트릭 게이지, outbox 소비자) **global이 등록 API를 제공하고 feature가 부른다**(`MetricsService.registerGauge`, `@SubscribeOutbox`). 순환은 `arch:check`(dependency-cruiser)가 잡고, `forwardRef`는 최후 수단이다.

---

## 3. Prisma 접근 경계와 soft-delete

**규칙.** `Resolver → Service → Repository → PrismaService`. Resolver·Service는 PrismaService·PrismaClient에 닿지 않는다(`arch:check`의 Prisma-ban). Prisma model 타입은 Resolver·Service에 노출하지 않고 `types/*-output.type.ts`로 매핑한다 — 단, 단순 pass-through 읽기까지 전면 매핑하는 것은 과설계이므로 trivial 엔티티는 row에 가까운 타입을 허용한다.

**왜.** 이것은 **프로젝트 컨벤션**이다(Prisma 공식 가이드는 서비스에 직접 주입한다). 테스트 seam과 ORM 변경으로부터의 격리를 산다.

**soft-delete.** Extension이 루트 READ 쿼리(`findFirst`·`findFirstOrThrow`·`findMany`·`count`·`aggregate`·`groupBy`)에만 `deleted_at: null`을 넣는다(대상 모델 목록은 dmmf 대조 spec이 스키마와 일치를 강제). **`findUnique`·`findUniqueOrThrow`는 필터 밖**이다(unique 조건에 다른 컬럼을 더할 수 없어 — 삭제된 행도 돌려준다). nested relation(`include`/`select` 안), relation 필터, mutation, raw SQL에도 닿지 않으므로 이런 자리에서는 `findFirst`로 바꾸거나 `@/prisma`의 `activeWhere`(활성)·`visibleWhere`(is_active 동반) 조각을 명시한다. 인라인 `deleted_at: null` 리터럴은 쓰지 않고, 루트 READ에는 중복 명시하지 않는다. 상위 엔티티의 활성 여부(리뷰 → 매장)까지 같은 조각으로 맞춘다. 탈퇴·삭제 사용자 데이터는 노출 전 익명화. 재시드 시 FK 위반이 없도록 `resetSeedScope` 범위를 함께 갱신한다.

---

## 4. 모델 소유권과 표시값 스냅샷

**규칙.** 모델마다 소유 feature가 하나다(`src/test/model-ownership.ts`가 정본). **write는 소유 feature 파일에서만** — `model-ownership.spec`이 예외 목록으로 강제하고, 목록은 늘리지 않는다. 경계를 넘는 read는 `read-boundary.spec` 허용 목록에만 둔다(항목마다 "왜 필요한지"와 나중에 포트로 바꿀 방식이 적혀 있다).

**왜.** 도메인 write가 여러 feature에 흩어지면 불변식이 깨지는 지점을 찾을 수 없고, 서비스 분리가 필요해지는 순간 옮길 수도 없다. 읽기 결합은 write보다 값싸므로 허용 목록으로 가시화만 한다.

**표시값 스냅샷.** 이력이 남아야 하는 표시값(주문 품목의 매장명·상품 썸네일, 리뷰가 참조하는 주문 품목, 알림의 본문)은 조회 시 조인이 아니라 **생성 시점에 복사한 컬럼**을 읽는다. 원본이 바뀌어도 주문·리뷰 화면은 그때 값을 유지해야 하고(도메인 요구), 조회 경로가 다른 feature의 테이블에 묶이지 않는다. 반대로 현재 값을 보여 줘야 하는 조회(찜 목록의 상품명·이미지·매장명, 리뷰 상세의 상품·매장)는 아직 조인하며, `read-boundary.spec`의 `display-nested` 허용 목록이 그 지점을 추적한다 — 새 조인을 늘리지 않고, 필요하면 스냅샷이나 포트로 옮긴다.

**감사 기록.** 관리자·판매자 조작의 감사 기록은 `audit-log` 포트를 통해 **도메인 write와 같은 트랜잭션**에서 남긴다 — 조작만 커밋되고 기록이 빠지는 상태를 타입·spec 수준에서 막는다(`audit-write-path.spec`). ip·ua는 repository가 요청 컨텍스트(ALS)에서 보강한다(§5).

---

## 5. 요청 컨텍스트 — AsyncLocalStorage

**규칙.** ip·User-Agent·`requestId` 같은 transport 메타데이터는 `RequestContextService`(ALS)로 전파한다. 도메인 메서드 시그니처에 threading하지 않는다. `RequestContextMiddleware`가 요청을 `run()`으로 감싼다(`enterWith` 금지).

**왜.** SoC — 감사 기록 repository가 사실상 단일 초크포인트라 거기서 읽는다. 호출처로 옮기면 ALS read가 다수 도메인 서비스로 번져 도입 취지에 역행한다. 로거도 같은 저장소에서 `requestId`·`eventId`를 읽어 매 로그 줄에 싣는다 — api(요청)와 worker(이벤트 소비)의 로그를 잇는 조인 키다(§7).

---

## 6. 에러 — 카탈로그 하나, 예외 클래스 하나

**규칙.** 도메인 오류는 `throw new DomainException('CODE')` 하나로 던진다. 코드·HTTP status·메시지(한국어, 파라미터가 있으면 함수형)는 `src/common/errors/error-catalog.ts`가 정본이고 **코드 1개 = status 1개**다. Nest 예외를 직접 생성하는 것은 ESLint가 막는다(예외: ValidationPipe의 `VALIDATION_FAILED` 매핑 1곳). 응답은 GraphQL `extensions.code`(카탈로그 코드)·`extensions.classification`(HTTP 분류), REST 봉투 `errorCode`. spec은 `toThrowDomain(status | 'CODE')`.

**왜.** FE는 메시지가 아니라 값으로 분기한다 — 도메인별 처리는 `extensions.code`(카탈로그 코드, `PASSWORD_CHANGE_REQUIRED` 같은 구체 값)로, 인증 만료·권한 같은 공통 처리는 `extensions.classification`으로. 코드가 status를 결정하므로 같은 상황이 화면마다 다른 status로 나가는 일이 없다.

---

## 7. 역할 분리와 이벤트 백본

### 역할

앱은 하나이고 `APP_ROLE`로 배선이 갈린다(`AppModule.forRole`, 역할은 토큰으로 봉인해 `configure()`가 env를 다시 읽지 않는다).

| 역할     | 싣는 것                                                                   | ready가 보는 것      |
| -------- | ------------------------------------------------------------------------- | -------------------- |
| `api`    | GraphQL·REST·문서·JWKS·메트릭                                             | MySQL·Redis          |
| `ws`     | api와 같음(Subscription 전용 분리는 FE가 쓰기 시작하면)                   | MySQL·Redis          |
| `worker` | outbox 릴레이·RabbitMQ 소비자 호스트·크론·블랙리스트 재구축·outbox 게이지 | MySQL·Redis·RabbitMQ |

**왜.** api는 브로커 장애 중에도 떠야 한다(주문은 outbox 테이블에만 쓴다). 전역 값(outbox 건수 게이지)은 worker만 노출한다 — api 복제본마다 노출하면 `sum()`이 부풀고 DB 쿼리가 N배다. `OUTBOX_DISPATCH_ENABLED`는 끄기만 가능하고 api에서 `true`를 줘도 켜지지 않는다(이중 전달 방지).

### outbox 계약

- **발행은 도메인 write와 같은 트랜잭션**(`OutboxPublisher.publish(tx, event)`). 커밋되지 않은 이벤트는 존재하지 않는다.
- 전달: outbox(PENDING) → 릴레이(worker, 파티션 안 id 순, publisher confirm을 받아야 PUBLISHED) → exchange `caquick.events`(topic, routing key = event_type) → 소비자마다 durable 큐 + retry 큐(per-message TTL) + DLQ, prefetch 1.
- **at-least-once. 소비자는 멱등이어야 한다**(`source_event_id` dedupe 등). 순서는 파티션 FIFO → 큐 FIFO이고 재시도로 뒤바뀔 수 있으므로 순서 민감 소비자는 원본 시각(watermark)으로 옛 이벤트를 버린다.
- 실패: 소비 실패 → retry(백오프) → 상한 초과 → DLQ + 경보. 릴레이 실패 → 백오프 → 상한 초과 → FAILED + 경보. 복구는 `yarn outbox:requeue`(`infra/runbook.md`). 깨진 본문은 재시도 없이 DLQ.
- 인프로세스 소비(`OutboxDispatcherService`·`drainOutbox`)는 **테스트 전용**이다 — DB만으로 도는 spec 수백 개가 그 위에 있다.

**왜.** 도메인 간 부수효과(알림 생성, 일일 한도 갱신)를 호출 체인으로 엮으면 write 소유권(§4)이 깨지고 장애가 전파된다. 브로커를 두면 소비자를 프로세스 밖으로 뺄 수 있고 재시도·DLQ가 표준화된다. 알려진 한계: retry 큐의 per-message TTL은 head-of-line 지연이 있다(#415).

### 로그 조인

발행 시점 로그가 `requestId`와 `eventId`를 함께 가지고, 소비 handle은 ALS `eventId`로 감싸므로 Loki에서 `{container=~"api|worker"} | json | eventId="…"`로 요청 → 이벤트 → 소비를 잇는다.

---

## 8. 인증·경보·메트릭 (횡단 관심사)

### 인증

- 액세스 토큰은 **RS256**, 공개키는 `/.well-known/jwks.json`(kid = RFC 7638 썸프린트). 서명·검증 키는 `authConfig` 하나가 해석한다(raw env 재파싱 금지).
- **정상 경로는 DB를 읽지 않는다.** 전략은 서명이 유효한 토큰의 클레임(role·mustChangePassword)을 신뢰한다.
- 정지·탈퇴·비밀번호 변경(관리자 초기화 포함)은 **트랜잭션 커밋 뒤** Redis 블랙리스트에 등록한다(`auth:blk:*`, 액세스 TTL만큼). 등록 실패는 던지지 않고 경보 + 완전성 표식 삭제 → 전략이 DB 폴백. worker가 60초마다 재구축·조정하고 표식을 세운다. Redis `maxmemory`가 있으면 `noeviction`이어야 한다(표식만 살아남는 축출 정책은 위험).
- 비밀번호 변경은 **자격증명 버전**(`password_updated_at`, ms)으로 가른다. 로그인은 비밀번호를 검증할 때 읽은 버전을 세션(`credential_version`)과 액세스 토큰(`cv`)에 싣고, 회전은 확인한 세션의 버전을 그대로 넘긴다. refresh는 세션 버전이 현재와 다르면 그 세션을 폐기하고 거절하며, 블랙리스트·DB 폴백은 `cv`가 변경 시각보다 작은 토큰을 막는다(`cv`가 없는 옛 토큰만 `iat` 초 비교). 그래서 변경 트랜잭션과 겹쳐 전 세션 폐기를 비껴간 로그인·회전도 살아남지 못한다.
- **왜 fail-open이 아닌가.** Redis 장애 때 "막지 못함"이 아니라 "DB로 다시 봄"이라 보안 후퇴가 없다. 대신 경보가 간다.

### 경보

`AlertService.notify({ level, title, detail, key })`가 운영 경보의 단일 출구다. **절대 던지지 않고** 결과(`sent | suppressed | skipped | failed`)만 돌려준다 — 경보 때문에 본 작업이 실패하면 안 된다. 같은 `key`는 억제 창(`ALERT_DEDUPE_WINDOW_MS`, 기본 5분) 안에서 1회. 웹훅 미설정이면 로그만. 부팅 실패는 DI가 없을 수 있어 전송 함수를 직접 부르고, 감독자의 동시 재시작에 대비해 호스트 잠금 파일(`BOOT_ALERT_STATE_DIR`, 700)로 억제한다. **사람이 개입해야 하는 상태만** 보낸다(outbox FAILED·DLQ·블랙리스트 폴백·브로커 blocked·부팅 실패). 재시도 중인 상태는 보내지 않는다.

### 메트릭

`prom-client` 레지스트리는 `MetricsService`(global)가 들고 `/metrics`는 Bearer `METRICS_ACCESS_TOKEN`(production 필수). HTTP 히스토그램은 인터셉터가 아니라 Express `finish`에서 잰다 — 가드 거절(401·403)·필터가 정한 최종 status·클라이언트 중단(`aborted`)까지 실제 값으로 잡힌다. route 라벨은 컨트롤러 패턴 또는 마운트 경로(`/graphql`)이고 미매칭은 `<unmatched>`(카디널리티 방어). feature의 게이지는 `registerGauge(collect)`로 등록하며 collect는 상한(2초) 안에 끝나야 한다 — 넘기면 값이 빠지고 `caquick_metrics_collect_errors_total`이 오른다.

---

## 9. 테스트 규약

**정상 경로의 저장소 동작은 mock하지 않는다.** `jest.global-setup`이 testcontainers로 MySQL 8 + Redis 7을 띄우고 마이그레이션을 적용한다. 예외는 **장애 주입**이다 — 건강한 컨테이너로는 낼 수 없는 실패(Redis 명령 오류, 쓰기 거부, 브로커 blocked)를 검증할 때는 그 실패만 내는 stub을 목적 한정으로 쓴다(`token-blacklist.service.spec`의 실패하는 Redis 클라이언트, `blacklist-rebuild.service.spec`의 선택 명령 교체). 정상 동작을 stub으로 대신하는 것은 여전히 금지다. RabbitMQ는 소비자 호스트 spec이 자체 컨테이너로 검증한다. mock이 통과해도 운영 마이그레이션이 깨지는 케이스(제약·cascade·soft-delete 주입·트랜잭션 격리)를 실제 의미론으로 잡기 위해서다.

**테스트 컨테이너.** 정의는 `src/test/containers.ts` 한 곳이다. 매 실행 새로 만들고 버리는 DB라 내구성(redo fsync·doublewrite·binlog)과 performance_schema를 끄고 datadir를 tmpfs에 두며, Redis는 영속화를 끈다. 운영 맥미니에서는 운영 컨테이너와 같은 Docker VM을 나눠 쓰므로 CPU·메모리 상한을 건다(tmpfs는 메모리 상한에 합산된다). 옵션이 조용히 무시되지 않았는지는 `containers.spec`이 실행 중인 서버 값(SHOW VARIABLES·CONFIG GET·docker inspect)으로 확인한다.

**계층.** `*.service.spec`(분기·예외, 주력) / `*.resolver.spec`(전체 경로 1~2케이스, 상단에 `분기/집계 세부 검증은 service.spec.ts에서 담당` 한 줄) / `*.repository.spec`(repo에서만 도달 가능한 계약) / `*.input.spec`·`*.helper.spec`(순수 단위) / `src/test/*.spec`(소유권·경계 read·감사 경로·역할 인가 커버리지·모듈 배선 게이트) / `scripts/*.spec`(compose 렌더링·백업 복구·배포 워크플로·관측 설정·빌드 설정, `jest.scripts.config.js`).

**DB spec 뼈대.** `describe` 제목에 `(real DB)`, `createTestingModuleWithRealDb({ providers })`, `afterAll`에 `closeTruncateConnection()`·`disconnectTestPrismaClient()`, `beforeEach`에 `truncateAll()`. 데이터는 `@/test/factories`의 팩토리로 **필요한 필드만 override**(나머지는 `nextSeq()` 기본값). 반복 셋업·검증은 `describe` 안 로컬 헬퍼로, 검증 헬퍼는 prisma로 직접 조회. `describe`는 클래스/메서드 단위, `it`은 한국어 평서형(`'soft-delete된 찜은 복원한다'`). 시간·랜덤·네트워크는 `ClockService`·`IdGeneratorService`·전송 함수 주입으로 통제한다.

**반증이 본체.** 검사기·게이트·가드는 "막아야 할 것을 실제로 막는지"가 테스트다 — 현재 코드에서 통과하는 것은 오탐이 없다는 뜻일 뿐이다. 입력 공간이 열거 가능하면(SDL 자리, 상태 전이, 에러 종류) `it.each` 전수 표로 고정한다. 일회성 검증 스크립트도 "0건"을 믿기 전에 대상 수를 찍고 일부러 걸리는 항목을 넣어 본다. 로그·API 응답은 필터 전 원본을 먼저 본다.

**정합성 도구.** `yarn validate:push`(Husky pre-push) = lint → tsc → `dto:check`(SDL input ↔ DTO 필드 일치. DTO 없는 input은 기본 lenient 모드에서 정보만, `--strict`에서 오류) → `docs:check`(SDL description 커버리지 — 자명한 필드 `id`·`createdAt`류·`*Id`/`*Ids`는 제외, 임계는 현재 달성치로 고정해 회귀만 차단) → `arch:check`(순환·Prisma-ban·레이어) → `test:scripts:push` → `test:push`. 정적 검사는 전부 돌고, `test:scripts`(scripts/*.spec)는 그 입력(`scripts/**`·`infra/**`·`.github/**`·`.husky/**`·도커 파일·jest 설정·의존성·`tsconfig*.json`)이 바뀌었을 때만 돈다(CI `scripts` 잡은 항상). jest 범위만 `scripts/pre-push-test-plan.ts`가 기준 커밋(`origin/develop` merge-base, 없으면 `origin/main`, `PRE_PUSH_BASE`로 지정) 대비 작업 트리 변경으로 고른다(`yarn test:push --dry-run`으로 미리 본다).

- **related**: `src/**/*.ts`만 바뀌면 `jest --findRelatedTests`로 그 파일을 import 그래프로 끌어오는 spec만 돈다. 소스를 파일로 읽어 검사하는 게이트 spec(`src/test/*.spec`, `fs`를 import하는 spec — 모델 소유권·경계 read·잠금 순서 등)은 그래프로 이어지지 않으므로 항상 붙인다.
- **full**: 그래프가 못 보는 변경은 전체로 되돌린다. SDL(`*.graphql`, 스키마로 로드), `prisma/**`·`prisma.config.ts`, 테스트 인프라(`src/test/**`·`test/**`), `jest.config.js`, `package.json`(의존성·스크립트), 의존성(`yarn.lock`·`.yarnrc.yml`·`.yarn/**`), `tsconfig*.json`, 전역 배선(`src/config`·`src/global`·`app.module`·`main` — 모듈 배선 spec 전반에 닿는다), src `.ts` 삭제·이름 변경(없어진 모듈의 사용처는 역추적할 수 없다), src 변경 40개 초과, 분류 목록에 없는 파일(`.gitignore`·`nest-cli.json`은 `build-config.spec`이 읽는다), 기준 커밋 해석 실패.
- **none**: 문서·`.github`·`infra`·`terraform`·도커·정적 검사 설정(`.dependency-cruiser.cjs`는 `arch:check`가 이미 돈다)·`scripts/**`(`test:scripts`가 전부 돌리고, src는 scripts를 import하지 않는다).
- 커버리지는 로컬에서 재지 않는다. 부분 실행의 커버리지는 임계와 비교할 수 없어서다. 같은 이유로 CI도 jest를 샤드로 나눠 돌리되 샤드별 임계는 끄고(`'--coverageThreshold={}'`), `coverage-report` 잡이 샤드 결과를 합쳐(`scripts/merge-coverage.ts`) `jest.config.js`의 임계(statements 96 / branches 86 / functions 92 / lines 96)로 검사한다. 테스트 실패·샤드 누락·임계 미달이면 실패하고, 필수 체크 `check`가 이 결과를 모은다. `yarn validate`(정적 검사 → `test:cov`)는 수동 전체 검증용으로 남는다.
- ts-jest 변환 모드는 커버리지 여부로 갈린다(`jest.config.js`). `--coverage` 실행만 LanguageService 모드(`isolatedModules:false`)다 — transpile 모드의 데코레이터 메타데이터 가드식이 분기로 잡혀 branches 임계가 깨지기 때문이다. 나머지는 transpile 모드로, 파일별 타입 검사와 전이 의존 mtime 캐시 키가 없어 콜드 실행이 3배 이상 빠르다. 타입 오류는 jest가 아니라 `tsc --noEmit`(validate:push·CI)이 잡는다.

CI `check` 잡은 정적 검사를 개별 스텝으로 돌리되 `dto:check`는 `--warning`(이관 중이라 경고만)이라, `git push --no-verify`로 pre-push를 건너뛰면 SDL↔DTO 드리프트가 CI를 통과할 수 있다 — pre-push를 우회하지 않는 것이 규칙이다. `knip`(dead code)·`nestjs-doctor`는 PR 코멘트만(advisory, 오탐 있음).

**운영 호스트 보호.** 개발 머신이 운영 맥미니를 겸하고, testcontainers(MySQL·Redis)가 운영 컨테이너와 같은 OrbStack VM(4CPU·8GB)을 나눠 쓴다. 전체 jest(330스위트, 실DB 145개)를 pre-push마다 돌리던 시절 한 번에 5.7~12.7분이 걸렸고, 그동안 운영 응답이 느려지고 부하성 간헐 실패가 났다. 그래서 pre-push는 위처럼 범위를 좁히고 전체는 CI에 맡긴다. 맥미니에서 전체 테스트(`yarn validate`·`yarn test:cov`·경로 없는 `yarn test`)를 돌려야 하면 **한 번에 하나만** 돌린다(여러 세션·에이전트가 동시에 띄우지 않는다). jest는 globalSetup에서 호스트 락(127.0.0.1:47391 포트를 여는 것, 프로세스가 죽으면 OS가 푼다)을 잡아 같은 호스트의 실행을 하나로 줄 세우고, 로컬 워커는 4개로 제한한다(`jest.config.js`, 실측 근거는 주석). CI와 watch 모드는 락을 잡지 않는다. 부하 중에 난 간헐 실패는 결함으로 단정하기 전에 단독 재실행으로 확인한다. supertest로 부르는 앱은 `listenOnLoopback`(`src/test/http-app.ts`)으로 127.0.0.1에 먼저 연다 — 와일드카드로 열면 macOS에서 다른 프로세스가 같은 포트를 127.0.0.1로 잡아 응답을 가로챈다(`http-app.spec`이 반증과 사용처 전수를 고정).

---

## 출처

- NestJS modules / custom providers / testing: https://docs.nestjs.com/modules · https://docs.nestjs.com/fundamentals/custom-providers · https://docs.nestjs.com/fundamentals/testing
- NestJS ALS recipe: https://docs.nestjs.com/recipes/async-local-storage
- abstract class 토큰(DIP): https://trilon.io/blog/dependency-inversion-principle
- Prisma + NestJS(서비스 직접 주입 idiom): https://www.prisma.io/docs/guides/frameworks/nestjs
- Transactional outbox: https://microservices.io/patterns/data/transactional-outbox.html
- RabbitMQ dead lettering / TTL: https://www.rabbitmq.com/docs/dlx · https://www.rabbitmq.com/docs/ttl
- YAGNI / speculative generality: https://martinfowler.com/bliki/Yagni.html
