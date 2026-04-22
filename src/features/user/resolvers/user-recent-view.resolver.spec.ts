import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRecentViewMutationResolver } from '@/features/user/resolvers/user-recent-view-mutation.resolver';
import { UserRecentViewQueryResolver } from '@/features/user/resolvers/user-recent-view-query.resolver';
import { UserRecentViewService } from '@/features/user/services/user-recent-view.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  createRecentProductView,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repositories ↔ DB 통합 경로 검증.
 * 분기별 세부 검증은 service.spec.ts에서 담당.
 */
describe('User Recent View Resolvers (real DB)', () => {
  let queryResolver: UserRecentViewQueryResolver;
  let mutationResolver: UserRecentViewMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserRecentViewQueryResolver,
        UserRecentViewMutationResolver,
        UserRecentViewService,
        RecentProductViewRepository,
        ProductRepository,
      ],
    });

    queryResolver = module.get(UserRecentViewQueryResolver);
    mutationResolver = module.get(UserRecentViewMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('Query.myRecentViewedProducts', () => {
    it('accountId 변환 + DB 조회 결과를 커넥션 형태로 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma, { store_name: '베이커리' });
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '밤 케이크',
      });
      await createRecentProductView(prisma, {
        account_id: account.id,
        product_id: product.id,
      });

      const result = await queryResolver.myRecentViewedProducts(
        { accountId: account.id.toString() },
        { offset: 0, limit: 20 },
      );

      expect(result.totalCount).toBe(1);
      expect(result.items[0]).toMatchObject({
        productId: product.id.toString(),
        productName: '밤 케이크',
        storeName: '베이커리',
      });
    });
  });

  describe('Mutation.recordProductView', () => {
    it('유효한 productId면 view를 DB에 생성한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const product = await createProduct(prisma, { is_active: true });

      const ok = await mutationResolver.recordProductView(
        { accountId: account.id.toString() },
        product.id.toString(),
      );

      expect(ok).toBe(true);
      const row = await prisma.recentProductView.findUniqueOrThrow({
        where: {
          account_id_product_id: {
            account_id: account.id,
            product_id: product.id,
          },
        },
      });
      expect(row.deleted_at).toBeNull();
    });

    it('상품이 없으면 NotFoundException이 전파된다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        mutationResolver.recordProductView(
          { accountId: account.id.toString() },
          '999999',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Mutation.clearRecentViewedProducts', () => {
    it('계정의 모든 view를 soft-delete한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      for (let i = 0; i < 2; i++) {
        await createRecentProductView(prisma, { account_id: account.id });
      }

      const ok = await mutationResolver.clearRecentViewedProducts({
        accountId: account.id.toString(),
      });

      expect(ok).toBe(true);
      const remaining = await prisma.recentProductView.count({
        where: { account_id: account.id, deleted_at: null },
      });
      expect(remaining).toBe(0);
    });
  });
});
