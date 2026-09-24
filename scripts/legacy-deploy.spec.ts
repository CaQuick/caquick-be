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

  it('ValidateService는 새 worker의 ready를 확인한 뒤에만 옛 worker를 멈추고, 실패면 새 worker를 내린다', () => {
    const script = read('scripts/validate_service.sh');
    const workerProbe = script.indexOf('${NEW_WORKER_PORT}/health/ready');
    const stopNewOnFail = script.indexOf('$PM2 stop "$NEW_WORKER"');
    const switchApi = script.indexOf('switch_backend "$IDLE_PORT"');
    const stopOld = script.indexOf('$PM2 stop "$OLD_WORKER"');
    expect(workerProbe).toBeGreaterThan(-1);
    expect(stopNewOnFail).toBeGreaterThan(workerProbe);
    expect(switchApi).toBeGreaterThan(stopNewOnFail);
    expect(stopOld).toBeGreaterThan(switchApi);
    // api 검증이 끝내 실패한 경로에서도 새 worker를 내린다(옛 worker와 둘이 돌지 않게)
    const apiFail = script.indexOf('Health check failed');
    expect(apiFail).toBeGreaterThan(stopOld);
    expect(script.indexOf('$PM2 stop "$NEW_WORKER"', apiFail)).toBeGreaterThan(
      apiFail,
    );
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

  it('ApplicationStart는 새 profile의 worker를 띄우되 옛 worker를 멈추지 않는다(멈춤은 validate가 ready 확인 뒤)', () => {
    const script = read('scripts/application_start.sh');
    expect(script).toContain('--only "worker-${IDLE_PROFILE}"');
    expect(script).not.toMatch(/\$PM2 stop "worker-/);
  });
});
