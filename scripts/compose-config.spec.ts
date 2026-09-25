import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 운영 compose(infra/compose.yml)가 렌더링되는지와, 운영에서 어겨서는 안 되는 형태를 고정한다(P2-06).
// docker compose config로 실제 파서를 태운다 — 손으로 YAML을 읽는 검사는 anchor·프로필·보간을 못 본다.
const ROOT = join(__dirname, '..');
const COMPOSE = join(ROOT, 'infra', 'compose.yml');
const PROFILES = ['edge', 'observability', 'migrate'];

interface Service {
  image?: string;
  build?: unknown;
  restart?: string;
  mem_limit?: string | number;
  ports?: Array<{ published?: string | number; host_ip?: string }>;
  healthcheck?: { test?: string[]; disable?: boolean };
  environment?: Record<string, string>;
  command?: string[];
  profiles?: string[];
}
interface Rendered {
  services: Record<string, Service>;
  volumes?: Record<string, unknown>;
}

const REQUIRED_KEYS = [
  'IMAGE',
  'MYSQL_ROOT_PASSWORD',
  'MYSQL_PASSWORD',
  'RABBITMQ_USER',
  'RABBITMQ_PASSWORD',
  'GRAFANA_ADMIN_PASSWORD',
  'TUNNEL_TOKEN',
];

function envFile(omit: string[] = [], extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'caquick-compose-'));
  const path = join(dir, 'env');
  writeFileSync(
    path,
    [
      ...REQUIRED_KEYS.filter((k) => !omit.includes(k)).map((k) => `${k}=x`),
      ...extra,
    ].join('\n') + '\n',
  );
  return path;
}

/** env_file은 config가 environment로 풀어 버린다 — 프로젝트 디렉터리를 바꿔 넣은 app.env가 어디로 흘러가는지 본다 */
function render(env: string, projectDir?: string): Rendered {
  const out = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      COMPOSE,
      ...(projectDir ? ['--project-directory', projectDir] : []),
      '--env-file',
      env,
      ...PROFILES.flatMap((p) => ['--profile', p]),
      'config',
      '--format',
      'json',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out) as Rendered;
}

/** compose config는 mem_limit을 바이트 수 또는 "768m" 같은 문자열로 낸다 */
function bytes(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  const m = /^(\d+)([kmg]?)b?$/i.exec(value ?? '');
  if (!m) throw new Error(`mem_limit 형식: ${String(value)}`);
  const unit = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[
    m[2].toLowerCase()
  ];
  return Number(m[1]) * (unit ?? 1);
}

