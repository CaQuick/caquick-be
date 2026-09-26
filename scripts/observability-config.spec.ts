import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

// 관측 설정 유효성: 실제 도구로 검사한다 — promtool(Prometheus), alloy validate, Grafana를 띄워 프로비저닝(규칙·접점·대시보드)이 읽히는지.
const INFRA = join(__dirname, '..', 'infra');
const PROM = 'prom/prometheus:v3.5.0';
const ALLOY = 'grafana/alloy:v1.10.0';
const GRAFANA = 'grafana/grafana:12.1.1';
const ID = `caquick-obs-${process.pid}-${Date.now().toString(36)}`;

jest.setTimeout(180_000);

function docker(args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('infra/prometheus/prometheus.yml', () => {
  it('promtool check config 통과(토큰 파일은 compose secret 자리에 가짜로)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caquick-prom-'));
    writeFileSync(join(dir, 'metrics_token'), 'x');
    const out = docker([
      'run',
      '--rm',
      '-v',
      `${join(INFRA, 'prometheus', 'prometheus.yml')}:/p.yml:ro`,
      '-v',
      `${join(dir, 'metrics_token')}:/run/secrets/metrics_token:ro`,
      '--entrypoint',
      'promtool',
      PROM,
      'check',
      'config',
      '/p.yml',
    ]);
    expect(out).toContain('SUCCESS');
  });

  it('스크레이프 잡 → 타깃 표(파싱본) — 호스트·포트가 바뀌면 여기도 바꿔야 한다', () => {
    const config = parse(
      readFileSync(join(INFRA, 'prometheus', 'prometheus.yml'), 'utf8'),
    ) as {
      scrape_configs: Array<{
        job_name: string;
        static_configs: Array<{ targets: string[] }>;
      }>;
    };
    const table = Object.fromEntries(
      config.scrape_configs.map((j) => [
        j.job_name,
        j.static_configs.flatMap((c) => c.targets),
      ]),
    );
    expect(table).toEqual({
      'caquick-app': ['api:4000', 'worker:4000'],
      rabbitmq: ['rabbitmq:15692'],
      mysqld: ['mysqld-exporter:9104'],
      redis: ['redis-exporter:9121'],
      alloy: ['alloy:12345'],
      loki: ['loki:3100'],
      prometheus: ['localhost:9090'],
    });
    // RabbitMQ 기본 /metrics는 집계본(queue 라벨 없음) — per-object 설정 파일이 compose에 마운트된다
    expect(
      readFileSync(join(INFRA, 'rabbitmq', '20-prometheus.conf'), 'utf8'),
    ).toContain('prometheus.return_per_object_metrics = true');
  });
});

describe('infra/alloy/config.alloy', () => {
  it('alloy validate 통과 — 로그(Loki)·cAdvisor(remote write) 파이프라인', () => {
    expect(() =>
      docker([
        'run',
        '--rm',
        '-v',
        `${join(INFRA, 'alloy', 'config.alloy')}:/c.alloy:ro`,
        ALLOY,
        'validate',
        '/c.alloy',
      ]),
    ).not.toThrow();
  });

  it('반증: 없는 컴포넌트를 쓴 설정은 validate가 잡는다 — 문법이 맞아도 그래프 평가에서 걸린다(인자 타입 오류·잘못된 forward_to는 validate가 못 잡는다: 실측)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caquick-alloy-'));
    writeFileSync(
      join(dir, 'bad.alloy'),
      'loki.wrte "x" {\n  endpoint { url = "http://l:3100" }\n}\n',
    );
    expect(() =>
      docker([
        'run',
        '--rm',
        '-v',
        `${join(dir, 'bad.alloy')}:/c.alloy:ro`,
        ALLOY,
        'validate',
        '/c.alloy',
      ]),
    ).toThrow();
  });
});

