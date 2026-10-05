import { PubSub } from 'graphql-subscriptions';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { OrderSubscriptionService } from '@/features/order/services/order-subscription.service';
import type { SellerOrderUpdateEvent } from '@/features/order/types/order-seller-output.type';
import { StoreSellerRepository } from '@/features/store';
import type { PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('OrderSubscriptionService (real DB)', () => {
  let service: OrderSubscriptionService;
  let events: OrderEventsService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OrderSubscriptionService,
        OrderEventsService,
        StoreSellerRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        // 발행-구독 왕복은 실 Redis spec(events service) 담당 — 여기선 in-memory
        { provide: PUB_SUB, useValue: new PubSub() },
      ],
    });
    service = module.get(OrderSubscriptionService);
    events = module.get(OrderEventsService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function seller(storeOverrides: Parameters<typeof createStore>[1]) {
    const account = await createAccount(prisma, { account_type: 'SELLER' });
    const store = await createStore(prisma, {
      seller_account_id: account.id,
      ...storeOverrides,
    });
    return { account, store };
  }

  const event: SellerOrderUpdateEvent = {
    orderId: '1',
    orderNumber: 'ORD-1',
    status: 'SUBMITTED',
    pickupAt: '2026-09-18T05:00:00.000Z',
    buyerName: '차차',
    totalPrice: 10000,
    productName: '케이크',
    updatedAt: '2026-09-16T07:00:00.000Z',
  };

  it('매장 보유 판매자는 구독하고 자기 매장 토픽의 이벤트만 받는다', async () => {
    const { account, store } = await seller({});
    const other = await seller({});

    const iterator = await service.subscribeSellerOrderUpdates(account.id);
    const pending = iterator.next();

    await events.publishSellerOrderUpdate(other.store.id, {
      ...event,
      orderId: 'other',
    });
    await events.publishSellerOrderUpdate(store.id, event);

    const { value } = await pending;
    expect(value).toEqual(event);
    await iterator.return?.();
  });

  it('매장이 없거나 삭제됐으면 STORE_NOT_FOUND', async () => {
    const noStore = await createAccount(prisma, { account_type: 'SELLER' });
    const deleted = await seller({ deleted_at: new Date() });

    await expect(
      service.subscribeSellerOrderUpdates(noStore.id),
    ).rejects.toThrowDomain('STORE_NOT_FOUND');
    await expect(
      service.subscribeSellerOrderUpdates(deleted.account.id),
    ).rejects.toThrowDomain('STORE_NOT_FOUND');
  });

  it('비활성(is_active=false) 매장도 구독은 유지된다', async () => {
    const { account } = await seller({ is_active: false });
    const iterator = await service.subscribeSellerOrderUpdates(account.id);
    expect(iterator).toBeDefined();
    await iterator.return?.();
  });
});
