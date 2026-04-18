import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import type { StartedTestContainer } from 'testcontainers';

const STATE_FILE = join(process.cwd(), '.tmp', 'test-db-state.json');

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
    // 컨테이너 stop 실패와 무관하게 state 파일은 반드시 정리
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  }
}
