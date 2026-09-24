import { Logger } from '@nestjs/common';

import {
  COLLECT_TIMEOUT_MS,
  MetricsService,
} from '@/global/metrics/metrics.service';

describe('MetricsService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  // 지표 이름·라벨 전수 — 대시보드·경보 규칙(09)이 참조한다. 이름이나 라벨이 바뀌면 여기서 드러난다.
  it.each([
    ['caquick_http_request_duration_seconds', ['method', 'route', 'status']],
    [
      'caquick_graphql_root_field_duration_seconds',
      ['type', 'field', 'outcome'],
    ],
    ['caquick_outbox_consume_duration_seconds', ['consumer', 'result']],
    ['caquick_metrics_collect_errors_total', ['gauge']],
    ['caquick_process_cpu_seconds_total', []],
    ['caquick_nodejs_heap_size_used_bytes', []],
  ])('%s 지표가 라벨 %j로 등록돼 있다', async (name, labels) => {
    const metrics = new MetricsService();
    const metric = (await metrics.registry.getMetricsAsJSON()).find(
      (m) => m.name === name,
    );
    expect(metric).toBeDefined();
    expect(metrics.registry.getSingleMetric(name)).toBeDefined();
    const labelNames = (
      metrics.registry.getSingleMetric(name) as unknown as {
        labelNames?: string[];
      }
    ).labelNames;
    if (labels.length > 0) expect(labelNames).toEqual(labels);
  });

  it('registerGauge의 collect는 스크레이프 때만 불리고 그 값이 노출된다', async () => {
    const metrics = new MetricsService();
    const collect = jest.fn(
      (gauge: { set: (l: { status: string }, v: number) => void }) => {
        gauge.set({ status: 'PENDING' }, 3);
      },
    );
    metrics.registerGauge({
      name: 'caquick_test_events',
      help: 't',
      labelNames: ['status'] as const,
      collect,
    });
    expect(collect).not.toHaveBeenCalled();

    const text = await metrics.text();

    expect(collect).toHaveBeenCalledTimes(1);
    expect(text).toContain('caquick_test_events{status="PENDING"} 3');
    expect(metrics.contentType).toContain('text/plain');
  });

  // DB가 죽으면 정확히 그때 지표가 필요하다 — collect 하나가 /metrics 전체를 500으로 만들면 안 된다
  it('반증: collect가 던져도 text()는 나머지 지표를 돌려주고, 그 게이지는 값을 비우며, 오류 카운터가 오른다', async () => {
    const metrics = new MetricsService();
    metrics.httpRequestDuration.observe(
      { method: 'GET', route: '/x', status: '200' },
      0.01,
    );
    let fail = true;
    metrics.registerGauge({
      name: 'caquick_test_flaky',
      help: 't',
      collect: (gauge) => {
        if (fail) throw new Error('DB down');
        gauge.set(7);
      },
    });

    const text = await metrics.text();

    expect(text).toContain('caquick_http_request_duration_seconds_count');
    expect(text).toMatch(/^caquick_test_flaky Nan$/im); // 모름(NaN) — 0으로 읽히지 않는다

    // 오류 카운터는 같은 스크레이프 안에서 먼저 스냅샷될 수 있어 다음 스크레이프에 보인다
    fail = false;
    const next = await metrics.text();
    expect(next).toContain(
      'caquick_metrics_collect_errors_total{gauge="caquick_test_flaky"} 1',
    );
    expect(next).toContain('caquick_test_flaky 7');
  });

  it('반증: collect가 상한을 넘기면 끊고 오류로 센다 — 스크레이프가 DB 지연에 끌려가지 않는다', async () => {
    const metrics = new MetricsService();
    metrics.collectTimeoutMs = 20;
    let slow = true;
    let resolveLater: () => void = () => undefined;
    metrics.registerGauge({
      name: 'caquick_test_slow',
      help: 't',
      collect: (gauge) => {
        if (!slow) {
          gauge.set(1);
          return;
        }
        return new Promise<void>((resolve) => {
          resolveLater = resolve;
        });
      },
    });

    const started = Date.now();
    await metrics.text();
    expect(Date.now() - started).toBeLessThan(1_000);
    resolveLater();

    slow = false;
    expect(await metrics.text()).toContain(
      'caquick_metrics_collect_errors_total{gauge="caquick_test_slow"} 1',
    );
    expect(COLLECT_TIMEOUT_MS).toBe(2_000);
  });

  it('히스토그램 관측이 라벨과 함께 노출된다(_count·_sum)', async () => {
    const metrics = new MetricsService();
    metrics.httpRequestDuration.observe(
      { method: 'GET', route: '/health/ready', status: '200' },
      0.25,
    );
    const text = await metrics.text();
    expect(text).toContain(
      'caquick_http_request_duration_seconds_count{method="GET",route="/health/ready",status="200"} 1',
    );
    expect(text).toContain(
      'caquick_http_request_duration_seconds_sum{method="GET",route="/health/ready",status="200"} 0.25',
    );
  });
});
