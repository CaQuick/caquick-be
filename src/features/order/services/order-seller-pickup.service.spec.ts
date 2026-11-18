import { PubSub } from 'graphql-subscriptions';

import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderPickupChangeRepository } from '@/features/order/repositories/order-pickup-change.repository';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { SellerOrderPickupService } from '@/features/order/services/order-seller-pickup.service';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrder,
  createOrderItem,
  createStoreDailyCapacity,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { collectTopic } from '@/test/pubsub';

// 2026-09-16(수) 16:00 KST. 매장은 매일 10~20시, 30분 슬롯, 리드타임 3일(픽업 변경은 리드타임을 보지 않는다).
const NOW = new Date('2026-09-16T07:00:00.000Z');
const PICKUP_AT = new Date('2026-09-18T05:00:00.000Z'); // 9/18 14:00 KST
const NEW_PICKUP_AT = new Date('2026-09-17T06:30:00.000Z'); // 9/17 15:30 KST

describe('SellerOrderPickupService (real DB)', () => {
  let service: SellerOrderPickupService;
  let sellerOrders: SellerOrderService;
  let prisma: PrismaClient;
  let pubSub: PubSub;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerOrderPickupService,
        SellerOrderService,
        StoreSellerRepository,
        StoreRepository,
        StorePickupScheduleService,
        OrderRepository,
        OrderPickupChangeRepository,
        OrderTransitionRepository,
        OrderStatusTransitionPolicy,
        OrderCancelPolicy,
        OrderEventsService,
        { provide: PUB_SUB, useValue: new PubSub() },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: ClockService, useValue: { now: () => NOW } },
        ...bookedQuantityProviders(),
        ...outboxPublisherProviders({ clock: true }),
      ],
    });
    service = module.get(SellerOrderPickupService);
    sellerOrders = module.get(SellerOrderService);
    pubSub = module.get(PUB_SUB);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => jest.restoreAllMocks());

  async function openStore(opts: { isActive?: boolean } = {}) {
    const seller = await setupSellerWithStore(prisma);
    await prisma.store.update({
      where: { id: seller.store.id },
      data: {
        is_active: opts.isActive ?? true,
        pickup_slot_interval_minutes: 30,
        min_lead_time_minutes: 3 * 24 * 60,
        max_days_ahead: 14,
      },
    });
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      await prisma.storeBusinessHour.create({
        data: {
          store_id: seller.store.id,
          day_of_week: dayOfWeek,
          is_closed: false,
          open_time: new Date(Date.UTC(1970, 0, 1, 10)),
          close_time: new Date(Date.UTC(1970, 0, 1, 20)),
        },
      });
    }
    return seller;
  }

  async function storeOrder(
    storeId: bigint,
    opts: {
      status?: OrderStatus;
      pickupAt?: Date;
      quantity?: number;
      submittedAt?: Date;
      confirmDeadlineAt?: Date | null;
      confirmReminderSentAt?: Date | null;
    } = {},
  ) {
    const order = await createOrder(prisma, {
      status: opts.status ?? 'CONFIRMED',
      pickup_at: opts.pickupAt ?? PICKUP_AT,
      submitted_at: opts.submittedAt,
      confirm_deadline_at: opts.confirmDeadlineAt,
      confirm_reminder_sent_at: opts.confirmReminderSentAt,
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: storeId,
      quantity: opts.quantity ?? 1,
      product_name_snapshot: '레터링 케이크',
    });
    return order;
  }

  const reschedule = (
    accountId: bigint,
    orderId: bigint,
    pickupAt = NEW_PICKUP_AT,
    note: string | null = null,
  ) =>
    service.sellerRescheduleOrderPickup(accountId, {
      orderId: orderId.toString(),
      pickupAt,
      note,
    });
  const orderRow = (id: bigint) =>
    prisma.order.findUniqueOrThrow({ where: { id } });

  describe('sellerRescheduleOrderPickup', () => {
    it.each(['SUBMITTED', 'CONFIRMED', 'MADE'] as const)(
      '%s 주문은 리드타임 안쪽 슬롯으로도 옮기고 이력·감사·구매자 알림 이벤트·판매자 구독을 남긴다',
      async (status) => {
        const { account, store } = await openStore();
        const order = await storeOrder(store.id, { status });
        const topic = await collectTopic(pubSub, `order.seller.${store.id}`);

        const result = await reschedule(
          account.id,
          order.id,
          NEW_PICKUP_AT,
          '재료 수급',
        );

        expect(result).toMatchObject({ status, pickupAt: NEW_PICKUP_AT });
        expect((await orderRow(order.id)).pickup_at).toEqual(NEW_PICKUP_AT);
        expect(await prisma.orderPickupChange.findMany()).toEqual([
          expect.objectContaining({
            order_id: order.id,
            from_pickup_at: PICKUP_AT,
            to_pickup_at: NEW_PICKUP_AT,
            changed_by_account_id: account.id,
            note: '재료 수급',
            changed_at: NOW,
          }),
        ]);
        expect(
          await prisma.auditLog.findFirstOrThrow({
            where: { target_id: order.id },
          }),
        ).toMatchObject({
          store_id: store.id,
          target_type: 'ORDER',
          action: 'UPDATE',
          before_json: { pickupAt: PICKUP_AT.toISOString() },
          after_json: {
            pickupAt: NEW_PICKUP_AT.toISOString(),
            note: '재료 수급',
          },
        });
        const [event] = await prisma.outbox.findMany();
        expect(event).toMatchObject({
          event_type: 'order.pickup_rescheduled',
          payload_json: expect.objectContaining({
            fromPickupAt: PICKUP_AT.toISOString(),
            toPickupAt: NEW_PICKUP_AT.toISOString(),
            productName: '레터링 케이크',
          }),
        });
        expect(topic.received).toEqual([
          expect.objectContaining({
            kind: 'PICKUP_RESCHEDULED',
            pickupAt: NEW_PICKUP_AT.toISOString(),
          }),
        ]);
        topic.stop();
      },
    );

    it.each(['PICKED_UP', 'NO_SHOW', 'CANCELED'] as const)(
      '%s 주문은 PICKUP_RESCHEDULE_NOT_ALLOWED',
      async (status) => {
        const { account, store } = await openStore();
        const order = await storeOrder(store.id, { status });

        await expect(reschedule(account.id, order.id)).rejects.toThrowDomain(
          'PICKUP_RESCHEDULE_NOT_ALLOWED',
        );
        expect(await prisma.orderPickupChange.count()).toBe(0);
      },
    );

    it('입금 대기·다른 매장 주문은 없는 주문이다', async () => {
      const { account, store } = await openStore();
      const other = await openStore();
      const pending = await storeOrder(store.id, { status: 'PENDING_PAYMENT' });
      const others = await storeOrder(other.store.id);

      await expect(reschedule(account.id, pending.id)).rejects.toThrowDomain(
        'ORDER_NOT_FOUND',
      );
      await expect(reschedule(account.id, others.id)).rejects.toThrowDomain(
        'ORDER_NOT_FOUND',
      );
    });

    it('사전 확인 뒤 주문이 사라지면(잠금 조회에서 빠짐) 없는 주문이다', async () => {
      const { account, store } = await openStore();
      const order = await storeOrder(store.id);
      const repo = (service as unknown as { orderRepository: OrderRepository })
        .orderRepository;
      const original = repo.findOrderDetailByStore.bind(repo);
      jest
        .spyOn(repo, 'findOrderDetailByStore')
        .mockImplementationOnce(async (args) => {
          const row = await original(args);
          await prisma.order.update({
            where: { id: order.id },
            data: { deleted_at: NOW },
          });
          return row;
        });

      await expect(reschedule(account.id, order.id)).rejects.toThrowDomain(
        'ORDER_NOT_FOUND',
      );
      expect(await prisma.orderPickupChange.count()).toBe(0);
    });

    it('같은 일시면 PICKUP_UNCHANGED', async () => {
      const { account, store } = await openStore();
      const order = await storeOrder(store.id);

      await expect(
        reschedule(account.id, order.id, PICKUP_AT),
      ).rejects.toThrowDomain('PICKUP_UNCHANGED');
    });

    it.each([
      ['지난 시각(오늘 15:30 KST)', '2026-09-16T06:30:00.000Z'],
      ['슬롯에 정렬되지 않은 시각', '2026-09-17T06:10:00.000Z'],
      ['영업시간 밖(21:00 KST)', '2026-09-17T12:00:00.000Z'],
      ['특별휴무일', '2026-09-19T05:00:00.000Z'],
      ['예약 가능 기간 밖(15일 뒤)', '2026-10-01T05:00:00.000Z'],
    ])('%s는 PICKUP_NOT_AVAILABLE', async (_label, iso) => {
      const { account, store } = await openStore();
      await prisma.storeSpecialClosure.create({
        data: {
          store_id: store.id,
          closure_date: new Date(Date.UTC(2026, 8, 19)),
        },
      });
      const order = await storeOrder(store.id);

      await expect(
        reschedule(account.id, order.id, new Date(iso)),
      ).rejects.toThrowDomain('PICKUP_NOT_AVAILABLE');
      expect((await orderRow(order.id)).pickup_at).toEqual(PICKUP_AT);
    });

    it('오늘 남은 슬롯(16:00 KST 정각)으로는 옮길 수 있다', async () => {
      const { account, store } = await openStore();
      const order = await storeOrder(store.id);

      await reschedule(account.id, order.id, NOW);

      expect((await orderRow(order.id)).pickup_at).toEqual(NOW);
    });

    it('같은 날 다른 슬롯으로 옮길 때는 자기 수량을 빼고 센다', async () => {
      const { account, store } = await openStore();
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 2,
      });
      const order = await storeOrder(store.id, { quantity: 2 });
      const sameDay = new Date('2026-09-18T07:00:00.000Z');

      await reschedule(account.id, order.id, sameDay);

      expect((await orderRow(order.id)).pickup_at).toEqual(sameDay);
    });

    /**
     * 이 워커 DB에서 행 잠금을 기다리는 트랜잭션이 생길 때까지.
     * innodb_trx는 직전 읽기 뒤 100ms가 지나야 캐시를 다시 채우므로 그보다 길게 쉬며 읽는다.
     */
    async function waitForLockWait(): Promise<void> {
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM information_schema.innodb_trx t
          JOIN information_schema.processlist p ON p.id = t.trx_mysql_thread_id
          WHERE t.trx_state = 'LOCK WAIT' AND p.db = DATABASE()`;
        if (n > 0) return;
      }
      throw new Error('잠금 대기가 관측되지 않았다');
    }

    it('capacity 잠금을 기다린 픽업 변경은 그사이 커밋된 같은 날 점유까지 세어 초과를 거절한다', async () => {
      const { account, store } = await openStore();
      const bookingDate = new Date(Date.UTC(2026, 8, 17));
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: bookingDate,
        capacity: 2,
      });
      await storeOrder(store.id, { pickupAt: NEW_PICKUP_AT });
      const moving = await storeOrder(store.id);
      const order = await storeOrder(store.id);

      // 다른 픽업 변경이 9/17 capacity 행을 잡고 주문 하나를 9/17로 옮긴 채(커밋 전) 이 변경이 끼어든다
      let racing: Promise<unknown> | undefined;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT capacity FROM order_store_daily_limit
          WHERE store_id = ${store.id} AND booking_date = ${bookingDate}
          FOR UPDATE`;
        await tx.order.update({
          where: { id: moving.id },
          data: { pickup_at: NEW_PICKUP_AT },
        });
        racing = reschedule(account.id, order.id);
        racing.catch(() => undefined);
        await waitForLockWait();
      });

      await expect(racing).rejects.toThrowDomain('PICKUP_NOT_AVAILABLE');
      expect((await orderRow(order.id)).pickup_at).toEqual(PICKUP_AT);
      expect(await prisma.orderPickupChange.count()).toBe(0);
    });

    it('새 날짜의 제작 수량이 모자라면 PICKUP_NOT_AVAILABLE이다(다른 주문 점유 + 내 수량)', async () => {
      const { account, store } = await openStore();
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 17)),
        capacity: 2,
      });
      await storeOrder(store.id, { pickupAt: NEW_PICKUP_AT, quantity: 1 });
      const order = await storeOrder(store.id, { quantity: 2 });

      await expect(reschedule(account.id, order.id)).rejects.toThrowDomain(
        'PICKUP_NOT_AVAILABLE',
      );
      expect(await prisma.orderPickupChange.count()).toBe(0);

      // 반증: 내 수량이 1이면 들어간다
      const small = await storeOrder(store.id, { quantity: 1 });
      await reschedule(account.id, small.id);
      expect((await orderRow(small.id)).pickup_at).toEqual(NEW_PICKUP_AT);
    });

    it('숨긴 매장의 주문도 옮길 수 있다', async () => {
      const { account, store } = await openStore({ isActive: false });
      const order = await storeOrder(store.id);

      await reschedule(account.id, order.id);

      expect((await orderRow(order.id)).pickup_at).toEqual(NEW_PICKUP_AT);
    });

    it('접수 주문은 확정 마감을 새 픽업 기준으로 다시 재고 미리 알림 표시를 지운다', async () => {
      const { account, store } = await openStore();
      const submittedAt = new Date('2026-09-16T06:00:00.000Z');
      const order = await storeOrder(store.id, {
        status: 'SUBMITTED',
        submittedAt,
        confirmDeadlineAt: new Date('2026-09-17T06:00:00.000Z'),
        confirmReminderSentAt: new Date('2026-09-16T06:30:00.000Z'),
      });
      // 접수 + 24h(9/17 15:00 KST)보다 이른 픽업 → 마감 = 새 픽업
      const earlier = new Date('2026-09-16T08:00:00.000Z');

      await reschedule(account.id, order.id, earlier);

      expect(await orderRow(order.id)).toMatchObject({
        confirm_deadline_at: earlier,
        confirm_reminder_sent_at: null,
      });
      // 더 늦은 픽업이면 접수 + 24시간이 마감이다
      await reschedule(account.id, order.id, PICKUP_AT);
      expect((await orderRow(order.id)).confirm_deadline_at).toEqual(
        new Date('2026-09-17T06:00:00.000Z'),
      );
    });

    it('확정 주문·결제 도입 전 접수 주문은 확정 마감을 건드리지 않는다', async () => {
      const { account, store } = await openStore();
      const legacy = await storeOrder(store.id, {
        status: 'SUBMITTED',
        confirmDeadlineAt: null,
      });
      const deadline = new Date('2026-09-17T06:00:00.000Z');
      const confirmed = await storeOrder(store.id, {
        status: 'CONFIRMED',
        confirmDeadlineAt: deadline,
      });

      await reschedule(account.id, legacy.id);
      await reschedule(account.id, confirmed.id);

      expect((await orderRow(legacy.id)).confirm_deadline_at).toBeNull();
      expect((await orderRow(confirmed.id)).confirm_deadline_at).toEqual(
        deadline,
      );
    });

    it('변경 이력은 판매자 주문 상세에 오래된 순으로 실린다', async () => {
      const { account, store } = await openStore();
      const order = await storeOrder(store.id);
      const later = new Date('2026-09-18T07:00:00.000Z');

      await reschedule(account.id, order.id, NEW_PICKUP_AT, '첫 변경');
      await reschedule(account.id, order.id, later);

      const expected = [
        expect.objectContaining({
          fromPickupAt: PICKUP_AT,
          toPickupAt: NEW_PICKUP_AT,
          note: '첫 변경',
        }),
        expect.objectContaining({
          fromPickupAt: NEW_PICKUP_AT,
          toPickupAt: later,
          note: null,
        }),
      ];
      const sellerDetail = await sellerOrders.sellerOrder(account.id, order.id);
      expect(sellerDetail.pickupChanges).toEqual(expected);
    });
  });

  describe('변경 시트 달력·슬롯', () => {
    it('리드타임 안쪽 날도 고를 수 있고 이 주문의 점유는 지금 픽업일에서 뺀다', async () => {
      const { account, store } = await openStore();
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 2,
      });
      const order = await storeOrder(store.id, { quantity: 2 });

      const calendar = await service.sellerOrderPickupCalendar(
        account.id,
        order.id,
        '2026-09',
      );
      const slots = await service.sellerOrderPickupTimeSlots(
        account.id,
        order.id,
        '2026-09-18',
      );

      const day = (date: string) => calendar.days.find((d) => d.date === date);
      expect(day('2026-09-17')?.selectable).toBe(true);
      expect(day('2026-09-18')?.selectable).toBe(true);
      expect(slots.afternoon.every((slot) => slot.available)).toBe(true);
    });

    it('옮길 수 없는 상태면 PICKUP_RESCHEDULE_NOT_ALLOWED, 남의 주문이면 NOT_FOUND', async () => {
      const { account, store } = await openStore();
      const other = await openStore();
      const done = await storeOrder(store.id, { status: 'PICKED_UP' });
      const others = await storeOrder(other.store.id);

      await expect(
        service.sellerOrderPickupCalendar(account.id, done.id, '2026-09'),
      ).rejects.toThrowDomain('PICKUP_RESCHEDULE_NOT_ALLOWED');
      await expect(
        service.sellerOrderPickupTimeSlots(account.id, others.id, '2026-09-18'),
      ).rejects.toThrowDomain('ORDER_NOT_FOUND');
    });
  });
});
