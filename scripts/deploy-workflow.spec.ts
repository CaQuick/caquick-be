import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

// 이미지 빌드·배포 워크플로의 형태를 고정한다 — 공개 레포 + 셀프호스트 러너라 트리거·러너·권한이 곧 보안 경계다.
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  'runs-on': string | string[];
  environment?: string;
  if?: string;
  steps: Step[];
}
interface Triggers {
  push?: { branches: string[] };
  pull_request?: { branches: string[] };
  workflow_run?: { workflows: string[]; branches: string[] };
  workflow_dispatch?: unknown;
}
interface Workflow {
  on: Triggers;
  concurrency?: Record<string, unknown>;
  jobs: Record<string, Job>;
}
const workflow = (p: string) => parse(read(p)) as Workflow;

const PINNED = /@[0-9a-f]{40}$/;
function usesOf(wf: Workflow): string[] {
  return Object.values(wf.jobs)
    .flatMap((j) => j.steps)
    .map((s) => s.uses)
    .filter((u): u is string => typeof u === 'string');
}

describe('build-image.yml', () => {
  const wf = workflow('.github/workflows/build-image.yml');
  const build = wf.jobs.build;

  it('main은 CI(pr-check) 성공(workflow_run, 같은 sha, 이 레포 push)에서만 GHCR에 푸시하고 PR(main·develop·develop-msa)은 arm64 빌드만 한다', () => {
    expect(wf.on.push).toBeUndefined();
    expect(wf.on.workflow_run?.workflows).toEqual(['CI']);
    expect(wf.on.workflow_run?.branches).toEqual(['main']);
    expect(wf.on.pull_request?.branches).toEqual(
      expect.arrayContaining(['main', 'develop-msa']),
    );
    // 이미지 빌드는 lint·테스트를 돌리지 않는다 — CI가 같은 커밋에서 성공한 뒤에만
    expect(build.if).toContain("conclusion == 'success'");
    expect(build.if).toContain("workflow_run.event == 'push'");
    expect(build.if).toContain(
      'head_repository.full_name == github.repository',
    );
    expect(build.if).toContain('head_sha == github.sha');
    const push = build.steps.find((s) =>
      s.uses?.startsWith('docker/build-push-action'),
    );
    expect(push?.with?.push).toBe("${{ github.event_name == 'workflow_run' }}");
    expect(push?.with?.platforms).toBe('linux/arm64');
    const meta = build.steps.find((s) =>
      s.uses?.startsWith('docker/metadata-action'),
    );
    expect(String(meta?.with?.tags)).toContain('workflow_run.head_sha');
    // 가변 태그(main)는 늦게 끝난 옛 빌드가 덮어쓸 수 있다 — sha 태그만
    expect(String(meta?.with?.tags)).not.toContain('value=main');
    const login = build.steps.find((s) =>
      s.uses?.startsWith('docker/login-action'),
    );
    expect(login?.if).toBe("github.event_name == 'workflow_run'");
    const checkout = build.steps.find((s) =>
      s.uses?.startsWith('actions/checkout'),
    );
    expect(String(checkout?.with?.ref)).toContain('workflow_run.head_sha');
  });

  it('반증: main 빌드의 concurrency 그룹은 sha별 — 옛 커밋의 늦은 CI 완료가 지금 main 끝의 빌드를 취소하지 않는다(순서는 head_sha == github.sha 검사가 맡는다)', () => {
    expect(String(wf.concurrency?.group)).toContain(
      "format('build-image-main-{0}', github.event.workflow_run.head_sha)",
    );
    expect(wf.concurrency?.['cancel-in-progress']).toBe(true);
    expect(build.if).toContain('head_sha == github.sha');
  });

  it('반증: 셀프호스트 러너를 쓰지 않는다 — 공개 레포의 PR 코드가 홈서버에서 돌면 안 된다', () => {
    expect(JSON.stringify(build['runs-on'])).not.toContain('self-hosted');
  });

  it('액션은 커밋 SHA로 고정', () => {
    const uses = usesOf(wf);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(PINNED);
  });
});

