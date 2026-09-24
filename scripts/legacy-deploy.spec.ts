import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 레거시 CodeDeploy/PM2 자산이 역할 분리·ready 판정과 어긋나지 않게 잡아 둔다(07 compose 전환 때 이 spec도 같이 지운다).
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('레거시 배포 자산', () => {
  it('ValidateService는 /health/ready로만 트래픽 투입을 판정한다', () => {
    const script = read('scripts/validate_service.sh');
    expect(script).toContain('/health/ready');
    expect(script).not.toContain('/health/profiles');
    expect(script).not.toMatch(/\/health"\s*\|\|/);
  });

  it('PM2 ecosystem에 profile별 worker 엔트리가 있고 APP_ROLE=worker를 준다', () => {
    const ecosystem = read('ecosystem.config.js');
    for (const profile of ['blue', 'green']) {
      const entry = new RegExp(
        `name: 'worker-${profile}'[\\s\\S]*?APP_ROLE: 'worker'[\\s\\S]*?PROFILE: '${profile}'`,
      );
      expect(ecosystem).toMatch(entry);
    }
    // api 엔트리는 역할을 지정하지 않는다(기본 api) — worker 역할이 새면 GraphQL이 꺼진다
    expect(ecosystem.match(/APP_ROLE: 'worker'/g)).toHaveLength(2);
  });

  it('ApplicationStart는 반대편 worker를 멈춘 뒤 새 profile의 worker를 띄운다(한 번에 하나)', () => {
    const script = read('scripts/application_start.sh');
    const stop = script.indexOf('$PM2 stop "worker-${OTHER_PROFILE}"');
    const start = script.indexOf('--only "worker-${IDLE_PROFILE}"');
    expect(stop).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(stop);
  });
});
