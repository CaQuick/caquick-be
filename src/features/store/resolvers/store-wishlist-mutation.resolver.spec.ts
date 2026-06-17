import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreWishlistMutationResolver } from '@/features/store/resolvers/store-wishlist-mutation.resolver';
import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Store Wishlist Mutation Resolver (real DB)', () => {
  let resolver: StoreWishlistMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreWishlistMutationResolver,
        StoreWishlistService,
        StoreWishlistRepository,
        StoreRepository,
      ],
    });
    resolver = module.get(StoreWishlistMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('addStoreToWishlist: accountId 변환 후 찜을 생성한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const store = await createStore(prisma);

    const ok = await resolver.addStoreToWishlist(
      { accountId: account.id.toString() },
      store.id.toString(),
    );

    expect(ok).toBe(true);
    const row = await prisma.storeWishlistItem.findUniqueOrThrow({
      where: {
        account_id_store_id: {
          account_id: account.id,
          store_id: store.id,
        },
      },
    });
    expect(row.deleted_at).toBeNull();
  });

  it('addStoreToWishlist: 없는 매장이면 NotFoundException 전파', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await expect(
      resolver.addStoreToWishlist(
        { accountId: account.id.toString() },
        '999999',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('removeStoreFromWishlist: 찜을 해제한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const store = await createStore(prisma);
    await createStoreWishlist(prisma, {
      account_id: account.id,
      store_id: store.id,
    });

    const ok = await resolver.removeStoreFromWishlist(
      { accountId: account.id.toString() },
      store.id.toString(),
    );

    expect(ok).toBe(true);
    const remaining = await prisma.storeWishlistItem.count({
      where: { account_id: account.id, store_id: store.id, deleted_at: null },
    });
    expect(remaining).toBe(0);
  });
});
