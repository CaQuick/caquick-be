import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import type { StartedTestContainer } from 'testcontainers';

const TMP_DIR = join(process.cwd(), '.tmp');
const STATE_FILE = join(TMP_DIR, 'test-db-state.json');

export default async function globalTeardown(): Promise<void> {
  const container = (
    globalThis as unknown as { __TESTCONTAINER__?: StartedTestContainer }
  ).__TESTCONTAINER__;

  try {
    if (container) {
      console.log('[test] stopping MySQL container...');
      await container.stop({ timeout: 5000 });
    }
  } finally {
    // 컨테이너 stop 실패와 무관하게 state 파일 + schema marker 정리
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
    if (existsSync(TMP_DIR)) {
      for (const name of readdirSync(TMP_DIR)) {
        if (name.startsWith('schema-applied-') && name.endsWith('.marker')) {
          unlinkSync(join(TMP_DIR, name));
        }
      }
    }
  }
}
