import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { shouldSendBootAlert } from '@/global/alerting/boot-alert-throttle';

describe('shouldSendBootAlert', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boot-alert-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('창의 첫 호출만 보내고, 같은 창의 재호출(재시작)은 억제하며, 다음 창은 다시 보낸다', () => {
    expect(shouldSendBootAlert(10_000, 5_000, dir)).toBe(true);
    expect(shouldSendBootAlert(14_999, 5_000, dir)).toBe(false);
    expect(shouldSendBootAlert(15_000, 5_000, dir)).toBe(true);
    // 이긴 쪽이 직전 창 표식을 치운다
    expect(existsSync(join(dir, 'window-2'))).toBe(false);
    expect(existsSync(join(dir, 'window-3'))).toBe(true);
  });

  it('반증: 프로세스 4개가 같은 창을 동시에 잡아도 정확히 1개만 보낸다(O_EXCL)', () => {
    // 같은 코드를 별도 프로세스 4개에서 동시에 실행한다 — 파일 생성의 원자성이 억제의 근거다
    const script = `
      const { closeSync, openSync, mkdirSync } = require('node:fs');
      const path = require('node:path');
      const dir = process.argv[1]; mkdirSync(dir, { recursive: true });
      try { closeSync(openSync(path.join(dir, 'window-2'), 'wx')); process.stdout.write('sent'); }
      catch (e) { process.stdout.write(e.code === 'EEXIST' ? 'suppressed' : 'error'); }
    `;
    const results = Array.from(
      { length: 4 },
      () =>
        spawnSync(process.execPath, ['-e', script, dir], { encoding: 'utf8' })
          .stdout,
    );
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r === 'suppressed')).toHaveLength(3);
    // 같은 창을 우리 함수로 다시 잡으면 억제된다
    expect(shouldSendBootAlert(12_000, 5_000, dir)).toBe(false);
  });

  it('반증: 상태 디렉터리를 만들 수 없으면 보내는 쪽으로 기운다', () => {
    const notADir = join(dir, 'file');
    writeFileSync(notADir, 'x', 'utf8');
    expect(shouldSendBootAlert(10_000, 5_000, join(notADir, 'sub'))).toBe(true);
  });
});
