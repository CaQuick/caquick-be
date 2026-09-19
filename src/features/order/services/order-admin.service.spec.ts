import { BadRequestException } from '@nestjs/common';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { AdminOrderService } from '@/features/order/services/order-admin.service';
import { OutboxDispatcherService } from '@/features/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';

describe('AdminOrderService (real DB)', () => {
  let service: AdminOrderService;
  let orderRepo: OrderRepository;
  let prisma: PrismaClient;
  let dispatcher: OutboxDispatcherService;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: OUTBOX_TEST_IMPORTS,
      providers: [
        AdminOrderService,
        AccountAdminRepository,
        OrderRepository,
        OrderStatusTransitionPolicy,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        ...outboxTestProviders(),
        NotificationOutboxConsumer,
        NotificationRepository,
      ],
    });
    service = module.get(AdminOrderService);
    orderRepo = module.get(OrderRepository);
    dispatcher = module.get(OutboxDispatcherService);
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
      status?: 'SUBMITTED' | 'CONFIRMED' | 'MADE' | 'PICKED_UP' | 'CANCELED';
      storeId?: bigint;
      buyerName?: string;
      orderNumber?: string;
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
  });

  describe('adminOrder', () => {
    it('구매자 요약·전체 품목·상태 이력을 준다', async () => {
      const { order, item, buyer } = await orderWithItem();
      await prisma.orderStatusHistory.create({
        data: { order_id: order.id, from_status: null, to_status: 'SUBMITTED' },
      });

      const result = await service.adminOrder(await admin(), order.id);

      expect(result.id).toBe(order.id.toString());
      expect(result.buyer).toEqual({
        accountId: buyer.id.toString(),
        email: buyer.email,
        nickname: `b_${buyer.id}`,
        status: 'ACTIVE',
      });
      expect(result.items.map((i) => i.id)).toEqual([item.id.toString()]);
      expect(result.statusHistories).toHaveLength(1);
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

        expect(result.status).toBe('CANCELED');
        const row = await prisma.order.findUniqueOrThrow({
          where: { id: order.id },
        });
        expect(row.canceled_at).not.toBeNull();
        const history = await prisma.orderStatusHistory.findFirstOrThrow({
          where: { order_id: order.id, to_status: 'CANCELED' },
        });
        expect(history.from_status).toBe(status);
        expect(history.note).toBe('[관리자] 가게 사정');
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

    it.each(['PICKED_UP', 'CANCELED'] as const)(
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

    it('두 관리자가 동시에 취소해도 이력·알림·감사는 1건씩', async () => {
      const { order } = await orderWithItem();
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
    });
  });
});