describe('deploy.yml', () => {
  const wf = workflow('.github/workflows/deploy.yml');
  const job = wf.jobs.deploy;

  it('Build Image 성공(main)·수동 실행만 받고, production Environment + 셀프호스트 macmini 러너에서 돈다', () => {
    expect(wf.on.workflow_run?.workflows).toEqual(['Build Image']);
    expect(wf.on.workflow_run?.branches).toEqual(['main']);
    expect(wf.on.workflow_dispatch).toBeDefined();
    expect(wf.on.push).toBeUndefined();
    expect(wf.on.pull_request).toBeUndefined();
    expect(job.environment).toBe('production');
    expect(job['runs-on']).toEqual(['self-hosted', 'macmini']);
    // workflow_run은 실패한 빌드·다른 브랜치에서도 온다 — if로 한 번 더 거른다
    expect(job.if).toContain("conclusion == 'success'");
    expect(job.if).toContain("head_branch == 'main'");
    // 포크 PR의 'main' 브랜치 빌드도 workflow_run으로 온다 — CI 체인(workflow_run) 이벤트 + 이 레포의 빌드만
    expect(job.if).toContain("workflow_run.event == 'workflow_run'");
    expect(job.if).toContain('head_repository.full_name == github.repository');
  });

  it('반증: 배포는 한 번에 하나, 진행 중인 배포를 취소하지 않는다 — 끊긴 배포가 절반만 교체된 채 남지 않게', () => {
    expect(wf.concurrency).toEqual({
      group: 'deploy-production',
      'cancel-in-progress': false,
    });
  });

  it('.env·app.env는 Environment secret(DOTENV·APP_ENV)에서 600으로 쓰고, 서버의 두 파일·토큰 파일은 rsync가 지우지 않으며, 실행은 infra/deploy.sh', () => {
    const env = job.steps.find((s) => s.name?.includes('.env'));
    expect(env?.env?.DOTENV).toBe('${{ secrets.DOTENV }}');
    expect(env?.env?.APP_ENV).toBe('${{ secrets.APP_ENV }}');
    expect(env?.run).toContain('umask 077');
    // 이미 있던 644 파일의 권한을 물려받지 않게 — 임시 파일 600 + mv
    expect(env?.run).toContain('chmod 600 "$tmp_env" "$tmp_app"');
    expect(env?.run).toContain('mv -f "$tmp_env" "$DEPLOY_DIR/.env"');
    expect(env?.run).toContain("--exclude '.env'");
    expect(env?.run).toContain("--exclude 'app.env'");
    expect(env?.run).toContain('mv -f "$tmp_app" "$DEPLOY_DIR/app.env"');
    // Prometheus 스크레이프 토큰·백업 경보 웹훅은 compose가 .env에서 읽는다 — app.env에서 복사
    expect(env?.run).toContain(
      'grep -E \'^(METRICS_ACCESS_TOKEN|DISCORD_ALERT_WEBHOOK_URL)=\' "$tmp_app" >> "$tmp_env"',
    );
    expect(env?.run).toContain("grep -q '^METRICS_ACCESS_TOKEN=.'");
    // 관측이 조용히 죽는 값 누락(웹훅 자리표시자·Grafana 비밀·exporter 비밀번호)은 배포에서 막는다
    expect(env?.run).toContain("grep -q '^DISCORD_ALERT_WEBHOOK_URL=.'");
    expect(env?.run).toContain(
      'for key in GRAFANA_ADMIN_PASSWORD GRAFANA_SECRET_KEY MYSQL_EXPORTER_PASSWORD',
    );
    // 비어 있는 secret으로 빈 파일을 만들어 배포하지 않는다
    expect(env?.run).toContain('[ -n "$DOTENV" ] && [ -n "$APP_ENV" ]');
    const deploy = job.steps.find((s) => s.name?.startsWith('Deploy'));
    expect(deploy?.run).toContain('deploy.sh');
    const checkout = job.steps.find((s) =>
      s.uses?.startsWith('actions/checkout'),
    );
    expect(checkout?.with?.['sparse-checkout']).toBe('infra');
  });

  it('액션은 커밋 SHA로 고정', () => {
    for (const u of usesOf(wf)) expect(u).toMatch(PINNED);
  });

  it('반증: run 블록에 식(${{ }})을 직접 넣지 않는다 — 입력·출력은 env를 거쳐 따옴표 친 변수로. image_tag은 전체 sha만(수동 기본값은 main 끝 sha)', () => {
    for (const [name, job] of Object.entries(wf.jobs)) {
      for (const step of job.steps) {
        expect({
          name,
          step: step.name,
          run: step.run ?? '',
        }).not.toMatchObject({
          run: expect.stringContaining('${{'),
        });
      }
    }
    const tag = job.steps.find((s) => s.id === 'tag');
    expect(tag?.env?.INPUT_TAG).toBe('${{ inputs.image_tag }}');
    // build-image가 푸시하는 태그(전체 sha·main)만 — 짧은 sha·hex 아닌 접미사는 거절
    expect(tag?.run).toContain('^[0-9a-f]{40}$');
    expect(tag?.run).toContain('tag=$MAIN_SHA');
    expect(tag?.env?.MAIN_SHA).toBe('${{ github.sha }}');
    expect(tag?.run).toContain('exit 1');
  });

  it('반증: GHCR login은 키체인 helper가 잡히지 않는 별도 DOCKER_CONFIG에서 한다 — auths 항목을 미리 넣고, 데몬 주소는 DOCKER_HOST로 넘긴다(실제 사고: launchd 러너에서 -25308)', () => {
    const idx = (prefix: string) =>
      job.steps.findIndex((s) => s.name?.startsWith(prefix));
    const config = job.steps[idx('Isolated docker config')];
    expect(idx('Isolated docker config')).toBeGreaterThan(-1);
    expect(idx('Isolated docker config')).toBeLessThan(idx('Login to GHCR'));
    // auths가 비어 있으면 docker CLI가 osxkeychain을 자동 감지한다 — 항목이 하나는 있어야 파일 저장소를 쓴다
    expect(config?.run).toContain('{"auths":{"ghcr.io":{}}}');
    expect(config?.run).toContain('echo "DOCKER_CONFIG=$dir"');
    expect(config?.run).toContain('echo "DOCKER_HOST=$host"');
    expect(config?.run).toContain('>> "$GITHUB_ENV"');
    expect(config?.run).toContain('chmod 700 "$dir"');
    // compose는 $DOCKER_CONFIG/cli-plugins에서만 찾는다(OrbStack은 ~/.docker/cli-plugins에 링크) — 링크 없이는 deploy.sh가 "unknown command"로 죽는다
    expect(config?.run).toContain(
      'ln -s "$HOME/.docker/cli-plugins" "$dir/cli-plugins"',
    );
    expect(config?.run).toContain(
      'DOCKER_CONFIG=$dir DOCKER_HOST=$host docker compose version',
    );
    // credsStore를 고정하거나 ~/.docker/config.json을 고쳐 우회하지 않는다 — 러너 사용자의 docker 설정은 읽기만
    expect(config?.run).not.toContain('credsStore');
    expect(config?.run).not.toContain('.docker/config.json');
  });

  it('반증: workflow_run의 head_sha가 지금 main 끝이 아니면 배포 단계를 전부 건너뛴다', () => {
    const skip = job.steps.find((s) => s.name?.startsWith('Skip if not'));
    expect(skip?.if).toBe("github.event_name == 'workflow_run'");
    expect(skip?.env?.MAIN_SHA).toBe('${{ github.sha }}');
    expect(skip?.run).toContain('SKIP_DEPLOY=1');
    for (const name of [
      'Isolated docker config',
      'Login to GHCR',
      'Sync infra/',
      'Deploy',
    ]) {
      const step = job.steps.find((s) => s.name?.startsWith(name));
      expect({ name, if: step?.if }).toEqual({
        name,
        if: expect.stringContaining("env.SKIP_DEPLOY != '1'"),
      });
    }
  });
});

