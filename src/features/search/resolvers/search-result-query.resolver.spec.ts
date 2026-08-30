import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { ProductRepository, ProductSearchService } from '@/features/product';
import { SearchResultQueryResolver } from '@/features/search/resolvers/search-result-query.resolver';
import { SearchResultService } from '@/features/search/services/search-result.service';
import { StoreSearchService } from '@/features/store';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/집계 세부 검증은 service.spec.ts에서 담당.
 */
describe('SearchResultQueryResolver (real DB)', () => {
  let resolver: SearchResultQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SearchResultQueryResolver,
        SearchResultService,
        ProductSearchService,
        ProductRepository,
        StoreSearchService,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
        ClockService,
      ],
    });
    resolver = module.get(SearchResultQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('searchSummary: 상품/매장 건수를 반환한다', async () => {
    const store = await createStore(prisma, { store_name: '크리스마스 매장' });
    await createProduct(prisma, {
      store_id: store.id,
      name: '크리스마스 케이크',
    });

    const result = await resolver.searchSummary({ keyword: '크리스마스' });

    expect(result).toEqual({ productCount: 1, storeCount: 1 });
  });
});