describe('infra/grafana/provisioning (실제 Grafana)', () => {
  const name = `${ID}-grafana`;
  const port = 3000 + (process.pid % 1000) + 10_000;
  const api = (path: string) =>
    JSON.parse(
      execFileSync(
        'curl',
        ['-sS', '-u', 'admin:test', `http://127.0.0.1:${port}${path}`],
        { encoding: 'utf8' },
      ),
    ) as unknown;

  beforeAll(async () => {
    docker([
      'run',
      '-d',
      '--name',
      name,
      '-p',
      `127.0.0.1:${port}:3000`,
      '-e',
      'GF_SECURITY_ADMIN_PASSWORD=test',
      '-e',
      'DISCORD_ALERT_WEBHOOK_URL=https://discord.test/hook',
      '-v',
      `${join(INFRA, 'grafana', 'provisioning')}:/etc/grafana/provisioning:ro`,
      '-v',
      `${join(INFRA, 'grafana', 'dashboards')}:/var/lib/grafana/dashboards:ro`,
      GRAFANA,
    ]);
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        const health = api('/api/health') as { database?: string };
        if (health.database === 'ok') break;
      } catch {
        /* 아직 */
      }
      if (Date.now() > deadline)
        throw new Error(
          `grafana가 뜨지 않는다: ${docker(['logs', '--tail', '20', name])}`,
        );
      await new Promise((r) => setTimeout(r, 2_000));
    }
    // 프로비저닝은 기동 직후 비동기로 읽힌다
    await new Promise((r) => setTimeout(r, 5_000));
  });
  afterAll(() => {
    try {
      docker(['rm', '-f', name]);
    } catch {
      /* 이미 없음 */
    }
  });

  it('경보 규칙 8개·Discord 접점(웹훅은 env에서)·정책이 읽힌다', () => {
    const rules = api('/api/v1/provisioning/alert-rules') as Array<{
      title: string;
      for: string;
    }>;
    expect(rules.map((r) => r.title).sort()).toEqual(
      [
        'ScrapeDown',
        'ExporterBackendDown',
        'ContainerMetricsMissing',
        'ContainerMemoryHigh',
        'RedisMemoryHigh',
        'OutboxFailed',
        'RabbitDlqNotEmpty',
        'RabbitQueueBacklog',
      ].sort(),
    );
    const points = api('/api/v1/provisioning/contact-points') as Array<{
      name: string;
      type: string;
      settings: { url?: string };
    }>;
    const discord = points.find((p) => p.name === 'discord');
    expect(discord?.type).toBe('discord');
    // 웹훅은 secure 설정이라 API가 가린다 — 값이 있어야(env 치환 성공) 접점이 만들어진다(비면 프로비저닝 오류로 접점 자체가 없다)
    expect(discord?.settings.url).toBe('[REDACTED]');
    const policy = api('/api/v1/provisioning/policies') as { receiver: string };
    expect(policy.receiver).toBe('discord');
  });

  // 프로비저닝은 PromQL·임계값 방향을 검사하지 않는다 — "up == 0"이 값 0을 남겨 "> 0"이 영영 참이 안 되는 식이 그대로 실려 있었다(Opus 리뷰).
  // 규칙마다 식·for·임계값·데이터소스를 표로 고정한다
  it.each([
    ['ScrapeDown', 'count by (job, role) (up == 0)', '3m'],
    ['ExporterBackendDown', 'sum(1 - mysql_up) + sum(1 - redis_up)', '3m'],
    [
      'ContainerMetricsMissing',
      'absent(container_memory_working_set_bytes{job="cadvisor"})',
      '5m',
    ],
    [
      'RabbitQueueBacklog',
      'sum by (queue) (rabbitmq_queue_messages_ready{queue!~".*\\\\.(retry|dlq)$"}) > 500',
      '5m',
    ],
    [
      'ContainerMemoryHigh',
      'max by (service) (container_memory_working_set_bytes{job="cadvisor"} / (container_spec_memory_limit_bytes{job="cadvisor"} > 0)) > 0.9',
      '10m',
    ],
    [
      'RedisMemoryHigh',
      'redis_memory_used_bytes / (redis_memory_max_bytes > 0) > 0.9',
      '5m',
    ],
    ['OutboxFailed', 'max(caquick_outbox_events{status="FAILED"}) > 0', '1m'],
    [
      'RabbitDlqNotEmpty',
      'sum by (queue) (rabbitmq_queue_messages{queue=~".*\\\\.dlq$"}) > 0',
      '1m',
    ],
  ])(
    '규칙 %s — 식·for·임계값(> 0)·Prometheus 데이터소스',
    (title, expr, forDuration) => {
      const rules = api('/api/v1/provisioning/alert-rules') as Array<{
        title: string;
        for: string;
        condition: string;
        data: Array<{
          refId: string;
          datasourceUid: string;
          model: {
            expr?: string;
            conditions?: Array<{
              evaluator: { type: string; params: number[] };
            }>;
          };
        }>;
      }>;
      const rule = rules.find((r) => r.title === title);
      expect(rule?.for).toBe(forDuration);
      const query = rule?.data.find((d) => d.refId === 'A');
      expect(query?.datasourceUid).toBe('prometheus');
      expect(query?.model.expr).toBe(expr);
      const cond = rule?.data.find((d) => d.refId === rule.condition);
      expect(cond?.model.conditions?.[0].evaluator).toEqual({
        type: 'gt',
        params: [0],
      });
    },
  );

  it('반증: 웹훅 env가 비면 Grafana가 프로비저닝 실패로 종료한다(실기동) — compose는 닿지 않는 자리표시자를 기본값으로 주고, 배포 잡은 값을 요구한다', () => {
    const compose = readFileSync(join(INFRA, 'compose.yml'), 'utf8');
    expect(compose).toContain(
      'DISCORD_ALERT_WEBHOOK_URL: ${DISCORD_ALERT_WEBHOOK_URL:-http://alerts-unset.invalid/}',
    );
    const empty = `${name}-empty`;
    docker([
      'run',
      '-d',
      '--name',
      empty,
      '-e',
      'GF_SECURITY_ADMIN_PASSWORD=test',
      '-e',
      'DISCORD_ALERT_WEBHOOK_URL=',
      '-v',
      `${join(INFRA, 'grafana', 'provisioning')}:/etc/grafana/provisioning:ro`,
      GRAFANA,
    ]);
    try {
      const code = execFileSync('docker', ['wait', empty], {
        encoding: 'utf8',
        timeout: 60_000,
      }).trim();
      expect(code).not.toBe('0');
      expect(
        execFileSync('docker', ['logs', empty], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ).toContain('webhook url');
    } finally {
      try {
        docker(['rm', '-f', empty]);
      } catch {
        /* 이미 없음 */
      }
    }
  });

  it('대시보드 2개(앱·자원)와 데이터소스 2개(Prometheus·Loki)가 읽힌다', () => {
    const dashboards = api('/api/search?type=dash-db') as Array<{
      uid: string;
    }>;
    expect(dashboards.map((d) => d.uid).sort()).toEqual([
      'caquick-app',
      'caquick-resources',
    ]);
    const sources = api('/api/datasources') as Array<{ uid: string }>;
    expect(sources.map((d) => d.uid).sort()).toEqual(['loki', 'prometheus']);
  });
});
