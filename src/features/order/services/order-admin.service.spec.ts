import { BadRequestException } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import type { AdminCancelOrderInput } from '@/features/order/dto/inputs/admin-cancel-order.input';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
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
  createThreeDOrderItemCustom,
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
        OrderCancelPolicy,
        OrderTransitionRepository,
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
      /** 확인된 결제(입금 대기면 PENDING 결제)를 함께 만든다 */
      paid?: boolean;
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
    if (overrides.paid) {
      const confirmed = order.status !== 'PENDING_PAYMENT';
      await createPayment(prisma, {
        order_id: order.id,
        status: confirmed ? 'CONFIRMED' : 'PENDING',
        confirmed_at: confirmed ? new Date() : null,
      });
    }
    return { order, item, buyer, storeId: store.id };
  }

  function cancelInput(
    orderId: bigint,
    overrides: Partial<AdminCancelOrderInput> = {},
  ): AdminCancelOrderInput {
    return { orderId: orderId.toString(), reason: 'OTHER', ...overrides };
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
        hasCustom: false,
        firstItemCustomImageUrl: null,
      });
    });

    it('커스텀 첫 품목이면 목록에 배지·대표 이미지를, 상세에 렌더·디자인을 싣는다', async () => {
      const order = await createOrder(prisma);
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        custom_mode_snapshot: 'THREE_D',
        custom_preview_image_url: 'https://img/THREE_D_TOP.png',
      });
      await createThreeDOrderItemCustom(prisma, item.id);
      const plain = await createOrder(prisma);
      await createOrderItem(prisma, { order_id: plain.id });
      const adminId = await admin();

      const list = await service.adminOrders(adminId);
      const byId = new Map(list.items.map((o) => [o.id, o]));
      expect(byId.get(order.id.toString())).toMatchObject({
        hasCustom: true,
        firstItemCustomImageUrl: 'https://img/THREE_D_TOP.png',
      });
      expect(byId.get(plain.id.toString())).toMatchObject({
        hasCustom: false,
        firstItemCustomImageUrl: null,
      });
      const [detail] = (await service.adminOrder(adminId, order.id)).items;
      expect(detail.customImages.map((i) => i.kind)).toEqual([
        'THREE_D_TOP',
        'THREE_D_FRONT',
        'THREE_D_BACK',
        'THREE_D_LEFT',
        'THREE_D_RIGHT',
      ]);
      expect(detail.threeDDesign?.schemaVersion).toBe(1);
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
      expect(result.refunds).toEqual([]);
      expect(result.cancellation).toBeNull();
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

    it.each([
      ['PENDING_PAYMENT', true, 'NO_REFUND', 7, 0],
      ['SUBMITTED', true, 'FULL_REFUND', 6, 10_000],
      ['CONFIRMED', true, 'BY_FAULT', 6, 10_000],
      ['MADE', true, 'BY_FAULT', 6, 10_000],
      ['PICKED_UP', false, null, 0, 10_000],
      ['NO_SHOW', false, null, 0, 10_000],
      ['CANCELED', false, null, 0, 10_000],
    ] as const)(
      '%s 주문의 취소 선택지: 취소 가능 %s, 규칙 %s, 사유 %d개, 결제액 %d',
      async (status, cancelable, refundRule, reasonCount, paidAmount) => {
        const { order } = await orderWithItem({ status, paid: true });

        const { cancelOptions } = await service.adminOrder(
          await admin(),
          order.id,
        );

        expect(cancelOptions).toMatchObject({
          cancelable,
          refundRule,
          paidAmount,
        });
        expect(cancelOptions.reasons).toHaveLength(reasonCount);
        expect(cancelOptions.reasons.includes('PAYMENT_NOT_RECEIVED')).toBe(
          status === 'PENDING_PAYMENT',
        );
      },
    );

    it('결제 도입 전 주문은 결제액 0으로 내려 준다', async () => {
      const { order } = await orderWithItem({ status: 'CONFIRMED' });
      const { cancelOptions } = await service.adminOrder(
        await admin(),
        order.id,
      );
      expect(cancelOptions.paidAmount).toBe(0);
    });

    it('취소 뒤에는 취소 정보와 환불 목록(입금 반환 포함, 오래된 순)을 준다', async () => {
      const { order } = await orderWithItem({ status: 'MADE', paid: true });
      await service.adminCancelOrder(
        await admin(),
        cancelInput(order.id, {
          reason: 'OUT_OF_MATERIALS',
          note: '재료 소진',
          fault: 'BUYER',
          refundAmount: 4_000,
        }),
      );
      await prisma.refund.create({
        data: {
          order_id: order.id,
          kind: 'DEPOSIT_RETURN',
          amount: 500,
          requested_at: new Date(),
        },
      });

      const result = await service.adminOrder(await admin(), order.id);

      expect(result.cancellation).toMatchObject({
        actorType: 'ADMIN',
        reason: 'OUT_OF_MATERIALS',
        reasonLabel: '재료 소진',
        note: '재료 소진',
        fault: 'BUYER',
        refundAmount: 4_000,
        refundStatus: 'AWAITING_ACCOUNT',
        refundCompletedAt: null,
      });
      expect(result.refunds.map((r) => [r.kind, r.amount])).toEqual([
        ['CANCEL', 4_000],
        ['DEPOSIT_RETURN', 500],
      ]);
      expect(result.statusHistories[0]).toMatchObject({
        toStatus: 'CANCELED',
        actorType: 'ADMIN',
        cancelReason: 'OUT_OF_MATERIALS',
        cancelFault: 'BUYER',
        refundAmount: 4_000,
      });
      expect(result.cancelOptions).toMatchObject({
        cancelable: false,
        reasons: [],
        refundRule: null,
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
    it.each([
      ['SUBMITTED', null],
      ['CONFIRMED', 'SELLER'],
      ['MADE', 'SELLER'],
    ] as const)(
      '%s 주문을 취소하고 이력(주체·사유·환불액, 접두 없음)·전액 환불·취소 알림·환불 계좌 요청·감사를 남긴다',
      async (status, fault) => {
        const actor = await admin();
        const { order, buyer, storeId } = await orderWithItem({
          status,
          paid: true,
        });

        const result = await service.adminCancelOrder(
          actor,
          cancelInput(order.id, {
            reason: 'SCHEDULE_UNAVAILABLE',
            note: '  가게 사정  ',
            fault,
          }),
        );

        expect(result).toMatchObject({
          status: 'CANCELED',
          firstItemName: 'Product snapshot',
          firstItemImageUrl: null,
        });
        const history = await prisma.orderStatusHistory.findFirstOrThrow({
          where: { order_id: order.id, to_status: 'CANCELED' },
        });
        expect(history).toMatchObject({
          from_status: status,
          actor_type: 'ADMIN',
          actor_account_id: actor,
          cancel_reason: 'SCHEDULE_UNAVAILABLE',
          cancel_fault: fault,
          refund_amount: order.total_price,
          note: '가게 사정',
        });
        await expect(
          prisma.refund.findFirstOrThrow({ where: { order_id: order.id } }),
        ).resolves.toMatchObject({
          kind: 'CANCEL',
          amount: order.total_price,
          status: 'AWAITING_ACCOUNT',
        });
        await drainOutbox(dispatcher);
        const notifications = await prisma.notification.findMany({
          where: { order_id: order.id },
          orderBy: { id: 'asc' },
        });
        expect(notifications).toEqual([
          expect.objectContaining({
            account_id: buyer.id,
            event: 'ORDER_CANCELED',
            body: `${order.order_number} 주문이 취소되었어요. 사유: 일정 불가`,
            store_id: storeId,
          }),
          expect.objectContaining({
            account_id: buyer.id,
            event: 'REFUND_ACCOUNT_REQUESTED',
            body: `${order.order_number} 10,000원을 돌려받을 계좌를 입력해 주세요.`,
          }),
        ]);
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

    it("입금 대기 주문을 미입금으로 취소하면('입금했어요'를 눌렀어도) 결제를 닫고 입금 기한 만료 알림을 보낸다", async () => {
      const { order, buyer } = await orderWithItem({
        status: 'PENDING_PAYMENT',
      });
      await createPayment(prisma, {
        order_id: order.id,
        buyer_claimed_at: new Date(),
      });

      await service.adminCancelOrder(
        await admin(),
        cancelInput(order.id, { reason: 'PAYMENT_NOT_RECEIVED' }),
      );

      await expect(
        prisma.payment.findUniqueOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({ status: 'CANCELED' });
      expect(await prisma.refund.count()).toBe(0);
      await drainOutbox(dispatcher);
      await expect(
        prisma.notification.findMany({ where: { order_id: order.id } }),
      ).resolves.toEqual([
        expect.objectContaining({
          account_id: buyer.id,
          event: 'ORDER_PAYMENT_EXPIRED',
          body: `${order.order_number} 입금이 확인되지 않아 주문이 취소되었어요.`,
        }),
      ]);
    });

    it.each(['PICKED_UP', 'CANCELED', 'NO_SHOW'] as const)(
      '%s 주문은 ORDER_NOT_CANCELLABLE',
      async (status) => {
        const { order } = await orderWithItem({ status });
        await expect(
          service.adminCancelOrder(await admin(), cancelInput(order.id)),
        ).rejects.toThrowDomain('ORDER_NOT_CANCELLABLE');
        expect(
          await prisma.orderStatusHistory.count({
            where: { order_id: order.id },
          }),
        ).toBe(0);
      },
    );

    it.each([
      [
        '접수 주문에 미입금 사유',
        'SUBMITTED',
        { reason: 'PAYMENT_NOT_RECEIVED' },
        'CANCEL_REASON_NOT_ALLOWED',
      ],
      [
        '자동 미확정 사유',
        'SUBMITTED',
        { reason: 'CONFIRM_TIMEOUT' },
        'CANCEL_REASON_NOT_ALLOWED',
      ],
      ['확정 주문에 사정 없음', 'CONFIRMED', {}, 'CANCEL_FAULT_REQUIRED'],
      [
        '구매자 사정에 금액 없음',
        'MADE',
        { fault: 'BUYER' },
        'REFUND_AMOUNT_REQUIRED',
      ],
      [
        '결제액 + 1원',
        'MADE',
        { fault: 'BUYER', refundAmount: 10_001 },
        'REFUND_AMOUNT_OUT_OF_RANGE',
      ],
      [
        '음수',
        'CONFIRMED',
        { fault: 'BUYER', refundAmount: -1 },
        'REFUND_AMOUNT_OUT_OF_RANGE',
      ],
    ] as const)(
      '%s는 %s로 거절하고 아무것도 바꾸지 않는다',
      async (_label, status, overrides, code) => {
        const { order } = await orderWithItem({ status, paid: true });
        await expect(
          service.adminCancelOrder(
            await admin(),
            cancelInput(order.id, overrides),
          ),
        ).rejects.toThrowDomain(code);
        await expect(
          prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
        ).resolves.toMatchObject({ status });
        expect(await prisma.refund.count()).toBe(0);
        expect(await prisma.outbox.count()).toBe(0);
      },
    );

    it('구매자 사정 부분 환불은 환불 R과 남는 금액의 정산 확정을 함께 남긴다', async () => {
      const { order } = await orderWithItem({ status: 'MADE', paid: true });

      await service.adminCancelOrder(
        await admin(),
        cancelInput(order.id, {
          reason: 'BUYER_REQUEST',
          fault: 'BUYER',
          refundAmount: 3_000,
        }),
      );

      await expect(
        prisma.refund.findFirstOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({ amount: 3_000 });
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({ settlement_base_amount: 7_000 });
    });

    it('메모는 선택(공백은 null)이고 500자까지 받으며, 없는 주문은 404', async () => {
      const { order } = await orderWithItem();
      const other = await orderWithItem();
      await expect(
        service.adminCancelOrder(
          await admin(),
          cancelInput(order.id, { note: 'x'.repeat(501) }),
        ),
      ).rejects.toThrowDomain('TEXT_TOO_LONG');

      await service.adminCancelOrder(
        await admin(),
        cancelInput(order.id, { note: 'x'.repeat(500) }),
      );
      await service.adminCancelOrder(
        await admin(),
        cancelInput(other.order.id, { note: '   ' }),
      );
      const notes = await prisma.orderStatusHistory.findMany({
        orderBy: { id: 'asc' },
      });
      expect(notes.map((h) => h.note)).toEqual(['x'.repeat(500), null]);
      await expect(
        service.adminCancelOrder(await admin(), cancelInput(999_999n)),
      ).rejects.toThrowDomain(404);
    });

    // 판매자 확인과 교차: 어느 쪽이 먼저든 최종은 CANCELED이고 이력은 실제 전이 순서만 남는다.
    // 판매자 쪽이 잠금 없이 읽으면 CANCELED 위에 CONFIRMED를 덮어쓴다
    it('판매자 상태 변경과 동시에 취소해도 취소가 덮어써지지 않는다', async () => {
      const { order, storeId } = await orderWithItem();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      const [cancelResult, sellerResult] = await Promise.allSettled([
        service.adminCancelOrder(
          await admin(),
          cancelInput(order.id, { fault: 'SELLER' }),
        ),
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

      expect(cancelResult.status).toBe('fulfilled');
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
        service.adminCancelOrder(a, cancelInput(order.id, { note: 'a' })),
        service.adminCancelOrder(b, cancelInput(order.id, { note: 'b' })),
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

      await service.adminCancelOrder(
        await admin(),
        cancelInput(order.id, { fault: 'SELLER' }),
      );

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
          hasCustom: false,
          updatedAt: row.updated_at.toISOString(),
        },
      ]);
      topic.stop();
    });

    it('반증: 취소 불가 주문(ORDER_NOT_CANCELLABLE)은 발행하지 않는다', async () => {
      const { order, storeId } = await orderWithItem({ status: 'PICKED_UP' });
      const topic = await collectTopic(pubSub, `order.seller.${storeId}`);

      await expect(
        service.adminCancelOrder(await admin(), cancelInput(order.id)),
      ).rejects.toThrowDomain('ORDER_NOT_CANCELLABLE');

      expect(topic.received).toHaveLength(0);
      topic.stop();
    });

    it('입금 확인 전(submitted_at 없음) 주문의 취소는 판매자에게 보이지 않아 발행하지 않는다', async () => {
      const { order } = await orderWithItem({ submittedAt: null });
      const publish = jest.spyOn(pubSub, 'publish');

      const result = await service.adminCancelOrder(
        await admin(),
        cancelInput(order.id),
      );

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

      const result = await service.adminCancelOrder(
        await admin(),
        cancelInput(order.id),
      );

      expect(result).toMatchObject({ status: 'CANCELED', storeId: null });
      expect(publish).not.toHaveBeenCalled();
      publish.mockRestore();
    });
  });
});
