import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreDetailQueryResolver } from '@/features/store/resolvers/store-detail-query.resolver';
import { StoreDetailService } from '@/features/store/services/store-detail.service';
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
describe('Store Detail Query Resolver (real DB)', () => {
  let resolver: StoreDetailQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreDetailQueryResolver,
        StoreDetailService,
        StoreRepository,
        StoreWishlistRepository,
      ],
    });
    resolver = module.get(StoreDetailQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('storeDetail: 비로그인 사용자에게 매장 상세를 반환한다', async () => {
    const store = await createStore(prisma, { store_name: '해즈케이크' });

    const result = await resolver.storeDetail(store.id.toString(), undefined);

    expect(result.id).toBe(store.id.toString());
    expect(result.storeName).toBe('해즈케이크');
    expect(result.isWishlisted).toBe(false);
  });

  it('storeDetail: 로그인 사용자(JwtUser)의 찜 여부를 채운다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const store = await createStore(prisma);
    await createStoreWishlist(prisma, {
      account_id: account.id,
      store_id: store.id,
    });

    const result = await resolver.storeDetail(store.id.toString(), {
      accountId: account.id.toString(),
    });

    expect(result.isWishlisted).toBe(true);
  });

  it('storeDetail: 없는 매장은 NotFoundException', async () => {
    await expect(
      resolver.storeDetail('999999', undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
