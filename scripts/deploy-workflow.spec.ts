import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
  needs?: string | string[];
  strategy?: { 'fail-fast'?: boolean; matrix: Record<string, unknown[]> };
  env?: Record<string, string | number>;
  permissions?: Record<string, string>;
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
  permissions?: Record<string, string>;
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

describe('pr-check.yml image job', () => {
  const wf = workflow('.github/workflows/pr-check.yml');
  const image = wf.jobs.image;

  it('check와 나란히 돌고, PR은 arm64 빌드만·main push만 GHCR에 sha 태그로 푸시한다', () => {
    expect(wf.on.push?.branches).toContain('main');
    expect(wf.on.pull_request?.branches).toEqual(
      expect.arrayContaining(['main', 'develop', 'develop-msa']),
    );
    // check를 기다리지 않는다 — 배포 게이트는 Deploy가 CI 전체의 결론으로 건다
    expect(image).not.toHaveProperty('needs');
    expect(image.if).toBe(
      "github.event_name == 'pull_request' || github.ref == 'refs/heads/main'",
    );
    const push = image.steps.find((s) =>
      s.uses?.startsWith('docker/build-push-action'),
    );
    expect(push?.with?.push).toBe("${{ github.event_name == 'push' }}");
    expect(push?.with?.platforms).toBe('linux/arm64');
    const meta = image.steps.find((s) =>
      s.uses?.startsWith('docker/metadata-action'),
    );
    expect(String(meta?.with?.tags)).toContain('value=${{ github.sha }}');
    // 가변 태그(main)는 늦게 끝난 옛 빌드가 덮어쓸 수 있다 — sha 태그만
    expect(String(meta?.with?.tags)).not.toContain('value=main');
    const login = image.steps.find((s) =>
      s.uses?.startsWith('docker/login-action'),
    );
    expect(login?.if).toBe("github.event_name == 'push'");
  });

  it('반증: 셀프호스트 러너를 쓰지 않는다 — 공개 레포의 PR 코드가 홈서버에서 돌면 안 된다', () => {
    for (const job of Object.values(wf.jobs))
      expect(JSON.stringify(job['runs-on'])).not.toContain('self-hosted');
  });

  it('액션은 커밋 SHA로 고정', () => {
    for (const u of usesOf(wf)) expect(u).toMatch(PINNED);
  });
});

