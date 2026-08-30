import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { ProductRepository } from '@/features/product';
import { SearchRepository } from '@/features/search/repositories/search.repository';
import { SearchEntryService } from '@/features/search/services/search-entry.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createSearchHistory,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SearchEntryService (real DB)', () => {
  let service: SearchEntryService;
  let prisma: PrismaClient;
  let clock: ClockService;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SearchEntryService,
        SearchRepository,
        ProductRepository,
        ClockService,
      ],
    });
    service = module.get(SearchEntryService);
    clock = module.get(ClockService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.restoreAllMocks();
  });

  async function searchEvents() {
    return prisma.searchEvent.findMany({ orderBy: { id: 'asc' } });
  }

  async function activeHistories(accountId: bigint) {
    return prisma.searchHistory.findMany({
      where: { account_id: accountId },
      orderBy: { id: 'asc' },
    });
  }

  describe('recordSearch', () => {
    it('비로그인은 정규화된 검색어로 SearchEvent만 남긴다', async () => {
      const result = await service.recordSearch('  딸기   케이크 ');

      expect(result).toBe(true);
      const events = await searchEvents();
      expect(events).toHaveLength(1);
      expect(events[0].keyword).toBe('딸기 케이크');
      expect(events[0].account_id).toBeNull();
      expect(events[0].context).toBe('GLOBAL');
      expect(await prisma.searchHistory.count()).toBe(0);
    });

    it('로그인은 SearchEvent + SearchHistory를 함께 기록한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const now = new Date('2026-08-31T03:00:00.000Z');
      jest.spyOn(clock, 'now').mockReturnValue(now);

      await service.recordSearch('레터링', account.id);

      const events = await searchEvents();
      expect(events).toHaveLength(1);
      expect(events[0].account_id).toBe(account.id);
      const histories = await activeHistories(account.id);
      expect(histories).toHaveLength(1);
      expect(histories[0].keyword).toBe('레터링');
      expect(histories[0].last_used_at).toEqual(now);
    });

    it('같은 검색어 재검색은 SearchHistory를 1건으로 유지하고 last_used_at만 갱신한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createSearchHistory(prisma, {
        account_id: account.id,
        keyword: '레터링',
        last_used_at: new Date('2026-01-01T00:00:00.000Z'),
      });
      const now = new Date('2026-08-31T03:00:00.000Z');
      jest.spyOn(clock, 'now').mockReturnValue(now);

      await service.recordSearch('레터링', account.id);

      const histories = await activeHistories(account.id);
      expect(histories).toHaveLength(1);
      expect(histories[0].last_used_at).toEqual(now);
      // 집계 이벤트는 검색 횟수만큼 쌓인다
      expect(await searchEvents()).toHaveLength(1);
    });

    it('soft-delete된 최근 검색어는 복원한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createSearchHistory(prisma, {
        account_id: account.id,
        keyword: '도넛',
        deleted_at: new Date('2026-01-02T00:00:00.000Z'),
      });

      await service.recordSearch('도넛', account.id);

      const histories = await activeHistories(account.id);
      expect(histories).toHaveLength(1);
      expect(histories[0].deleted_at).toBeNull();
    });

    it('공백만 있는 검색어는 400', async () => {
      await expect(service.recordSearch('   ')).rejects.toThrow(
        BadRequestException,
      );
      expect(await searchEvents()).toHaveLength(0);
    });

    it('200자를 넘는 검색어는 400', async () => {
      await expect(service.recordSearch('a'.repeat(201))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('searchBanner', () => {
    const now = new Date('2026-08-31T03:00:00.000Z');

    async function makeBanner(
      overrides: Partial<Parameters<typeof prisma.banner.create>[0]['data']>,
    ) {
      return prisma.banner.create({
        data: {
          placement: 'SEARCH',
          image_url: 'https://img/search.png',
          link_type: 'NONE',
          ...overrides,
        },
      });
    }

    it('placement=SEARCH 활성 배너를 sort_order 순으로 1건 반환한다', async () => {
      jest.spyOn(clock, 'now').mockReturnValue(now);
      await makeBanner({ image_url: 'https://img/second.png', sort_order: 2 });
      await makeBanner({ image_url: 'https://img/first.png', sort_order: 1 });
      await makeBanner({
        placement: 'HOME_MAIN',
        image_url: 'https://img/home.png',
      });

      const banner = await service.searchBanner();

      expect(banner).toMatchObject({
        imageUrl: 'https://img/first.png',
        linkType: 'NONE',
      });
    });

    it('노출 기간 밖·비활성·링크 대상이 내려간 배너는 건너뛴다', async () => {
      jest.spyOn(clock, 'now').mockReturnValue(now);
      await makeBanner({ starts_at: new Date('2026-09-01T00:00:00.000Z') });
      await makeBanner({ ends_at: new Date('2026-08-01T00:00:00.000Z') });
      await makeBanner({ is_active: false });
      const closedStore = await createStore(prisma, { is_active: false });
      await makeBanner({ link_type: 'STORE', link_store_id: closedStore.id });

      expect(await service.searchBanner()).toBeNull();
    });
  });
});
