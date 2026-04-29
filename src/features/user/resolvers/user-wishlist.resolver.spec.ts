import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserWishlistMutationResolver } from '@/features/user/resolvers/user-wishlist-mutation.resolver';
import { UserWishlistQueryResolver } from '@/features/user/resolvers/user-wishlist-query.resolver';
import { UserWishlistService } from '@/features/user/services/user-wishlist.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('User Wishlist Resolver (real DB)', () => {
  let mutationResolver: UserWishlistMutationResolver;
  let queryResolver: UserWishlistQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserWishlistMutationResolver,
        UserWishlistQueryResolver,
        UserWishlistService,
        UserRepository,
        ProductRepository,
      ],
    });
    mutationResolver = module.get(UserWishlistMutationResolver);
    queryResolver = module.get(UserWishlistQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('addToWishlist → 존재하지 않는 productId면 NotFoundException 전파', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });

    await expect(
      mutationResolver.addToWishlist(
        { accountId: account.id.toString() },
        '999999',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('addToWishlist → removeFromWishlist → myWishlist 시나리오', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });

    await mutationResolver.addToWishlist(
      { accountId: account.id.toString() },
      product.id.toString(),
    );

    const list1 = await queryResolver.myWishlist({
      accountId: account.id.toString(),
    });
    expect(list1.totalCount).toBe(1);
    expect(list1.items[0].productId).toBe(product.id.toString());

    await mutationResolver.removeFromWishlist(
      { accountId: account.id.toString() },
      product.id.toString(),
    );

    const list2 = await queryResolver.myWishlist({
      accountId: account.id.toString(),
    });
    expect(list2.totalCount).toBe(0);
    expect(list2.items).toEqual([]);
  });
});
