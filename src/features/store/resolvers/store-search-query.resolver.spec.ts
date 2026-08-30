import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreSearchQueryResolver } from '@/features/store/resolvers/store-search-query.resolver';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StoreSearchService } from '@/features/store/services/store-search.service';
import type { JwtUser } from '@/global/auth';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/집계 세부 검증은 service.spec.ts에서 담당.
 */
describe('StoreSearchQueryResolver (real DB)', () => {
  let resolver: StoreSearchQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreSearchQueryResolver,
        StoreSearchService,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
        ClockService,
      ],
    });
    resolver = module.get(StoreSearchQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('searchStores: 로그인 사용자의 찜 여부를 채운다', async () => {
    const store = await createStore(prisma, { store_name: '리졸버 매장' });
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createStoreWishlist(prisma, {
      account_id: account.id,
      store_id: store.id,
    });
    const user = { accountId: account.id.toString() } as JwtUser;

    const result = await resolver.searchStores({ keyword: '리졸버' }, user);

    expect(result.totalCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      storeName: '리졸버 매장',
      isWishlisted: true,
    });
  });

  it('searchStores: 비로그인은 isWishlisted=false', async () => {
    await createStore(prisma, { store_name: '리졸버 매장' });

    const result = await resolver.searchStores(
      { keyword: '리졸버' },
      undefined,
    );

    expect(result.items[0].isWishlisted).toBe(false);
  });
});
