import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import {
  OrderDomainService,
  OrderRepository,
  OrderStatusTransitionPolicy,
} from '@/features/order';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerOrderMutationResolver } from '@/features/seller/resolvers/seller-order-mutation.resolver';
import { SellerOrderQueryResolver } from '@/features/seller/resolvers/seller-order-query.resolver';
import { SellerOrderService } from '@/features/seller/services/seller-order.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Seller Order Resolvers (real DB)', () => {
  let queryResolver: SellerOrderQueryResolver;
  let mutationResolver: SellerOrderMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerOrderQueryResolver,
        SellerOrderMutationResolver,
        SellerOrderService,
        SellerRepository,
        OrderRepository,
        OrderDomainService,
        OrderStatusTransitionPolicy,
      ],
    });
    queryResolver = module.get(SellerOrderQueryResolver);
    mutationResolver = module.get(SellerOrderMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupOrderForStore(storeId: bigint) {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    const order = await createOrder(prisma, {
      account_id: buyer.id,
      status: 'SUBMITTED',
    });
    await createOrderItem(prisma, { order_id: order.id, store_id: storeId });
    return order;
  }

  it('Query.sellerOrderList: 자기 store 주문만 반환', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    await setupOrderForStore(me.store.id);
    await setupOrderForStore(other.store.id);

    const result = await queryResolver.sellerOrderList({
      accountId: me.account.id.toString(),
    });
    expect(result.items).toHaveLength(1);
  });

  it('Mutation.sellerUpdateOrderStatus: 타 store 주문 접근은 NotFoundException 전파', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    const othersOrder = await setupOrderForStore(other.store.id);

    await expect(
      mutationResolver.sellerUpdateOrderStatus(
        { accountId: me.account.id.toString() },
        {
          orderId: othersOrder.id.toString(),
          toStatus: 'CONFIRMED',
          note: null,
        } as never,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
