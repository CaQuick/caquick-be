import { PubSub } from 'graphql-subscriptions';

import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderPickupChangeRepository } from '@/features/order/repositories/order-pickup-change.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { SellerOrderPickupMutationResolver } from '@/features/order/resolvers/order-seller-pickup-mutation.resolver';
import { SellerOrderPickupQueryResolver } from '@/features/order/resolvers/order-seller-pickup-query.resolver';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { SellerOrderPickupService } from '@/features/order/services/order-seller-pickup.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrder,
  createOrderItem,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

// 2026-09-16(수) 16:00 KST
const NOW = new Date('2026-09-16T07:00:00.000Z');

describe('Seller Order Pickup Resolvers (real DB)', () => {
  let queryResolver: SellerOrderPickupQueryResolver;
  let mutationResolver: SellerOrderPickupMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerOrderPickupQueryResolver,
        SellerOrderPickupMutationResolver,
        SellerOrderPickupService,
        StoreSellerRepository,
        StoreRepository,
        StorePickupScheduleService,
        OrderRepository,
        OrderPickupChangeRepository,
        OrderStatusTransitionPolicy,
        OrderEventsService,
        { provide: PUB_SUB, useValue: new PubSub() },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: ClockService, useValue: { now: () => NOW } },
        ...bookedQuantityProviders(),
        ...outboxPublisherProviders({ clock: true }),
      ],
    });
    queryResolver = module.get(SellerOrderPickupQueryResolver);
    mutationResolver = module.get(SellerOrderPickupMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function confirmedOrder() {
    const me = await setupSellerWithStore(prisma);
    await prisma.storeBusinessHour.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        store_id: me.store.id,
        day_of_week: dayOfWeek,
        is_closed: false,
        open_time: new Date(Date.UTC(1970, 0, 1, 10)),
        close_time: new Date(Date.UTC(1970, 0, 1, 20)),
      })),
    });
    const order = await createOrder(prisma, {
      status: 'CONFIRMED',
      pickup_at: new Date('2026-09-18T05:00:00.000Z'),
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: me.store.id,
    });
    return { user: { accountId: me.account.id.toString() }, order };
  }

  it('Query.sellerOrderPickupCalendar·TimeSlots: ID를 파싱해 변경 시트 달력과 슬롯을 준다', async () => {
    const { user, order } = await confirmedOrder();

    const calendar = await queryResolver.sellerOrderPickupCalendar(
      user,
      order.id.toString(),
      '2026-09',
    );
    const slots = await queryResolver.sellerOrderPickupTimeSlots(
      user,
      order.id.toString(),
      '2026-09-17',
    );

    expect(calendar.yearMonth).toBe('2026-09');
    expect(calendar.days.find((d) => d.date === '2026-09-17')?.selectable).toBe(
      true,
    );
    expect(slots.date).toBe('2026-09-17');
    expect(slots.morning.length).toBeGreaterThan(0);
  });

  it('Mutation.sellerRescheduleOrderPickup: 픽업 일시를 바꾸고 요약을 반환한다', async () => {
    const { user, order } = await confirmedOrder();
    const pickupAt = new Date('2026-09-17T06:30:00.000Z');

    const result = await mutationResolver.sellerRescheduleOrderPickup(user, {
      orderId: order.id.toString(),
      pickupAt,
    });

    expect(result).toMatchObject({ id: order.id.toString(), pickupAt });
  });
});