describe('deploy.yml', () => {
  const wf = workflow('.github/workflows/deploy.yml');
  const job = wf.jobs.deploy;

  it('main push의 CI 성공·수동 실행만 받고, production Environment + 셀프호스트 macmini 러너에서 돈다', () => {
    expect(wf.on.workflow_run?.workflows).toEqual(['CI']);
    expect(wf.on.workflow_run?.branches).toEqual(['main']);
    expect(wf.on.workflow_dispatch).toBeDefined();
    expect(wf.on.push).toBeUndefined();
    expect(wf.on.pull_request).toBeUndefined();
    expect(job.environment).toBe('production');
    expect(job['runs-on']).toEqual(['self-hosted', 'macmini']);
    // workflow_run은 실패한 CI·다른 브랜치에서도 온다 — if로 한 번 더 거른다
    expect(job.if).toContain("conclusion == 'success'");
    expect(job.if).toContain("head_branch == 'main'");
    // 포크 PR의 'main' 브랜치 CI도 workflow_run으로 온다 — 이 레포의 push CI만
    expect(job.if).toContain("workflow_run.event == 'push'");
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
    // CI image job이 푸시하는 태그(전체 sha)만 — 짧은 sha·hex 아닌 접미사는 거절
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

  it('반증: 수동 실행은 그 sha의 main push CI가 성공했어야 배포한다 — 이미지는 check와 나란히 푸시돼 실패한 커밋에도 있다', () => {
    const idx = (prefix: string) =>
      job.steps.findIndex((s) => s.name?.startsWith(prefix));
    const gate = job.steps[idx('Require CI success')];
    expect(gate?.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(gate?.env?.TAG).toBe('${{ steps.tag.outputs.tag }}');
    expect(gate?.run).toContain(
      'workflows/pr-check.yml/runs?head_sha=$TAG&event=push&branch=main&status=success',
    );
    expect(gate?.run).toContain('exit 1');
    // pull·migrate(deploy.sh) 전에 막는다
    expect(idx('Require CI success')).toBeGreaterThan(idx('Resolve image tag'));
    expect(idx('Require CI success')).toBeLessThan(idx('Deploy'));
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

describe('pr-check.yml run 블록', () => {
  const wf = workflow('.github/workflows/pr-check.yml');
  it('반증: run 블록에 식(${{ }})을 직접 넣지 않는다', () => {
    for (const job of Object.values(wf.jobs)) {
      for (const step of job.steps) expect(step.run ?? '').not.toContain('${{');
    }
  });
});

/** shell을 지정하지 않은 run 블록과 같은 셸(bash -e {0}, 실행 로그로 확인)로 실제로 돌린다. */
function runStep(run: string, env: Record<string, string>, cwd?: string) {
  return spawnSync('bash', ['-e', '-c', run], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('pr-check.yml 잡 구성', () => {
  const wf = workflow('.github/workflows/pr-check.yml');
  const { check, test, 'coverage-report': coverage } = wf.jobs;
  const list = (needs?: string | string[]) => [needs ?? []].flat();
  const step = (job: Job, name: string) => {
    const found = job.steps.find((s) => s.name === name);
    if (!found) throw new Error(`step 없음: ${name}`);
    return found;
  };

  it('필수 체크 check는 if: always()로 늘 돌고, push·PR 모두에서 도는 잡(image·pr-title 제외)을 전부 기다린다', () => {
    expect(check.if).toBe('always()');
    const others = Object.keys(wf.jobs).filter(
      (name) => !['check', 'image', 'pr-title'].includes(name),
    );
    expect(list(check.needs).sort()).toEqual(others.sort());
  });

  // 건너뛴 잡은 GitHub에서 성공으로 보고된다 — 선행 잡이 실패해 skipped가 된 잡이 필수 체크를 통과시키지 않게 결과를 직접 본다
  it.each([
    ['전부 success면 통과', 0, ['success', 'success', 'success']],
    ['반증: failure가 하나라도 있으면 실패', 1, ['success', 'failure']],
    ['반증: skipped도 실패', 1, ['success', 'skipped']],
    ['반증: cancelled도 실패', 1, ['cancelled', 'success']],
    ['반증: needs가 비면 실패', 1, []],
  ])('check 집계: %s(종료 코드 %i)', (_label, status, results) => {
    const gate = check.steps.find((s) => s.run)!;
    expect(gate.env?.NEEDS).toBe('${{ toJSON(needs) }}');
    const needs = Object.fromEntries(
      results.map((result, i) => [`job${i}`, { result, outputs: {} }]),
    );

    expect(runStep(gate.run!, { NEEDS: JSON.stringify(needs) }).status).toBe(
      status,
    );
  });

  it('test는 fail-fast 없는 샤드 행렬이고, coverage-report는 테스트가 실패해도(취소만 제외) 같은 샤드 수로 합친다', () => {
    expect(list(coverage.needs)).toEqual(['test']);
    expect(coverage.if).toBe('${{ !cancelled() }}');
    expect(test.strategy?.['fail-fast']).toBe(false);
    const shards = test.strategy?.matrix.shard;
    expect(shards).toEqual([1, 2]);
    expect(Number(test.env?.SHARD_TOTAL)).toBe(shards?.length);
    expect(Number(coverage.env?.SHARD_TOTAL)).toBe(shards?.length);
    const run = test.steps.find((s) => s.run?.includes('jest'))?.run;
    // --coverage는 LanguageService 모드 선택, 샤드별 임계는 끄고 합친 맵으로 검사, 액션 입력 형식(--json·위치)
    expect(run).toContain(' --coverage ');
    expect(run).toContain('--shard="$SHARD/$SHARD_TOTAL"');
    expect(run).toContain("'--coverageThreshold={}'");
    expect(run).toContain(
      '--json --outputFile=coverage/report.json --testLocationInResults',
    );
    expect(step(coverage, 'Merge coverage (임계는 jest.config.js)').run).toBe(
      'yarn coverage:merge coverage/shards coverage',
    );
  });

  it('의존성 캐시 키는 yarn.lock·package.json·OS·아키텍처·node 버전을 담고, 적중하면 설치 대신 prisma generate(postinstall)를 돈다', () => {
    const cached = Object.entries(wf.jobs).filter(([, job]) =>
      job.steps.some((s) => s.uses?.startsWith('actions/cache@')),
    );
    expect(cached.map(([name]) => name).sort()).toEqual(
      ['build', 'coverage-report', 'scripts', 'static', 'test'].sort(),
    );
    for (const [, job] of cached) {
      const cache = job.steps.find((s) => s.uses?.startsWith('actions/cache@'));
      const key = String(cache?.with?.key);
      for (const part of [
        '${{ runner.os }}',
        '${{ runner.arch }}',
        '${{ steps.node.outputs.node-version }}',
        "${{ hashFiles('yarn.lock', 'package.json') }}",
      ])
        expect(key).toContain(part);
      expect(
        job.steps.find((s) => s.uses?.startsWith('actions/setup-node@'))?.id,
      ).toBe('node');
      expect(step(job, 'Install dependencies')).toMatchObject({
        if: "steps.modules.outputs.cache-hit != 'true'",
        run: expect.stringContaining('yarn install --immutable'),
      });
      expect(
        step(job, 'Prisma generate (node_modules 캐시 적중)'),
      ).toMatchObject({
        if: "steps.modules.outputs.cache-hit == 'true'",
        run: expect.stringContaining('yarn prisma:generate'),
      });
    }
  });

  it('반증: Codecov 업로드는 기준 받기·댓글 액션 뒤에 둔다 — codecov-action이 업로드 토큰을 GITHUB_ENV로 뒤 단계에 남긴다', () => {
    const at = (prefix: string) =>
      coverage.steps.findIndex((s) =>
        (s.uses ?? s.name ?? '').startsWith(prefix),
      );
    expect(at('codecov/codecov-action@')).toBeGreaterThan(
      at('ArtiomTr/jest-coverage-report-action@'),
    );
    expect(at('codecov/codecov-action@')).toBeGreaterThan(
      at('Fetch base coverage'),
    );
  });

  it('반증: actions: read는 기준 아티팩트를 받는 coverage-report에만 준다', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    for (const [name, job] of Object.entries(wf.jobs)) {
      expect({ name, actions: job.permissions?.actions }).toEqual({
        name,
        actions: name === 'coverage-report' ? 'read' : undefined,
      });
    }
  });

  describe('기준 커버리지 받기', () => {
    const fetch = step(coverage, 'Fetch base coverage');
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'base-coverage-'));
      mkdirSync(join(dir, 'coverage'));
      writeFileSync(join(dir, 'coverage/report.json'), '{"head":true}');
      mkdirSync(join(dir, 'bin'));
      // gh 대역: api는 조회 종류별 run id를 내고, run download는 HAS에 든 run만 성공한다
      writeFileSync(
        join(dir, 'bin/gh'),
        [
          '#!/bin/bash',
          'echo "$*" >> "$GH_LOG"',
          '[ "$1" = api ] && { [ -n "$API_FAIL" ] && exit 1; case "$2" in *head_sha=*) printf "%s\\n" $EXACT;; *) printf "%s\\n" $LATEST;; esac; exit 0; }',
          'for id in $HAS; do [ "$3" = "$id" ] && { echo "{\\"base\\":$id}" > "${@: -1}/report.json"; exit 0; }; done',
          'exit 1',
        ].join('\n'),
      );
      chmodSync(join(dir, 'bin/gh'), 0o755);
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('반증: 이 레포 base 브랜치의 성공한 push 실행만 조회한다 — PR 실행의 아티팩트는 PR 코드가 만든 것이다', () => {
      expect(fetch.run).toContain(
        'actions/workflows/pr-check.yml/runs?event=push&status=success&branch=$BASE_REF',
      );
      expect(fetch.run).toContain(
        'select(.head_repository.full_name == env.REPO)',
      );
      expect(fetch.env).toMatchObject({
        REPO: '${{ github.repository }}',
        BASE_REF: '${{ github.base_ref }}',
        BASE_SHA: '${{ github.event.pull_request.base.sha }}',
      });
      // 기준 경로는 고정 — 액션은 입력 경로로 댓글을 식별해 경로가 바뀌면 댓글을 새로 단다
      expect(
        coverage.steps.find((s) => s.uses?.startsWith('ArtiomTr/'))?.with,
      ).toMatchObject({
        'coverage-file': 'coverage/report.json',
        'base-coverage-file': 'coverage/base/report.json',
      });
    });

    it.each([
      [
        'base 커밋의 실행이 먼저',
        { EXACT: '11', LATEST: '13 12', HAS: '11 12' },
        '{"base":11}',
        ['11'],
      ],
      [
        '그 실행에 아티팩트가 없으면 브랜치 최근 실행(중복은 한 번만)',
        { EXACT: '11', LATEST: '11 12', HAS: '12' },
        '{"base":12}',
        ['11', '12'],
      ],
      [
        '반증: 어디에도 없으면 head를 기준 자리에 둔다',
        { EXACT: '', LATEST: '13', HAS: '' },
        '{"head":true}',
        ['13'],
      ],
      [
        '반증: 조회가 실패해도 head로 이어간다',
        { API_FAIL: '1', HAS: '' },
        '{"head":true}',
        [],
      ],
    ])('%s', (_label, gh, base, tried) => {
      const log = join(dir, 'gh.log');
      const result = runStep(
        fetch.run!,
        {
          ...gh,
          GH_LOG: log,
          PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
          REPO: 'CaQuick/caquick-be',
          BASE_REF: 'develop',
          BASE_SHA: 'abc',
        },
        dir,
      );

      expect(result.status).toBe(0);
      expect(
        readFileSync(join(dir, 'coverage/base/report.json'), 'utf8').trim(),
      ).toBe(base);
      const downloads = readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('run download'))
        .map((line) => line.split(' ')[2]);
      expect(downloads).toEqual(tried);
    });
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
