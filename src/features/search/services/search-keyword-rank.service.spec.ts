import type { PrismaClient } from '@prisma/client';

import { SearchRepository } from '@/features/search/repositories/search.repository';
import {
  SearchKeywordRankService,
  truncateToHour,
} from '@/features/search/services/search-keyword-rank.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createKeywordRankSnapshot, createSearchEvent } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SearchKeywordRankService (real DB)', () => {
  let service: SearchKeywordRankService;
  let prisma: PrismaClient;

  const NOW = new Date('2026-08-31T13:37:12.000Z');
  const RANKED_AT = new Date('2026-08-31T13:00:00.000Z');
  const PREV_AT = new Date('2026-08-31T12:00:00.000Z');

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SearchKeywordRankService, SearchRepository],
    });
    service = module.get(SearchKeywordRankService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function addEvents(keyword: string, count: number, at: Date) {
    for (let i = 0; i < count; i++) {
      await createSearchEvent(prisma, { keyword, created_at: at });
    }
  }

  async function snapshotRows(rankedAt: Date) {
    return prisma.searchKeywordRankSnapshot.findMany({
      where: { ranked_at: rankedAt },
      orderBy: { rank: 'asc' },
    });
  }

  describe('truncateToHour', () => {
    it('분·초·밀리초를 버려 정각으로 만든다', () => {
      expect(truncateToHour(NOW)).toEqual(RANKED_AT);
    });
  });

  describe('captureSnapshot', () => {
    it('직전 24시간 이벤트를 keyword별로 세어 count desc → keyword asc로 저장한다', async () => {
      const inWindow = new Date('2026-08-31T00:00:00.000Z');
      await addEvents('생일 케이크', 3, inWindow);
      await addEvents('과일 케이크', 2, inWindow);
      await addEvents('강아지 케이크', 2, inWindow);
      // 윈도우 밖(24시간 이전) — 제외
      await addEvents('오래된', 5, new Date('2026-08-30T12:59:59.000Z'));
      // 정각 이후(현재 시각 사이) — 다음 스냅샷 몫
      await addEvents('미래', 5, new Date('2026-08-31T13:10:00.000Z'));

      const created = await service.captureSnapshot(NOW);

      expect(created).toBe(true);
      const rows = await snapshotRows(RANKED_AT);
      expect(rows.map((r) => [r.rank, r.keyword, r.search_count])).toEqual([
        [1, '생일 케이크', 3],
        [2, '강아지 케이크', 2],
        [3, '과일 케이크', 2],
      ]);
    });

    it('상위 20건까지만 저장한다', async () => {
      const at = new Date('2026-08-31T10:00:00.000Z');
      for (let i = 0; i < 25; i++) {
        await addEvents(`k${i.toString().padStart(2, '0')}`, 25 - i, at);
      }

      await service.captureSnapshot(NOW);

      const rows = await snapshotRows(RANKED_AT);
      expect(rows).toHaveLength(20);
      expect(rows[19].keyword).toBe('k19');
    });

    it('같은 정각 스냅샷이 이미 있으면 만들지 않는다(멱등)', async () => {
      await addEvents('생일', 1, new Date('2026-08-31T10:00:00.000Z'));
      expect(await service.captureSnapshot(NOW)).toBe(true);

      await addEvents('추가', 9, new Date('2026-08-31T11:00:00.000Z'));
      expect(
        await service.captureSnapshot(new Date('2026-08-31T13:59:00.000Z')),
      ).toBe(false);

      const rows = await snapshotRows(RANKED_AT);
      expect(rows.map((r) => r.keyword)).toEqual(['생일']);
    });

    it('윈도우에 이벤트가 없으면 스냅샷을 남기지 않는다', async () => {
      expect(await service.captureSnapshot(NOW)).toBe(false);
      expect(await prisma.searchKeywordRankSnapshot.count()).toBe(0);
    });

    it('soft-delete된 이벤트는 집계에서 제외한다', async () => {
      const at = new Date('2026-08-31T10:00:00.000Z');
      await createSearchEvent(prisma, {
        keyword: '삭제됨',
        created_at: at,
        deleted_at: at,
      });
      await addEvents('유효', 1, at);

      await service.captureSnapshot(NOW);

      const rows = await snapshotRows(RANKED_AT);
      expect(rows.map((r) => r.keyword)).toEqual(['유효']);
    });
  });

  describe('popularSearchKeywords', () => {
    it('스냅샷이 없으면 빈 목록 + rankedAt null', async () => {
      const result = await service.popularSearchKeywords();
      expect(result).toEqual({ items: [], rankedAt: null });
    });

    it('최신 스냅샷을 직전 스냅샷과 비교해 UP/DOWN/SAME/NEW를 매긴다', async () => {
      await createKeywordRankSnapshot(prisma, {
        ranked_at: PREV_AT,
        keywords: [
          { keyword: '과일' }, // 1 → 2: DOWN
          { keyword: '생일' }, // 2 → 1: UP
          { keyword: '크리스마스' }, // 3 → 3: SAME
          { keyword: '사라짐' },
        ],
      });
      await createKeywordRankSnapshot(prisma, {
        ranked_at: RANKED_AT,
        keywords: [
          { keyword: '생일', count: 30 },
          { keyword: '과일', count: 20 },
          { keyword: '크리스마스', count: 10 },
          { keyword: '연인', count: 5 }, // 직전에 없음: NEW
        ],
      });

      const result = await service.popularSearchKeywords();

      expect(result.rankedAt).toEqual(RANKED_AT);
      expect(
        result.items.map((i) => [i.rank, i.keyword, i.trend, i.searchCount]),
      ).toEqual([
        [1, '생일', 'UP', 30],
        [2, '과일', 'DOWN', 20],
        [3, '크리스마스', 'SAME', 10],
        [4, '연인', 'NEW', 5],
      ]);
    });

    it('직전 스냅샷이 없으면 전부 NEW', async () => {
      await createKeywordRankSnapshot(prisma, {
        ranked_at: RANKED_AT,
        keywords: [{ keyword: '생일' }, { keyword: '과일' }],
      });

      const result = await service.popularSearchKeywords();

      expect(result.items.map((i) => i.trend)).toEqual(['NEW', 'NEW']);
    });

    it('직전 스냅샷은 정확히 1시간 전이 아니어도 가장 최근 이전 것을 쓴다', async () => {
      await createKeywordRankSnapshot(prisma, {
        ranked_at: new Date('2026-08-30T20:00:00.000Z'),
        keywords: [{ keyword: '과일' }, { keyword: '생일' }],
      });
      await createKeywordRankSnapshot(prisma, {
        ranked_at: RANKED_AT,
        keywords: [{ keyword: '생일' }],
      });

      const result = await service.popularSearchKeywords();

      expect(result.items[0].trend).toBe('UP');
    });

    it('limit만큼만 노출하고 변동 비교는 직전 스냅샷 전체(20건)와 한다', async () => {
      await createKeywordRankSnapshot(prisma, {
        ranked_at: PREV_AT,
        keywords: Array.from({ length: 15 }, (_, i) => ({
          keyword: `k${i}`,
        })),
      });
      // k14(직전 15위)가 1위로: NEW가 아니라 UP
      await createKeywordRankSnapshot(prisma, {
        ranked_at: RANKED_AT,
        keywords: [{ keyword: 'k14' }, { keyword: 'k0' }, { keyword: 'k1' }],
      });

      const result = await service.popularSearchKeywords({ limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ keyword: 'k14', trend: 'UP' });
    });
  });
});
