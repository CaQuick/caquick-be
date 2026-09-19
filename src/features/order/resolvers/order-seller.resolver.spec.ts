import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { SellerOrderMutationResolver } from '@/features/order/resolvers/order-seller-mutation.resolver';
import { SellerOrderQueryResolver } from '@/features/order/resolvers/order-seller-query.resolver';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
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
        StoreSellerRepository,
        OrderRepository,
        OrderStatusTransitionPolicy,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
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

  it('Mutation.sellerUpdateOrderStatus: 타 store 주문 접근은 404 전파', async () => {
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
    ).rejects.toThrowDomain(404);
  });
});
