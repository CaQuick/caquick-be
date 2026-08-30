import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import {
  ProductBestSellerService,
  ProductRepository,
} from '@/features/product';
import { SearchRepository } from '@/features/search/repositories/search.repository';
import { SearchEntryMutationResolver } from '@/features/search/resolvers/search-entry-mutation.resolver';
import { SearchEntryQueryResolver } from '@/features/search/resolvers/search-entry-query.resolver';
import { SearchEntryService } from '@/features/search/services/search-entry.service';
import { SearchKeywordRankService } from '@/features/search/services/search-keyword-rank.service';
import type { JwtUser } from '@/global/auth';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createKeywordRankSnapshot,
  createOrder,
  createOrderItem,
  createProduct,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/집계 세부 검증은 service.spec.ts에서 담당.
 */
describe('SearchEntry Resolvers (real DB)', () => {
  let queryResolver: SearchEntryQueryResolver;
  let mutationResolver: SearchEntryMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SearchEntryQueryResolver,
        SearchEntryMutationResolver,
        SearchEntryService,
        SearchKeywordRankService,
        SearchRepository,
        ProductBestSellerService,
        ProductRepository,
        ClockService,
      ],
    });
    queryResolver = module.get(SearchEntryQueryResolver);
    mutationResolver = module.get(SearchEntryMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('popularSearchKeywords: 최신 스냅샷을 반환한다', async () => {
    const rankedAt = new Date('2026-08-31T13:00:00.000Z');
    await createKeywordRankSnapshot(prisma, {
      ranked_at: rankedAt,
      keywords: [{ keyword: '생일 케이크', count: 7 }],
    });

    const result = await queryResolver.popularSearchKeywords({ limit: 10 });

    expect(result.rankedAt).toEqual(rankedAt);
    expect(result.items).toEqual([
      { rank: 1, keyword: '생일 케이크', trend: 'NEW', searchCount: 7 },
    ]);
  });

  it('recordSearch: 로그인 사용자는 최근 검색어까지 기록한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const user = { accountId: account.id.toString() } as JwtUser;

    const result = await mutationResolver.recordSearch(' 레터링 ', user);

    expect(result).toBe(true);
    expect(await prisma.searchEvent.count()).toBe(1);
    expect(
      await prisma.searchHistory.count({
        where: { account_id: account.id, keyword: '레터링' },
      }),
    ).toBe(1);
  });

  it('recordSearch: 비로그인은 집계 이벤트만 남긴다', async () => {
    await mutationResolver.recordSearch('도넛', undefined);

    expect(await prisma.searchEvent.count()).toBe(1);
    expect(await prisma.searchHistory.count()).toBe(0);
  });

  it('realtimeBestCakes: 판매된 상품을 수량순으로 반환한다', async () => {
    const product = await createProduct(prisma, { name: '베스트' });
    const order = await createOrder(prisma, { status: 'CONFIRMED' });
    await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
      quantity: 2,
    });

    const result = await queryResolver.realtimeBestCakes({ limit: 5 });

    expect(result.items.map((i) => i.name)).toEqual(['베스트']);
    expect(result.rankedAt).toBeInstanceOf(Date);
  });

  it('searchBanner: 등록된 SEARCH 배너가 없으면 null', async () => {
    expect(await queryResolver.searchBanner()).toBeNull();
  });
});
