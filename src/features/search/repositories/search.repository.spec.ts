import type { PrismaClient } from '@prisma/client';

import { SearchRepository } from '@/features/search/repositories/search.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/** repository에서만 도달 가능한 계약(uk 충돌 흡수·빈 입력) 검증. */
describe('SearchRepository (real DB)', () => {
  let repo: SearchRepository;
  let prisma: PrismaClient;
  const rankedAt = new Date('2026-08-31T13:00:00.000Z');

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SearchRepository],
    });
    repo = module.get(SearchRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('createSnapshot', () => {
    it('빈 집계는 저장하지 않고 false', async () => {
      expect(await repo.createSnapshot({ rankedAt, rows: [] })).toBe(false);
      expect(await prisma.searchKeywordRankSnapshot.count()).toBe(0);
    });

    it('같은 ranked_at 경합(uk 충돌)은 false로 흡수하고 기존 스냅샷을 보존한다', async () => {
      const rows = [{ keyword: '생일', count: 3 }];
      expect(await repo.createSnapshot({ rankedAt, rows })).toBe(true);

      expect(
        await repo.createSnapshot({
          rankedAt,
          rows: [{ keyword: '덮어쓰기', count: 9 }],
        }),
      ).toBe(false);

      const saved = await repo.listSnapshotRows(rankedAt);
      expect(saved).toEqual([{ rank: 1, keyword: '생일', search_count: 3 }]);
    });

    it('uk 충돌이 아닌 DB 오류는 그대로 던진다', async () => {
      await expect(
        repo.createSnapshot({
          rankedAt,
          rows: [{ keyword: 'x'.repeat(201), count: 1 }],
        }),
      ).rejects.toThrow();
    });
  });
});
