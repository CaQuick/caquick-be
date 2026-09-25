import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';

import {
  defaultBootAlertStateDir,
  shouldSendBootAlert,
} from '@/global/alerting/boot-alert-throttle';

describe('shouldSendBootAlert', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boot-alert-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 같은 함수를 별도 프로세스 n개에서 동시에 돌린다 — 이 파일을 CJS로 옮겨 자식이 require한다. */
  async function runInProcesses(
    n: number,
    stateDir: string,
  ): Promise<string[]> {
    const source = readFileSync(
      join(__dirname, 'boot-alert-throttle.ts'),
      'utf8',
    );
    const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const modulePath = join(dir, 'throttle.js');
    writeFileSync(modulePath, js, 'utf8');
    const child = `const t = require(${JSON.stringify(modulePath)});
      process.stdout.write(t.shouldSendBootAlert(Date.now(), 5000, ${JSON.stringify(stateDir)}) ? 'sent' : 'suppressed');`;
    return Promise.all(
      Array.from(
        { length: n },
        () =>
          new Promise<string>((resolve) => {
            const proc = spawn(process.execPath, ['-e', child]);
            let out = '';
            proc.stdout.on(
              'data',
              (chunk: Buffer) => (out += chunk.toString()),
            );
            proc.on('close', () => resolve(out));
          }),
      ),
    );
  }

  it('마지막 전송 기준 롤링 창 — 창 안 재호출은 억제하고 창이 지나면 보낸다', () => {
    expect(shouldSendBootAlert(10_000, 5_000, dir)).toBe(true);
    expect(shouldSendBootAlert(14_999, 5_000, dir)).toBe(false);
    expect(shouldSendBootAlert(15_000, 5_000, dir)).toBe(true);
    // 반증(고정 버킷의 구멍): 15,000에 보냈으면 15,001은 억제돼야 한다
    expect(shouldSendBootAlert(15_001, 5_000, dir)).toBe(false);
    expect(shouldSendBootAlert(19_999, 5_000, dir)).toBe(false);
    expect(shouldSendBootAlert(20_000, 5_000, dir)).toBe(true);
  });

  it('죽은 프로세스가 남긴 오래된 잠금은 가져가고 결정한다', () => {
    writeFileSync(join(dir, 'lock'), '', 'utf8');
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(dir, 'lock'), old, old);
    expect(shouldSendBootAlert(Date.now(), 5_000, dir)).toBe(true);
  });

  it('반증: 방금 잡힌 잠금이면 이번 프로세스는 보내지 않는다(다른 프로세스가 결정 중)', () => {
    writeFileSync(join(dir, 'lock'), '', 'utf8');
    expect(shouldSendBootAlert(Date.now(), 5_000, dir)).toBe(false);
  });

  it('반증: 별도 프로세스 4개가 동시에 부르면 정확히 1개만 보낸다', async () => {
    const results = await runInProcesses(4, join(dir, 'state'));

    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r === 'suppressed')).toHaveLength(3);
  });

  it('반증: 오래된 잠금을 프로세스 4개가 동시에 발견해도 정확히 1개만 보낸다(rename 회수)', async () => {
    const stateDir = join(dir, 'state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'lock'), '', 'utf8');
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(stateDir, 'lock'), old, old);

    const results = await runInProcesses(4, stateDir);

    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r === 'suppressed')).toHaveLength(3);
  });

  it('반증: 느슨한 디렉터리에 lock을 디렉터리(미래 mtime)로 심어 둬도 치우고 정상 동작한다 — 영구 busy가 되지 않는다', () => {
    const stateDir = join(dir, 'planted-dir-lock');
    mkdirSync(stateDir);
    chmodSync(stateDir, 0o777);
    mkdirSync(join(stateDir, 'lock'));
    const future = new Date(Date.now() + 10 ** 9);
    utimesSync(join(stateDir, 'lock'), future, future);
    writeFileSync(join(stateDir, 'last-sent'), String(10 ** 13), 'utf8');

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(false);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
  });

  it('반증: 700 디렉터리라도 lock이 미래 mtime이면 죽은 잠금으로 보고 회수한다', () => {
    const stateDir = join(dir, 'future-lock');
    mkdirSync(stateDir, { mode: 0o700 });
    writeFileSync(join(stateDir, 'lock'), '', 'utf8');
    const future = new Date(Date.now() + 10 ** 9);
    utimesSync(join(stateDir, 'lock'), future, future);
    expect(shouldSendBootAlert(Date.now(), 5_000, stateDir)).toBe(true);
  });

  it('반증: 상태 디렉터리 경로가 심볼릭 링크면 믿지 않는다 — 링크 대상은 건드리지 않고 보낸다', () => {
    const target = join(dir, 'target');
    mkdirSync(target);
    chmodSync(target, 0o777);
    writeFileSync(join(target, 'last-sent'), '1', 'utf8');
    const linked = join(dir, 'linked-state');
    symlinkSync(target, linked);

    expect(shouldSendBootAlert(10_000, 5_000, linked)).toBe(true);
    expect(shouldSendBootAlert(10_001, 5_000, linked)).toBe(true); // 억제 파일을 쓰지도 읽지도 않는다

    expect(statSync(target).mode & 0o777).toBe(0o777);
    expect(readFileSync(join(target, 'last-sent'), 'utf8')).toBe('1');
    expect(existsSync(join(target, 'lock'))).toBe(false);
  });

  it('반증: 느슨한 디렉터리에 심어 둔 미래 last-sent가 있어도 프로세스 4개 동시 기동에 정확히 1개만 보낸다(지우지 않고 걸러낸다)', async () => {
    const stateDir = join(dir, 'loose-race');
    mkdirSync(stateDir);
    chmodSync(stateDir, 0o777);
    writeFileSync(
      join(stateDir, 'last-sent'),
      String(Date.now() + 10 ** 12),
      'utf8',
    );

    const results = await runInProcesses(4, stateDir);

    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r === 'suppressed')).toHaveLength(3);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
  });

  it('반증: 부모 디렉터리를 남이 쓸 수 있고 sticky가 아니면 믿지 않는다 — 아무것도 만들지 않고 보낸다', () => {
    const parent = join(dir, 'shared-parent');
    mkdirSync(parent);
    chmodSync(parent, 0o777);
    const stateDir = join(parent, 'state');

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(true);
    expect(existsSync(stateDir)).toBe(false);
  });

  it('반증: 바로 위 부모가 안전해도 그 위 조상이 남이 쓸 수 있는 비-sticky면 믿지 않는다 — 하위 트리째 바꿔치기할 수 있다', () => {
    const grand = join(dir, 'shared-grand');
    mkdirSync(grand);
    chmodSync(grand, 0o777);
    const parent = join(grand, 'mine');
    mkdirSync(parent, { mode: 0o700 });
    const stateDir = join(parent, 'state');

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(true);
    expect(existsSync(stateDir)).toBe(false);
  });

  it('sticky 부모(/tmp 식 1777)는 남이 내 디렉터리를 바꿔치기할 수 없으므로 허용한다', () => {
    const parent = join(dir, 'sticky-parent');
    mkdirSync(parent);
    chmodSync(parent, 0o1777);
    const stateDir = join(parent, 'state');

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(false);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
  });

  it('반증: 부모가 아직 없는 경로(새 설치의 ~/.caquick/boot-alert)도 만들어 쓰고 억제가 동작한다', () => {
    const stateDir = join(dir, 'fresh', 'nested', 'boot-alert');
    expect(existsSync(join(dir, 'fresh'))).toBe(false);

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(false);

    expect(statSync(join(dir, 'fresh')).mode & 0o777).toBe(0o700);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
  });

  it('반증: last-sent 자리에 디렉터리·링크가 심겨 있으면 그 항목을 치우고 내 파일로 바꾼다 — 부팅 루프에서 경보가 계속 나가지 않는다', () => {
    const stateDir = join(dir, 'planted-state');
    mkdirSync(stateDir, { mode: 0o700 });
    mkdirSync(join(stateDir, 'last-sent'));

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
    expect(statSync(join(stateDir, 'last-sent')).isFile()).toBe(true);
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(false);
  });

  it('반증: 상태 디렉터리를 만들 수 없으면 보내는 쪽으로 기운다', () => {
    const notADir = join(dir, 'file');
    writeFileSync(notADir, 'x', 'utf8');
    expect(shouldSendBootAlert(10_000, 5_000, join(notADir, 'sub'))).toBe(true);
  });

  it('기본 상태 디렉터리는 공유 tmp가 아니라 실행 사용자 홈 아래이고, env로 바꿀 수 있다', () => {
    const prev = process.env.BOOT_ALERT_STATE_DIR;
    delete process.env.BOOT_ALERT_STATE_DIR;
    try {
      expect(defaultBootAlertStateDir()).toBe(
        join(homedir(), '.caquick', 'boot-alert'),
      );
      expect(defaultBootAlertStateDir().startsWith(tmpdir())).toBe(false);
      process.env.BOOT_ALERT_STATE_DIR = join(dir, 'custom');
      expect(defaultBootAlertStateDir()).toBe(join(dir, 'custom'));
    } finally {
      if (prev === undefined) delete process.env.BOOT_ALERT_STATE_DIR;
      else process.env.BOOT_ALERT_STATE_DIR = prev;
    }
  });

  it('반증: 이미 있던 느슨한 권한(777)의 상태 디렉터리는 700으로 바로잡는다 — mkdir mode는 기존 디렉터리에 안 먹는다', () => {
    const stateDir = join(dir, 'loose');
    mkdirSync(stateDir);
    chmodSync(stateDir, 0o777); // mkdir mode는 umask에 깎인다 — 명시적으로 느슨하게
    expect(statSync(stateDir).mode & 0o777).toBe(0o777);

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);

    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
    // 권한이 고쳐진 뒤에는 억제가 정상 동작한다
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(false);
  });

  it('반증: 느슨했던 디렉터리에 심어 둔 먼 미래의 last-sent는 버린다 — 영구 억제가 되지 않는다', () => {
    const stateDir = join(dir, 'planted');
    mkdirSync(stateDir);
    chmodSync(stateDir, 0o777);
    writeFileSync(
      join(stateDir, 'last-sent'),
      String(10_000 + 10 ** 12),
      'utf8',
    );

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
    // 이제 내 기록이 기준이다
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(false);
  });

  it('반증: 700 디렉터리라도 last-sent가 미래 값이면 무시한다', () => {
    const stateDir = join(dir, 'future');
    mkdirSync(stateDir, { mode: 0o700 });
    writeFileSync(join(stateDir, 'last-sent'), String(10 ** 13), 'utf8');
    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
  });

  it('반증: 상태 디렉터리는 700으로 만들고, 심겨 있는 심볼릭 링크는 따라가지 않는다(대상 파일 불변, 경보는 보낸다)', () => {
    const stateDir = join(dir, 'state');
    const victim = join(dir, 'victim');
    writeFileSync(victim, 'untouched', 'utf8');
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    symlinkSync(victim, join(stateDir, 'last-sent'));

    expect(shouldSendBootAlert(10_000, 5_000, stateDir)).toBe(true);
    // 링크 자체를 치우고 내 파일을 썼다 — 대상은 그대로, 이후 억제는 정상
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(lstatSync(join(stateDir, 'last-sent')).isSymbolicLink()).toBe(false);
    expect(shouldSendBootAlert(10_001, 5_000, stateDir)).toBe(false);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
  });
});