describe('build-image.yml run 블록', () => {
  const wf = workflow('.github/workflows/build-image.yml');
  it('반증: run 블록에 식(${{ }})을 직접 넣지 않는다', () => {
    for (const job of Object.values(wf.jobs)) {
      for (const step of job.steps) expect(step.run ?? '').not.toContain('${{');
    }
  });
});

describe('infra/deploy.sh', () => {
  const script = read('infra/deploy.sh');

  it('E9 순서: pull → migrate → worker(ready 대기) → api(ready 대기) → 나머지 프로필 → 터널 healthy 대기', () => {
    const marks = [
      '--profile migrate pull',
      'run --rm migrate',
      'up -d worker',
      'wait_healthy worker',
      'up -d api',
      'wait_healthy api',
      '--profile edge --profile observability up -d --build',
      'wait_healthy cloudflared',
      'for s in grafana alloy mysqld-exporter redis-exporter backup; do wait_healthy "$s"; done',
    ].map((m) => ({ m, at: script.indexOf(m) }));
    for (const { m, at } of marks)
      expect({ m, found: at > -1 }).toEqual({ m, found: true });
    const positions = marks.map((x) => x.at);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('반증: pull은 빌드 전용 이미지(backup)를 건너뛴다 — 새 호스트에서 caquick-backup:local pull 실패로 배포가 멈추지 않게', () => {
    expect(script).toMatch(/pull --quiet --ignore-buildable/);
  });

  it('반증: worker·api를 --no-deps로 올리지 않는다 — 새 호스트에서 redis·rabbitmq가 없으면 ready가 영영 안 온다', () => {
    expect(script).not.toContain('--no-deps');
  });

  it('반증: ready 대기가 실패하면 set -e로 멈춘다 — worker가 안 뜨면 api를 교체하지 않는다', () => {
    expect(script).toContain('set -euo pipefail');
    expect(script).toMatch(/wait_healthy\(\) \{[\s\S]*?return 1[\s\S]*?\n\}/);
  });
});
