import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';

import { shouldSendBootAlert } from '@/global/alerting/boot-alert-throttle';

describe('shouldSendBootAlert', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boot-alert-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('마지막 전송 기준 롤링 창 — 창 안 재호출은 억제하고 창이 지나면 보낸다', () => {
    expect(shouldSendBootAlert(10_000, 5_000, dir)).toBe(true);
    expect(shouldSendBootAlert(14_999, 5_000, dir)).toBe(false);
    expect(shouldSendBootAlert(15_000, 5_000, dir)).toBe(true);
    // 반증(고정 버킷의 구멍): 15,000에 보냈으면 15,001은 억제돼야 한다
    expect(shouldSendBootAlert(15_001, 5_000, dir)).toBe(false);
    expect(shouldSendBootAlert(19_999, 5_000, dir)).toBe(false);
    expect(shouldSendBootAlert(20_000, 5_000, dir)).toBe(true);
  });

  it('죽은 프로세스가 남긴 오래된 잠금은 치우고 결정한다', () => {
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
    // 같은 함수를 별도 프로세스에서 돌린다 — 이 파일을 CJS로 옮겨 자식이 require한다
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
    const stateDir = join(dir, 'state');
    const child = `const t = require(${JSON.stringify(modulePath)});
      process.stdout.write(t.shouldSendBootAlert(Date.now(), 5000, ${JSON.stringify(stateDir)}) ? 'sent' : 'suppressed');`;

    const results = await Promise.all(
      Array.from(
        { length: 4 },
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

    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r === 'suppressed')).toHaveLength(3);
  });

  it('반증: 상태 디렉터리를 만들 수 없으면 보내는 쪽으로 기운다', () => {
    const notADir = join(dir, 'file');
    writeFileSync(notADir, 'x', 'utf8');
    expect(shouldSendBootAlert(10_000, 5_000, join(notADir, 'sub'))).toBe(true);
  });
});