describe('infra/compose.yml', () => {
  let rendered: Rendered;
  beforeAll(() => {
    rendered = render(envFile());
  });

  it('서비스 목록이 로드맵 v2 §1 컨테이너 표와 같다(+ migrate 일회성)', () => {
    expect(Object.keys(rendered.services).sort()).toEqual(
      [
        'alloy',
        'api',
        'backup',
        'cloudflared',
        'grafana',
        'loki',
        'migrate',
        'mysql',
        'prometheus',
        'rabbitmq',
        'redis',
        'worker',
      ].sort(),
    );
  });

  it('api·worker·migrate는 같은 이미지에 역할만 다르고, 앱·저장소는 ready/ping 헬스체크·재시작 정책·mem_limit을 가진다', () => {
    const { api, worker, migrate } = rendered.services;
    expect(api.image).toBe('x:main');
    expect(worker.image).toBe(api.image);
    expect(migrate.image).toBe(api.image);
    expect(api.environment?.APP_ROLE).toBe('api');
    expect(worker.environment?.APP_ROLE).toBe('worker');
    expect(migrate.command).toEqual(['yarn', 'prisma:migrate:deploy']);
    expect(migrate.profiles).toEqual(['migrate']);

    for (const name of ['api', 'worker']) {
      expect(rendered.services[name].healthcheck?.test?.join(' ')).toContain(
        '/health/ready',
      );
    }
    // migrate(일회성)만 빼고 전부 헬스체크 — 죽은 채 "running"으로 남는 컨테이너가 없게
    for (const [name, service] of Object.entries(rendered.services)) {
      if (name === 'migrate') continue;
      expect({
        name,
        probe: (service.healthcheck?.test?.length ?? 0) > 0,
      }).toEqual({ name, probe: true });
    }
    for (const [name, service] of Object.entries(rendered.services)) {
      expect(service.restart).toBe(
        name === 'migrate' ? 'no' : 'unless-stopped',
      );
      expect(bytes(service.mem_limit)).toBeGreaterThan(0);
    }
  });

  it('mem_limit 합계는 6 GB 이하(로드맵 v2 §5)', () => {
    const total = Object.values(rendered.services).reduce(
      (sum, s) => sum + bytes(s.mem_limit),
      0,
    );
    expect(total).toBeLessThanOrEqual(6 * 1024 ** 3);
  });

  it('반증: 인바운드 포트는 열지 않는다 — 저장소·worker는 포트 없음, 나머지 진단 포트는 전부 127.0.0.1', () => {
    for (const name of ['mysql', 'redis', 'worker', 'migrate', 'backup']) {
      expect(rendered.services[name].ports ?? []).toEqual([]);
    }
    for (const [name, service] of Object.entries(rendered.services)) {
      for (const port of service.ports ?? []) {
        expect({ name, host_ip: port.host_ip }).toEqual({
          name,
          host_ip: '127.0.0.1',
        });
      }
    }
  });

  it('Redis는 noeviction(블랙리스트 표식이 밀려나면 차단이 풀린다), RabbitMQ는 durable 큐를 위한 볼륨과 고정 hostname', () => {
    expect(rendered.services.redis.command).toEqual(
      expect.arrayContaining(['--maxmemory-policy', 'noeviction']),
    );
    expect(Object.keys(rendered.volumes ?? {})).toEqual(
      expect.arrayContaining(['mysql-data', 'rabbitmq-data']),
    );
    expect((rendered.services.rabbitmq as { hostname?: string }).hostname).toBe(
      'rabbitmq',
    );
  });

  it('반증: app.env는 앱 컨테이너(api·worker·migrate)에만 들어가고, .env(compose 보간용)는 어느 컨테이너에도 통째로 들어가지 않는다', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'caquick-compose-proj-'));
    writeFileSync(join(projectDir, 'app.env'), 'CAQUICK_APP_ONLY=1\n');
    const withSentinel = render(
      envFile([], ['CAQUICK_INFRA_ONLY=1']),
      projectDir,
    );
    for (const [name, service] of Object.entries(withSentinel.services)) {
      const env = service.environment ?? {};
      expect({ name, app: 'CAQUICK_APP_ONLY' in env }).toEqual({
        name,
        app: ['api', 'worker', 'migrate'].includes(name),
      });
      expect({ name, infra: 'CAQUICK_INFRA_ONLY' in env }).toEqual({
        name,
        infra: false,
      });
    }
  });

  it('반증: root 비밀번호·터널 토큰·Grafana 비밀은 소유 컨테이너 밖으로 나가지 않는다', () => {
    const owner: Record<string, string> = {
      MYSQL_ROOT_PASSWORD: 'mysql',
      RABBITMQ_DEFAULT_PASS: 'rabbitmq',
      GF_SECURITY_ADMIN_PASSWORD: 'grafana',
      TUNNEL_TOKEN: 'cloudflared',
    };
    for (const [name, service] of Object.entries(rendered.services)) {
      for (const key of Object.keys(owner)) {
        expect({ name, key, has: key in (service.environment ?? {}) }).toEqual({
          name,
          key,
          has: owner[key] === name,
        });
      }
    }
  });

  it.each(REQUIRED_KEYS)(
    '반증: 필수 값 %s이 없으면 config가 실패한다 — 빈 비밀번호로 기동되지 않는다',
    (key) => {
      expect(() => render(envFile([key]))).toThrow();
    },
  );
});
