import type { PrismaClient } from '@prisma/client';

import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreQueryResolver } from '@/features/store/resolvers/store-query.resolver';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createRegion, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기/집계 세부 검증은 service.spec.ts에서 담당.
 */
describe('Store Query Resolver (real DB)', () => {
  let resolver: StoreQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreQueryResolver,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
      ],
    });
    resolver = module.get(StoreQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('popularStores: 서비스에 위임해 커넥션을 반환한다', async () => {
    await createStore(prisma, { store_name: '리졸버매장' });

    const result = await resolver.popularStores(undefined);

    expect(result.totalCount).toBe(1);
    expect(result.items[0].storeName).toBe('리졸버매장');
    expect(result.rankedAt).toBeInstanceOf(Date);
  });

  it('popularStores: regionIds 필터를 위임한다', async () => {
    const region = await createRegion(prisma, { level: 2, slug: 'sgg-res' });
    const target = await createStore(prisma, { region_id: region.id });
    await createStore(prisma); // region 없는 매장

    const result = await resolver.popularStores(undefined, {
      regionIds: [region.id.toString()],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(target.id.toString());
  });
});
