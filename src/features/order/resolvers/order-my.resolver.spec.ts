import { PubSub } from 'graphql-subscriptions';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { PaymentRepository } from '@/features/order/repositories/payment.repository';
import { RefundRepository } from '@/features/order/repositories/refund.repository';
import { UserOrderMutationResolver } from '@/features/order/resolvers/order-my-mutation.resolver';
import { UserOrderQueryResolver } from '@/features/order/resolvers/order-my-query.resolver';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { UserOrderService } from '@/features/order/services/order-my.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { PUB_SUB } from '@/global/pubsub';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createPayment,
  createProduct,
  createRefund,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

describe('User Order Resolver (real DB)', () => {
  let resolver: UserOrderQueryResolver;
  let mutationResolver: UserOrderMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserOrderQueryResolver,
        UserOrderMutationResolver,
        UserOrderService,
        OrderRepository,
        PaymentRepository,
        OrderTransitionRepository,
        OrderCancelPolicy,
        OrderEventsService,
        RefundRepository,
        { provide: AccountCipher, useValue: createTestAccountCipher() },
        { provide: PUB_SUB, useValue: new PubSub() },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders(),
      ],
    });
    resolver = module.get(UserOrderQueryResolver);
    mutationResolver = module.get(UserOrderMutationResolver);
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
    const store = await createStore(prisma, {
      address_city: '인천',
      address_neighborhood: '청라동',
    });
    const product = await createProduct(prisma, { store_id: store.id });
    const order = await createOrder(prisma, {
      account_id: account.id,
      status: 'SUBMITTED',
      subtotal_price: 40000,
      discount_price: 5000,
      total_price: 35000,
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
    expect(result.items[0]).toMatchObject({
      orderId: order.id.toString(),
      discountRate: 13,
      regionLabel: '인천 청라동',
    });
  });

  it('Query.myOrder: 타 계정 주문 접근은 404가 전파된다', async () => {
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
    ).rejects.toThrowDomain(404);
  });

  it("Mutation.markMyOrderDepositSent: ID를 파싱해 '입금했어요'를 기록하고 상세를 반환한다", async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const order = await createOrder(prisma, {
      account_id: account.id,
      status: 'PENDING_PAYMENT',
    });
    await createPayment(prisma, {
      order_id: order.id,
      expires_at: new Date(Date.now() + 60 * 60_000),
    });

    const result = await mutationResolver.markMyOrderDepositSent(
      { accountId: account.id.toString() },
      order.id.toString(),
    );

    expect(result.orderId).toBe(order.id.toString());
    expect(result.payment?.buyerClaimedAt).toBeInstanceOf(Date);
  });

  it('Mutation.cancelMyOrder: 입금 대기 주문을 취소하고 상세(취소 정보·취소 불가)를 반환한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const order = await createOrder(prisma, {
      account_id: account.id,
      status: 'PENDING_PAYMENT',
    });
    await createOrderItem(prisma, { order_id: order.id });
    await createPayment(prisma, { order_id: order.id });

    const result = await mutationResolver.cancelMyOrder(
      { accountId: account.id.toString() },
      { orderId: order.id.toString(), note: '다시 주문할게요' },
    );

    expect(result).toMatchObject({
      status: 'CANCELED',
      canCancel: false,
      cancellation: {
        actorType: 'BUYER',
        reason: 'BUYER_REQUEST',
        note: '다시 주문할게요',
        refundAmount: 0,
      },
    });
  });

  it('Mutation.submitMyRefundAccount: ID를 파싱해 계좌를 넣고 상세(송금 대기·마스킹)를 반환한다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const order = await createOrder(prisma, {
      account_id: account.id,
      status: 'CANCELED',
    });
    const refund = await createRefund(prisma, { order_id: order.id });

    const result = await mutationResolver.submitMyRefundAccount(
      { accountId: account.id.toString() },
      {
        refundId: refund.id.toString(),
        bankCode: '004',
        accountHolder: '홍길동',
        accountNumber: '12345678901',
      },
    );

    expect(result.refunds).toEqual([
      expect.objectContaining({
        id: refund.id.toString(),
        status: 'AWAITING_TRANSFER',
        accountNumberMasked: '****8901',
      }),
    ]);
  });
});
