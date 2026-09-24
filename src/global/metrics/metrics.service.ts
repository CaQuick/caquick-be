import { Injectable, Logger } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

import { withTimeout } from '@/common/utils/with-timeout';

const SECONDS_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];
/** 스크레이프 때 도는 collect의 상한 — DB가 느려도 /metrics가 scrape_timeout(기본 10초)에 끌려가지 않게. */
export const COLLECT_TIMEOUT_MS = 2_000;

/**
 * Prometheus 지표의 단일 레지스트리(P2 E8·05). 요청·소비 히스토그램은 여기서 정의하고, feature 쪽 게이지(outbox 수 등)는
 * registerGauge로 collect 콜백을 등록한다 — global은 feature를 import하지 않는다.
 * 라벨은 카디널리티가 유한한 것만 — 스키마·라우터가 정하는 값(라우트 패턴·루트 필드명·상태 코드·분류). 클라이언트가 정하는
 * 값(operationName·id·쿼리스트링)은 절대 라벨로 쓰지 않는다.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();
  /** spec이 줄여 쓴다 */
  collectTimeoutMs = COLLECT_TIMEOUT_MS;

  /** 관측은 Express 'finish'에서(HttpMetricsMiddleware) — 가드 거절·필터가 정한 최종 상태·404까지 실제 상태 코드로 잡힌다. */
  readonly httpRequestDuration = new Histogram({
    name: 'caquick_http_request_duration_seconds',
    help: 'HTTP 요청 처리 시간(초). route는 라우트 패턴, 매칭 전은 <unmatched>.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: SECONDS_BUCKETS,
    registers: [this.registry],
  });

  /** 관측 단위는 루트 필드(리졸버 1회). 성공은 인터셉터, 실패는 예외 필터가 outcome=분류로 센다. */
  readonly graphqlRootFieldDuration = new Histogram({
    name: 'caquick_graphql_root_field_duration_seconds',
    help: 'GraphQL 루트 필드(Query·Mutation) 처리 시간(초). outcome = ok | 오류 분류.',
    labelNames: ['type', 'field', 'outcome'] as const,
    buckets: SECONDS_BUCKETS,
    registers: [this.registry],
  });

  readonly outboxConsumeDuration = new Histogram({
    name: 'caquick_outbox_consume_duration_seconds',
    help: 'outbox 소비자 handle 처리 시간(초). result = ok|retry|dlq.',
    labelNames: ['consumer', 'result'] as const,
    buckets: SECONDS_BUCKETS,
    registers: [this.registry],
  });

  /** collect 실패는 /metrics를 죽이지 않고 여기에 쌓인다 — 장애 중에도 나머지 지표는 나가야 한다. */
  readonly collectErrors = new Counter({
    name: 'caquick_metrics_collect_errors_total',
    help: '스크레이프 때 게이지 collect가 실패(예외·시간 초과)한 횟수.',
    labelNames: ['gauge'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'caquick_' });
  }

  /**
   * 스크레이프 때 값을 계산하는 게이지 — 카운트 쿼리 같은 비용은 스크레이프 주기에만 든다.
   * collect가 던지거나 상한을 넘기면 값을 비우고(옛 값 노출 금지) 오류 카운터만 올린다 — 절대 throw하지 않는다.
   */
  registerGauge<L extends string>(args: {
    name: string;
    help: string;
    labelNames?: readonly L[];
    collect: (gauge: Gauge<L>) => Promise<void> | void;
  }): Gauge<L> {
    const labelNames = args.labelNames ?? [];
    const gauge: Gauge<L> = new Gauge<L>({
      name: args.name,
      help: args.help,
      labelNames,
      registers: [this.registry],
      collect: async () => {
        try {
          await withTimeout(
            Promise.resolve(args.collect(gauge)),
            this.collectTimeoutMs,
            `${args.name} collect`,
          );
        } catch (error) {
          // 옛 값을 내보내지 않는다. 라벨 게이지는 샘플이 사라지고, 라벨 없는 게이지는 NaN(=모름) — 0으로 읽히면 안 된다
          gauge.reset();
          if (labelNames.length === 0) gauge.set(Number.NaN);
          this.collectErrors.inc({ gauge: args.name });
          this.logger.warn(
            `${args.name} collect 실패 — 값 없이 노출: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    });
    return gauge;
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  text(): Promise<string> {
    return this.registry.metrics();
  }
}
