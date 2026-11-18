import { BadRequestException } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { AdminOrderService } from '@/features/order/services/order-admin.service';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { OutboxDispatcherService } from '@/features/outbox';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createPayment,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';
import { collectTopic } from '@/test/pubsub';

describe('AdminOrderService (real DB)', () => {
  let service: AdminOrderService;
  let orderRepo: OrderRepository;
  let prisma: PrismaClient;
  let dispatcher: OutboxDispatcherService;
  let pubSub: PubSub;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: OUTBOX_TEST_IMPORTS,
      providers: [
        AdminOrderService,
        AccountAdminRepository,
        OrderRepository,
        OrderStatusTransitionPolicy,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        OrderEventsService,
        // 발행-구독 왕복은 실 Redis spec(events service) 담당 — 여기선 in-memory
        { provide: PUB_SUB, useValue: new PubSub() },
        ...outboxTestProviders(),
        NotificationOutboxConsumer,
        NotificationRepository,
        NotificationAdminRepository,
      ],
    });
    service = module.get(AdminOrderService);
    orderRepo = module.get(OrderRepository);
    dispatcher = module.get(OutboxDispatcherService);
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

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  async function orderWithItem(
    overrides: {
      status?: OrderStatus;
      storeId?: bigint;
      buyerName?: string;
      orderNumber?: string;
      submittedAt?: Date | null;
    } = {},
  ) {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, {
      account_id: buyer.id,
      nickname: `b_${buyer.id}`,
    });
    const store = overrides.storeId
      ? { id: overrides.storeId }
      : await createStore(prisma);
    const order = await createOrder(prisma, {
      account_id: buyer.id,
      status: overrides.status,
      buyer_name: overrides.buyerName,
      order_number: overrides.orderNumber,
      submitted_at: overrides.submittedAt,
    });
    const item = await createOrderItem(prisma, {
      order_id: order.id,
      store_id: store.id,
    });
    return { order, item, buyer, storeId: store.id };
  }

  describe('adminOrders', () => {
    it('전 매장 주문을 최신순으로, keyword·status·storeId·accountId·기간 필터가 totalCount에도 적용된다', async () => {
      const a = await orderWithItem({
        buyerName: '바늘 구매자',
        orderNumber: 'ORD-A',
      });
      const b = await orderWithItem({
        status: 'CANCELED',
        orderNumber: 'ORD-B',
      });

      const all = await service.adminOrders(await admin());
      expect(all.totalCount).toBe(2);
      expect(all.items.map((o) => o.id)).toEqual([
        b.order.id.toString(),
        a.order.id.toString(),
      ]);
      expect(all.items[1].storeId).toBe(a.storeId.toString());

      expect(
        (await service.adminOrders(await admin(), { keyword: '바늘' }))
          .totalCount,
      ).toBe(1);
      expect(
        (await service.adminOrders(await admin(), { keyword: 'ORD-B' }))
          .totalCount,
      ).toBe(1);
      expect(
        (await service.adminOrders(await admin(), { status: 'CANCELED' }))
          .totalCount,
      ).toBe(1);
      expect(
        (
          await service.adminOrders(await admin(), {
            storeId: a.storeId.toString(),
          })
        ).totalCount,
      ).toBe(1);
      expect(
        (
          await service.adminOrders(await admin(), {
            accountId: b.buyer.id.toString(),
          })
        ).totalCount,
      ).toBe(1);
      expect(
        (await service.adminOrders(await admin(), { storeId: '0' })).totalCount,
      ).toBe(0);
      expect(
        (
          await service.adminOrders(await admin(), {
            fromCreatedAt: new Date(Date.now() + 60_000),
          })
        ).totalCount,
      ).toBe(0);
    });

    it('limit+1 조회로 hasMore·nextCursor를 판정하고 삭제 주문은 제외한다', async () => {
      const ids = [
        (await orderWithItem()).order.id,
        (await orderWithItem()).order.id,
        (await orderWithItem()).order.id,
      ];
      await createOrder(prisma, { deleted_at: new Date() });

      const page1 = await service.adminOrders(await admin(), { limit: 2 });
      expect(page1.totalCount).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(ids[1].toString());

      const page2 = await service.adminOrders(await admin(), {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((o) => o.id)).toEqual([ids[0].toString()]);
    });

    it('매장명·첫 품목명·이미지는 첫 활성 품목의 주문 시점 스냅샷이고 품목이 없으면 null', async () => {
      const { order, item } = await orderWithItem();
      await prisma.orderItem.update({
        where: { id: item.id },
        data: {
          store_name_snapshot: '주문 시점 매장',
          product_name_snapshot: '주문 시점 상품',
          product_thumbnail_url_snapshot: 'https://img/old.jpg',
        },
      });
      await prisma.store.update({
        where: { id: item.store_id },
        data: { store_name: '바뀐 매장' },
      });
      await prisma.product.update({
        where: { id: item.product_id },
        data: { name: '바뀐 상품' },
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: item.store_id,
        product_name_snapshot: '삭제된 품목',
        deleted_at: new Date(),
      });
      const empty = await createOrder(prisma);

      const result = await service.adminOrders(await admin());

      const byId = new Map(result.items.map((o) => [o.id, o]));
      expect(byId.get(order.id.toString())).toMatchObject({
        storeId: item.store_id.toString(),
        storeName: '주문 시점 매장',
        firstItemName: '주문 시점 상품',
        firstItemImageUrl: 'https://img/old.jpg',
      });
      expect(byId.get(empty.id.toString())).toMatchObject({
        storeId: null,
        storeName: null,
        firstItemName: null,
        firstItemImageUrl: null,
      });
    });
  });

  describe('adminOrders inProgress', () => {
    async function seedStatuses(): Promise<Map<string, OrderStatus>> {
      const byId = new Map<string, OrderStatus>();
      for (const status of [
        'PENDING_PAYMENT',
        'SUBMITTED',
        'CONFIRMED',
        'MADE',
        'PICKED_UP',
        'NO_SHOW',
        'CANCELED',
      ] as const) {
        const { order } = await orderWithItem({ status });
        byId.set(order.id.toString(), status);
      }
      return byId;
    }

    it('true면 입금 대기·접수·확정·제작 완료만, totalCount도 같다', async () => {
      const byId = await seedStatuses();
      const result = await service.adminOrders(await admin(), {
        inProgress: true,
      });
      expect(result.items.map((o) => byId.get(o.id)).sort()).toEqual(
        ['CONFIRMED', 'MADE', 'PENDING_PAYMENT', 'SUBMITTED'].sort(),
      );
      expect(result.totalCount).toBe(4);
    });

    it.each([false, null, undefined])('%p면 전체다', async (inProgress) => {
      await seedStatuses();
      const result = await service.adminOrders(await admin(), {
        inProgress: inProgress as boolean | undefined,
      });
      expect(result.totalCount).toBe(7);
    });

    it('status와 함께 오면 AND다', async () => {
      await seedStatuses();
      const actor = await admin();
      const both = (status: OrderStatus) =>
        service.adminOrders(actor, { inProgress: true, status });
      expect((await both('MADE')).totalCount).toBe(1);
      expect((await both('PICKED_UP')).totalCount).toBe(0);
    });
  });

  describe('adminStoreInProgressOrderSummary', () => {
    it('진행 중 주문만 상태별로 세고 0건 상태는 빼며 흐름 순으로 준다', async () => {
      const store = await createStore(prisma);
      for (const status of [
        'MADE',
        'PENDING_PAYMENT',
        'PENDING_PAYMENT',
        'SUBMITTED',
        'PICKED_UP',
        'NO_SHOW',
        'CANCELED',
      ] as const) {
        await orderWithItem({ status, storeId: store.id });
      }
      // 다른 매장 주문은 세지 않는다
      await orderWithItem({ status: 'CONFIRMED' });

      const result = await service.adminStoreInProgressOrderSummary(
        await admin(),
        store.id,
      );
      expect(result).toEqual({
        storeId: store.id.toString(),
        totalCount: 4,
        byStatus: [
          { status: 'PENDING_PAYMENT', count: 2 },
          { status: 'SUBMITTED', count: 1 },
          { status: 'MADE', count: 1 },
        ],
      });
    });

    it('진행 중 주문이 없으면(없는 매장 포함) 0건이다', async () => {
      const store = await createStore(prisma);
      await orderWithItem({ status: 'PICKED_UP', storeId: store.id });
      for (const storeId of [store.id, store.id + 1000n]) {
        expect(
          await service.adminStoreInProgressOrderSummary(
            await admin(),
            storeId,
          ),
        ).toEqual({ storeId: storeId.toString(), totalCount: 0, byStatus: [] });
      }
    });

    it('삭제된 주문과 이 매장 품목이 삭제된 주문은 세지 않는다', async () => {
      const store = await createStore(prisma);
      await orderWithItem({ status: 'SUBMITTED', storeId: store.id });
      const deletedOrder = await orderWithItem({
        status: 'CONFIRMED',
        storeId: store.id,
      });
      await prisma.order.update({
        where: { id: deletedOrder.order.id },
        data: { deleted_at: new Date() },
      });
      const deletedItem = await orderWithItem({
        status: 'MADE',
        storeId: store.id,
      });
      await prisma.orderItem.update({
        where: { id: deletedItem.item.id },
        data: { deleted_at: new Date() },
      });

      expect(
        await service.adminStoreInProgressOrderSummary(await admin(), store.id),
      ).toEqual({
        storeId: store.id.toString(),
        totalCount: 1,
        byStatus: [{ status: 'SUBMITTED', count: 1 }],
      });
    });

    it('관리자가 아니면 403', async () => {
      const user = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.adminStoreInProgressOrderSummary(user.id, 1n),
      ).rejects.toThrowDomain(403);
    });
  });

  describe('adminOrder', () => {
    it('구매자 요약·전체 품목·상태 이력을 준다', async () => {
      const { order, item, buyer } = await orderWithItem();
      await prisma.orderStatusHistory.create({
        data: {
          order_id: order.id,
          from_status: null,
          to_status: 'SUBMITTED',
          actor_type: 'BUYER',
        },
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { request_note: '초는 빼 주세요' },
      });

      const result = await service.adminOrder(await admin(), order.id);

      expect(result.id).toBe(order.id.toString());
      expect(result.requestNote).toBe('초는 빼 주세요');
      expect(result.buyer).toEqual({
        accountId: buyer.id.toString(),
        email: buyer.email,
        nickname: `b_${buyer.id}`,
        status: 'ACTIVE',
      });
      expect(result.items.map((i) => i.id)).toEqual([item.id.toString()]);
      expect(result.statusHistories).toHaveLength(1);
      expect(result.payment).toBeNull();
    });

    it('결제와 입금 확인 처리자·메모를 준다', async () => {
      const { order } = await orderWithItem();
      const confirmedAt = new Date('2026-09-16T07:00:00.000Z');
      const payment = await createPayment(prisma, {
        order_id: order.id,
        status: 'CONFIRMED',
        confirmed_at: confirmedAt,
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          confirm_source: 'ADMIN',
          confirmed_by_label_snapshot: '김운영(admin1)',
          confirm_note: '국민 입금',
        },
      });

      const result = await service.adminOrder(await admin(), order.id);

      expect(result.payment).toEqual({
        method: 'BANK_TRANSFER',
        status: 'CONFIRMED',
        amount: order.total_price,
        depositorName: payment.depositor_name,
        depositBank: { code: '004', name: 'KB국민은행' },
        depositAccountNumber: '12345678901234',
        depositAccountHolder: '케이퀵',
        expiresAt: payment.expires_at,
        buyerClaimedAt: null,
        confirmedAt,
        confirmSource: 'ADMIN',
        confirmedByLabel: '김운영(admin1)',
        confirmNote: '국민 입금',
      });
    });

    it('없거나 삭제된 주문이면 404', async () => {
      const deleted = await createOrder(prisma, { deleted_at: new Date() });
      await expect(
        service.adminOrder(await admin(), deleted.id),
      ).rejects.toThrowDomain(404);
      await expect(
        service.adminOrder(await admin(), BigInt(999_999)),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('adminCancelOrder', () => {
    it.each(['SUBMITTED', 'CONFIRMED', 'MADE'] as const)(
      '%s 주문을 취소하고 이력([관리자] 접두)·ORDER_CANCELED 알림·감사(store_id)를 한 번에 남긴다',
      async (status) => {
        const actor = await admin();
        const { order, buyer, storeId } = await orderWithItem({ status });

        const result = await service.adminCancelOrder(actor, {
          orderId: order.id.toString(),
          note: '  가게 사정  ',
        });

        expect(result).toMatchObject({
          status: 'CANCELED',
          firstItemName: 'Product snapshot',
          firstItemImageUrl: null,
        });
        const row = await prisma.order.findUniqueOrThrow({
          where: { id: order.id },
        });
        expect(row.canceled_at).not.toBeNull();
        const history = await prisma.orderStatusHistory.findFirstOrThrow({
          where: { order_id: order.id, to_status: 'CANCELED' },
        });
        expect(history).toMatchObject({
          from_status: status,
          actor_type: 'ADMIN',
          actor_account_id: actor,
          note: '[관리자] 가게 사정',
        });
        await drainOutbox(dispatcher);
        const notification = await prisma.notification.findFirstOrThrow({
          where: { order_id: order.id },
        });
        expect(notification).toMatchObject({
          account_id: buyer.id,
          event: 'ORDER_CANCELED',
          store_id: storeId,
        });
        const audit = await prisma.auditLog.findFirstOrThrow({
          where: { target_type: 'ORDER', target_id: order.id },
        });
        expect(audit).toMatchObject({
          actor_account_id: actor,
          store_id: storeId,
          action: 'STATUS_CHANGE',
        });
      },
    );

    it.each(['PICKED_UP', 'CANCELED', 'NO_SHOW', 'PENDING_PAYMENT'] as const)(
      '%s 주문은 400(판매자와 같은 전이 규칙)',
      async (status) => {
        const { order } = await orderWithItem({ status });
        await expect(
          service.adminCancelOrder(await admin(), {
            orderId: order.id.toString(),
            note: 'x',
          }),
        ).rejects.toThrowDomain(400);
        expect(
          await prisma.orderStatusHistory.count({
            where: { order_id: order.id },
          }),
        ).toBe(0);
      },
    );

    it('사유가 공백이면 400, 없는 주문은 404', async () => {
      const { order } = await orderWithItem();
      await expect(
        service.adminCancelOrder(await admin(), {
          orderId: order.id.toString(),
          note: '   ',
        }),
      ).rejects.toThrowDomain(400);
      await expect(
        service.adminCancelOrder(await admin(), {
          orderId: '999999',
          note: 'x',
        }),
      ).rejects.toThrowDomain(404);
    });

    it('사유는 접두를 붙여 500자 이내여야 한다(494자 허용, 495자 거절)', async () => {
      const { order } = await orderWithItem();
      await expect(
        service.adminCancelOrder(await admin(), {
          orderId: order.id.toString(),
          note: 'x'.repeat(495),
        }),
      ).rejects.toThrowDomain(400);

      await service.adminCancelOrder(await admin(), {
        orderId: order.id.toString(),
        note: 'x'.repeat(494),
      });
      const history = await prisma.orderStatusHistory.findFirstOrThrow({
        where: { order_id: order.id },
      });
      expect(history.note).toHaveLength(500);
      expect(history.note?.startsWith('[관리자] ')).toBe(true);
    });

    // 판매자 확인과 교차: 어느 쪽이 먼저든 최종은 CANCELED이고 이력은 실제 전이 순서만 남는다.
    // 판매자 쪽이 잠금 없이 읽으면 CANCELED 위에 CONFIRMED를 덮어쓴다
    it('판매자 상태 변경과 동시에 취소해도 취소가 덮어써지지 않는다', async () => {
      const { order, storeId } = await orderWithItem();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      const [, sellerResult] = await Promise.allSettled([
        service.adminCancelOrder(await admin(), {
          orderId: order.id.toString(),
          note: 'a',
        }),
        orderRepo.updateOrderStatusBySeller({
          orderId: order.id,
          storeId,
          actorAccountId: seller.id,
          toStatus: 'CONFIRMED',
          note: null,
          now: new Date(),
          assertTransition: (from) => {
            if (from !== 'SUBMITTED') throw new BadRequestException('stale');
          },
        }),
      ]);

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(row.status).toBe('CANCELED');
      const histories = await prisma.orderStatusHistory.findMany({
        where: { order_id: order.id },
        orderBy: { id: 'asc' },
      });
      expect(histories.map((h) => `${h.from_status}>${h.to_status}`)).toEqual(
        sellerResult.status === 'fulfilled'
          ? ['SUBMITTED>CONFIRMED', 'CONFIRMED>CANCELED']
          : ['SUBMITTED>CANCELED'],
      );
    });

    it('두 관리자가 동시에 취소해도 이력·알림·감사·구독 이벤트는 1건씩', async () => {
      const { order, storeId } = await orderWithItem();
      const topic = await collectTopic(pubSub, `order.seller.${storeId}`);
      const [a, b] = [await admin(), await admin()];
      const results = await Promise.allSettled([
        service.adminCancelOrder(a, {
          orderId: order.id.toString(),
          note: 'a',
        }),
        service.adminCancelOrder(b, {
          orderId: order.id.toString(),
          note: 'b',
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(
        await prisma.orderStatusHistory.count({
          where: { order_id: order.id },
        }),
      ).toBe(1);
      await drainOutbox(dispatcher);
      expect(
        await prisma.notification.count({ where: { order_id: order.id } }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'ORDER', target_id: order.id },
        }),
      ).toBe(1);
      expect(topic.received).toHaveLength(1);
      topic.stop();
    });
  });

  describe('sellerOrderUpdated 발행', () => {
    it('관리자 취소는 첫 품목 매장 토픽에 1건 — 취소된 주문 행의 스냅샷을 싣는다', async () => {
      const { order, storeId } = await orderWithItem({ status: 'CONFIRMED' });
      const topic = await collectTopic(pubSub, `order.seller.${storeId}`);

      await service.adminCancelOrder(await admin(), {
        orderId: order.id.toString(),
        note: '가게 사정',
      });

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(topic.received).toEqual([
        {
          kind: 'STATUS_CHANGED',
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          status: 'CANCELED',
          pickupAt: order.pickup_at.toISOString(),
          buyerName: order.buyer_name,
          totalPrice: order.total_price,
          productName: 'Product snapshot',
          updatedAt: row.updated_at.toISOString(),
        },
      ]);
      topic.stop();
    });

    it('반증: 취소 불가 주문(ORDER_NOT_CANCELLABLE)은 발행하지 않는다', async () => {
      const { order, storeId } = await orderWithItem({ status: 'PICKED_UP' });
      const topic = await collectTopic(pubSub, `order.seller.${storeId}`);

      await expect(
        service.adminCancelOrder(await admin(), {
          orderId: order.id.toString(),
          note: 'x',
        }),
      ).rejects.toThrowDomain('ORDER_NOT_CANCELLABLE');

      expect(topic.received).toHaveLength(0);
      topic.stop();
    });

    it('입금 확인 전(submitted_at 없음) 주문의 취소는 판매자에게 보이지 않아 발행하지 않는다', async () => {
      const { order } = await orderWithItem({ submittedAt: null });
      const publish = jest.spyOn(pubSub, 'publish');

      const result = await service.adminCancelOrder(await admin(), {
        orderId: order.id.toString(),
        note: 'x',
      });

      const published = publish.mock.calls.length;
      publish.mockRestore();
      expect(result.status).toBe('CANCELED');
      expect(published).toBe(0);
    });

    it('활성 품목이 없으면 매장을 알 수 없어 발행을 생략한다', async () => {
      const { order, item } = await orderWithItem();
      await prisma.orderItem.update({
        where: { id: item.id },
        data: { deleted_at: new Date() },
      });
      const publish = jest.spyOn(pubSub, 'publish');

      const result = await service.adminCancelOrder(await admin(), {
        orderId: order.id.toString(),
        note: 'x',
      });

      expect(result).toMatchObject({ status: 'CANCELED', storeId: null });
      expect(publish).not.toHaveBeenCalled();
      publish.mockRestore();
    });
  });
});
