import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { OrderRepository } from '@/features/order/repositories/order.repository';
import { UserOrderQueryResolver } from '@/features/user/resolvers/user-order-query.resolver';
import { UserOrderService } from '@/features/user/services/user-order.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('User Order Resolver (real DB)', () => {
  let resolver: UserOrderQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserOrderQueryResolver, UserOrderService, OrderRepository],
    });
    resolver = module.get(UserOrderQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.myOrders: DB에서 본인 주문 목록을 반환한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    const order = await createOrder(prisma, {
      account_id: account.id,
      status: 'SUBMITTED',
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
    });

    const result = await resolver.myOrders(
      { accountId: account.id.toString() },
      { offset: 0, limit: 20 },
    );

    expect(result.totalCount).toBe(1);
    expect(result.items[0].orderId).toBe(order.id.toString());
  });

  it('Query.myOrder: 타 계정 주문 접근은 NotFoundException이 전파된다', async () => {
    const me = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: me.id });
    const other = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: other.id });
    const othersOrder = await createOrder(prisma, {
      account_id: other.id,
      status: 'SUBMITTED',
    });

    await expect(
      resolver.myOrder(
        { accountId: me.id.toString() },
        othersOrder.id.toString(),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
