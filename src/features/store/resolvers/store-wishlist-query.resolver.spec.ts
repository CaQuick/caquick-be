// 전체 경로(리졸버→서비스→레포지토리→DB) 통합 검증. 분기/집계 세부 검증은 store-wishlist.service.spec.ts에서 담당.
import type { PrismaClient } from '@prisma/client';

import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreWishlistQueryResolver } from '@/features/store/resolvers/store-wishlist-query.resolver';
import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Store Wishlist Query Resolver (real DB)', () => {
  let resolver: StoreWishlistQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreWishlistQueryResolver,
        StoreWishlistService,
        StoreWishlistRepository,
        StoreRepository,
      ],
    });
    resolver = module.get(StoreWishlistQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('myWishlistedStores: accountId 변환 후 찜한 매장 목록을 반환한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const store = await createStore(prisma, {
      store_name: '해즈케이크',
      profile_image_url: 'https://cdn.example.com/haz-logo.png',
    });
    await createStoreWishlist(prisma, {
      account_id: account.id,
      store_id: store.id,
    });

    const result = await resolver.myWishlistedStores({
      accountId: account.id.toString(),
    });

    expect(result.totalCount).toBe(1);
    expect(result.items[0].storeId).toBe(store.id.toString());
    expect(result.items[0].storeName).toBe('해즈케이크');
    expect(result.items[0].profileImageUrl).toBe(
      'https://cdn.example.com/haz-logo.png',
    );
  });

  it('myWishlistedStores: 찜이 없으면 빈 목록을 반환한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });

    const result = await resolver.myWishlistedStores({
      accountId: account.id.toString(),
    });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});
