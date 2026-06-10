# 아키텍처 컨벤션

NestJS 표준·아키텍처 정합성 리뷰(공식 문서 대조)의 결론을 팀 공유 규칙으로 명문화한 문서입니다.
"왜 이 구조인가"를 기록해, 동일 판단을 매번 반복하거나 잘못 cargo-cult 하지 않도록 합니다.

> 핵심 원칙: **"최적"은 단일 정답이 아니라 제약(단일 구현 여부·변경 빈도·경계)에 따른 의도적 선택이다.** 각 규칙은 trade-off와 근거를 함께 둔다.

---

## 1. 의존성 주입 — 토큰/인터페이스 vs 구체 클래스

**기본값: 구체 클래스 주입.** 단일 구현 내부 협력자는 토큰/인터페이스 없이 구체 클래스로 주입한다.
NestJS DI는 클래스 토큰도 `Test.overrideProvider(Class).useValue(mock)`로 mock 가능하므로 **테스트 용이성은 토큰 도입 근거가 아니다.**

**토큰(또는 abstract class) 도입 기준 — 아래 중 하나일 때만:**
- (a) 2번째 구현이 현실적으로 예상됨
- (b) 외부 부수효과 어댑터(mailer, OIDC client, clock 등)로 테스트에서 stub이 필요
- (c) 여러 feature에 광범위하게 주입되는 cross-cutting 포트

**적용 예:**
- `audit-log` → 기준 (c). 여러 feature가 주입하는 cross-cutting 감사 포트 → `AUDIT_LOG_REPOSITORY`(Symbol) + `IAuditLogRepository`.
- `product` / `order` / `conversation` → 단일 도메인 데이터 repo, 단일 구현 → **구체 클래스 주입**(토큰 불필요).

**신규 토큰을 만들 때:** `Symbol + interface`보다 **abstract class를 토큰으로** 선호한다 — 런타임에 존재하고 `@Inject()` 없이 타입으로 주입되며 계약+mock을 모두 제공한다.

> 근거: YAGNI / "speculative generality"(Fowler) — 아직 없는 유연성을 위한 전면 추상화는 지양. 전 repository에 1:1 인터페이스를 강제하면 lockstep 유지 비용만 늘고 사는 게 없다.

---

## 2. feature 배럴(`index.ts`) = 공개 API

- **cross-feature import는 대상 feature의 `index.ts`로만** 한다 (ESLint `boundaries`로 강제). 다른 feature의 내부 파일 직접 import 금지.
- 배럴이 노출하는 것: `Module` + (토큰 패턴이면) `토큰`·`인터페이스 타입` + (구체 주입이면) `구체 repo 클래스`.
- **토큰 패턴인 feature는 구체 repository 클래스를 배럴로 노출하지 않는다** — 토큰 계약을 우회하는 import 경로가 생기기 때문(누출). 구체 클래스는 모듈 `providers` 안에만 둔다.
- cross-feature로 쓰이지 않는 feature(예: `auth`, `system`, `seller`, `user`)는 배럴(`index.ts`)을 두지 않는다 — app.module이 모듈을 직접 경로로 import.

> NestJS 모듈의 진짜 경계는 `exports` 배열(런타임 캡슐화)이다. 배럴은 그 위에 더해진 컴파일타임 import-path 경계이며, 둘은 일관돼야 한다.

---

## 3. Prisma 접근 경계

- 호출 사슬: `Resolver → Service → Repository → PrismaService`. **Resolver/Service의 PrismaService 직접 접근 금지, Repository 경유 필수.**
- 이는 **프로젝트 컨벤션**이다(보편 best practice가 아님). Prisma 공식 가이드는 서비스에 PrismaService를 직접 주입하므로, 우리 규칙이 더 엄격하다. 근거: 테스트 seam 확보 + ORM 변경으로부터 비즈니스 로직 격리.
- Prisma model 타입을 Resolver/Service에 직접 노출 금지 → 도메인 모델/DTO로 매핑.
- **DTO 매핑 과설계 경계:** 집계/불변식이 있는 aggregate에는 도메인 모델 매핑이 가치 있으나, 단순 pass-through CRUD 읽기에 전면 매핑은 보일러플레이트다. 매핑 비용이 가치를 초과하면 trivial 엔티티는 Prisma row에 구조적으로 근접한 타입을 허용한다.

---

## 4. 요청 컨텍스트(transport metadata)

- IP/User-Agent 같은 transport 메타데이터는 **AsyncLocalStorage**(`RequestContextService`)로 전파한다. 도메인 메서드 시그니처에 threading 금지(SoC).
- `RequestContextMiddleware`가 요청을 `requestContext.run({...}, next)`로 감싼다(안전한 `run()`, `enterWith` 금지).
- `audit-log` repository가 persist 시 ctx에서 ip/ua를 보강한다(명시 인자 `args.ipAddress ?? ctx?.clientIp`가 우선). repository가 감사 기록의 사실상 단일 초크포인트이므로 여기서 읽는다 — 호출처로 옮기면 ALS read가 다수 도메인 서비스로 번져 ALS 도입 취지에 역행한다.

> NestJS 공식 ALS recipe와 일치. `@nestjs/graphql >= 10`에서 표준 middleware 경로가 지원되므로 별도 처리 불필요.

---

## 5. 정합성 점검 도구

위 규칙의 회귀를 막기 위한 도구. **로컬 게이트 + PR 코멘트** 2단으로 운영한다.

- **dependency-cruiser (게이트):** `yarn arch:check` — `yarn validate`(Husky pre-push) **및 CI `check` 잡**(`pr-check.yml`) 양쪽에 편입. `.dependency-cruiser.cjs`가 순환 금지 + **Resolver/Service→Prisma 직접 접근 금지(Prisma-ban)** + 레이어 방향을 강제. 위반 시 push/CI 실패. (현재 0 위반)
- **knip (비차단 리포트):** `yarn knip`(로컬) + **PR마다 자동 코멘트**(`.github/workflows/knip.yml`). 미사용 파일/export/의존성(dead code) 청소 후보 가시화. 게이트 아님(머지 차단 X). 일부는 오탐일 수 있음(class-validator constraint는 데코레이터로 등록돼 "미사용"으로 보일 수 있음, eslint flat-config 전용 deps 등) — 참고용으로만.
- **nestjs-doctor (PR 코멘트, advisory):** `.github/workflows/nestjs-doctor.yml`이 PR마다 점수/요약을 코멘트. **필수 status check 아님 → 머지 차단 안 함.** pre-1.0이라 룰 오탐이 있을 수 있고(위 §1~4의 의도된 패턴을 "문제"로 표시), 점수 추종 대상이 아니라 체크리스트로 본다.

---

## 출처 (공식 문서·근거)

- NestJS modules / custom providers / testing: https://docs.nestjs.com/modules · https://docs.nestjs.com/fundamentals/custom-providers · https://docs.nestjs.com/fundamentals/testing
- NestJS ALS recipe / injection scopes: https://docs.nestjs.com/recipes/async-local-storage · https://docs.nestjs.com/fundamentals/injection-scopes
- abstract class 토큰(DIP): https://trilon.io/blog/dependency-inversion-principle
- Prisma + NestJS(서비스 직접 주입 idiom): https://www.prisma.io/docs/guides/frameworks/nestjs
- YAGNI / speculative generality: https://martinfowler.com/bliki/Yagni.html
