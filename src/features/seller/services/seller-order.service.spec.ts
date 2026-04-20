import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, type PrismaClient } from '@prisma/client';

import {
  OrderDomainService,
  OrderRepository,
  OrderStatusTransitionPolicy,
} from '@/features/order';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
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

describe('SellerOrderService (real DB)', () => {
  let service: SellerOrderService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerOrderService,
        SellerRepository,
        OrderRepository,
        OrderDomainService,
        OrderStatusTransitionPolicy,
      ],
    });
    service = module.get(SellerOrderService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function createStoreOrder(
    storeId: bigint,
    opts: { status?: OrderStatus } = {},
  ) {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    const order = await createOrder(prisma, {
      account_id: buyer.id,
      status: opts.status ?? 'SUBMITTED',
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: storeId,
    });
    return order;
  }

  describe('공통 예외', () => {
    it('판매자 계정이 아니면 ForbiddenException', async () => {
      const userAccount = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.sellerOrder(userAccount.id, BigInt(10)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('sellerOrderList', () => {
    it('자기 매장 주문만 반환한다', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      await createStoreOrder(me.store.id);
      await createStoreOrder(other.store.id);

      const result = await service.sellerOrderList(me.account.id);
      expect(result.items).toHaveLength(1);
    });

    it('status 필터링이 동작한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createStoreOrder(store.id, { status: 'SUBMITTED' });
      await createStoreOrder(store.id, { status: 'CONFIRMED' });

      const result = await service.sellerOrderList(account.id, {
        status: 'CONFIRMED',
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe('CONFIRMED');
    });

    it('잘못된 status enum이면 BadRequestException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerOrderList(account.id, { status: 'INVALID' as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it('limit 초과 시 nextCursor 반환', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) await createStoreOrder(store.id);

      const result = await service.sellerOrderList(account.id, { limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe('sellerOrder', () => {
    it('존재하지 않는 orderId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerOrder(account.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 매장 주문은 NotFoundException', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersOrder = await createStoreOrder(other.store.id);

      await expect(
        service.sellerOrder(me.account.id, othersOrder.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('본인 매장 주문의 상세를 items/status_histories 포함하여 반환', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, { status: 'CONFIRMED' });
      await prisma.orderStatusHistory.create({
        data: {
          order_id: order.id,
          from_status: 'SUBMITTED',
          to_status: 'CONFIRMED',
          changed_at: new Date('2026-04-15T10:00:00Z'),
          note: '접수 확정',
        },
      });

      const result = await service.sellerOrder(account.id, order.id);
      expect(result.id).toBe(order.id.toString());
      expect(result.status).toBe('CONFIRMED');
      expect(result.items).toHaveLength(1);
      expect(result.statusHistories).toHaveLength(1);
      expect(result.statusHistories[0].toStatus).toBe('CONFIRMED');
    });
  });

  describe('sellerUpdateOrderStatus', () => {
    it('주문이 없으면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdateOrderStatus(account.id, {
          orderId: '999999',
          toStatus: 'CONFIRMED',
          note: null,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('상태 전이가 잘못되면 BadRequestException (SUBMITTED → MADE 차단)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);
      await expect(
        service.sellerUpdateOrderStatus(account.id, {
          orderId: order.id.toString(),
          toStatus: 'MADE',
          note: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CANCELED 전환 시 note 누락되면 BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);
      await expect(
        service.sellerUpdateOrderStatus(account.id, {
          orderId: order.id.toString(),
          toStatus: 'CANCELED',
          note: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 상태 전이: SUBMITTED → CONFIRMED, status_history row 생성 확인', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);

      const result = await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'CONFIRMED',
        note: null,
      });

      expect(result.status).toBe('CONFIRMED');

      const dbOrder = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.status).toBe('CONFIRMED');
      expect(dbOrder.confirmed_at).not.toBeNull();

      const histories = await prisma.orderStatusHistory.findMany({
        where: { order_id: order.id },
      });
      expect(histories).toHaveLength(1);
      expect(histories[0].from_status).toBe('SUBMITTED');
      expect(histories[0].to_status).toBe('CONFIRMED');
    });

    it('CANCELED 전환 + note 제공 시 정상 처리', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);

      const result = await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'CANCELED',
        note: '재고 부족',
      });

      expect(result.status).toBe('CANCELED');
      const histories = await prisma.orderStatusHistory.findMany({
        where: { order_id: order.id },
      });
      expect(histories[0].note).toBe('재고 부족');
    });
  });
});
