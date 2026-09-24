import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvFile } from '@/config/env-file';

describe('loadEnvFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-file-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ENVFILE_PROBE;
    delete process.env.ENVFILE_KEEP;
  });

  it('.env 값을 process.env에 올리되, 이미 있는 값은 덮지 않는다', () => {
    writeFileSync(
      join(dir, '.env'),
      'ENVFILE_PROBE=from-file\nENVFILE_KEEP=from-file\n',
    );
    process.env.ENVFILE_KEEP = 'already';

    loadEnvFile(join(dir, '.env'));

    expect(process.env.ENVFILE_PROBE).toBe('from-file');
    expect(process.env.ENVFILE_KEEP).toBe('already');
  });

  it('반증: 파일이 없어도 던지지 않는다(컨테이너는 env만 받는다)', () => {
    expect(() => loadEnvFile(join(dir, 'missing.env'))).not.toThrow();
    expect(process.env.ENVFILE_PROBE).toBeUndefined();
  });
});
