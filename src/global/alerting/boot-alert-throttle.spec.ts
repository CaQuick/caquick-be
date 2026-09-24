import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { shouldSendBootAlert } from '@/global/alerting/boot-alert-throttle';

describe('shouldSendBootAlert', () => {
  let dir: string;
  let statePath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'boot-alert-'));
    statePath = join(dir, 'state.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('처음은 보내고, 창 안의 두 번째(재시작)는 억제하며, 창이 지나면 다시 보낸다', () => {
    expect(shouldSendBootAlert(1_000_000, 5_000, statePath)).toBe(true);
    // 새 프로세스를 흉내 — 같은 파일을 다시 읽는다
    expect(shouldSendBootAlert(1_004_999, 5_000, statePath)).toBe(false);
    expect(shouldSendBootAlert(1_005_000, 5_000, statePath)).toBe(true);
  });

  it('반증: 깨진 상태 파일은 "보낸 적 없음"으로 본다', () => {
    writeFileSync(statePath, '{not json', 'utf8');
    expect(shouldSendBootAlert(1_000_000, 5_000, statePath)).toBe(true);
  });

  it('반증: 상태 파일을 쓸 수 없어도 보내는 쪽으로 기운다', () => {
    const unwritable = join(dir, 'missing-dir-file', 'x', 'state.json');
    writeFileSync(join(dir, 'missing-dir-file'), 'a file, not a dir', 'utf8');
    expect(shouldSendBootAlert(1_000_000, 5_000, unwritable)).toBe(true);
  });
});
