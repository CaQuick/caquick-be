import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { OrderStatus, type PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

describe('SellerOrderService (real DB)', () => {
  let service: SellerOrderService;
  let prisma: PrismaClient;
  let repo: OrderRepository;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerOrderService,
        StoreSellerRepository,
        OrderRepository,
        OrderStatusTransitionPolicy,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders(),
      ],
    });
    service = module.get(SellerOrderService);
    repo = module.get(OrderRepository);
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
    it('판매자 계정이 아니면 403', async () => {
      const userAccount = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.sellerOrder(userAccount.id, BigInt(10)),
      ).rejects.toThrowDomain(403);
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

    it('첫 품목 상품명·이미지는 주문 시점 스냅샷이라 상품을 바꿔도 유지된다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '주문 시점 상품',
      });
      const order = await createOrder(prisma);
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
        product_name_snapshot: '주문 시점 상품',
        product_thumbnail_url_snapshot: 'https://img/old.jpg',
      });
      await prisma.product.update({
        where: { id: product.id },
        data: { name: '바뀐 상품' },
      });
      await prisma.productImage.create({
        data: { product_id: product.id, image_url: 'https://img/new.jpg' },
      });

      const result = await service.sellerOrderList(account.id);
      expect(result.items[0]).toMatchObject({
        firstItemName: '주문 시점 상품',
        firstItemImageUrl: 'https://img/old.jpg',
      });
    });

    it('다른 매장 품목의 id가 더 작아도 내 매장 품목이 첫 품목이다', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const order = await createOrder(prisma);
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: other.store.id,
        product_name_snapshot: '남의 매장 품목',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: me.store.id,
        product_name_snapshot: '내 매장 품목',
      });

      const result = await service.sellerOrderList(me.account.id);
      expect(result.items[0].firstItemName).toBe('내 매장 품목');
    });

    it('soft-delete된 품목은 첫 품목에서 제외한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createOrder(prisma);
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
        product_name_snapshot: '삭제된 품목',
        deleted_at: new Date(),
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
        product_name_snapshot: '활성 품목',
      });

      const result = await service.sellerOrderList(account.id);
      expect(result.items[0].firstItemName).toBe('활성 품목');
    });

    it('썸네일 스냅샷이 없으면 firstItemImageUrl은 null', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createOrder(prisma);
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
        product_thumbnail_url_snapshot: null,
      });

      const result = await service.sellerOrderList(account.id);
      expect(result.items[0].firstItemImageUrl).toBeNull();
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

    it('결과가 0건이면 totalCount 0, hasMore false', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const result = await service.sellerOrderList(account.id);
      expect(result).toMatchObject({ totalCount: 0, hasMore: false });
      expect(result.nextCursor).toBeNull();
    });

    it('정확히 limit개면 hasMore false, 초과하면 true', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createStoreOrder(store.id);
      await createStoreOrder(store.id);

      const exact = await service.sellerOrderList(account.id, { limit: 2 });
      expect(exact.items).toHaveLength(2);
      expect(exact.hasMore).toBe(false);
      expect(exact.nextCursor).toBeNull();

      const partial = await service.sellerOrderList(account.id, { limit: 1 });
      expect(partial.items).toHaveLength(1);
      expect(partial.hasMore).toBe(true);
      expect(partial.nextCursor).not.toBeNull();
    });

    it('totalCount는 페이지가 아니라 필터 전체 건수다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createStoreOrder(store.id, { status: 'SUBMITTED' });
      await createStoreOrder(store.id, { status: 'SUBMITTED' });
      await createStoreOrder(store.id, { status: 'CONFIRMED' });

      // limit으로 잘라도 totalCount는 조건에 맞는 전체를 센다
      const paged = await service.sellerOrderList(account.id, { limit: 1 });
      expect(paged.items).toHaveLength(1);
      expect(paged.totalCount).toBe(3);

      // 필터는 totalCount에도 반영된다
      const filtered = await service.sellerOrderList(account.id, {
        status: 'SUBMITTED',
      });
      expect(filtered.totalCount).toBe(2);
    });

    it('잘못된 status enum이면 400', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerOrderList(account.id, { status: 'INVALID' as never }),
      ).rejects.toThrowDomain(400);
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
    it('존재하지 않는 orderId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerOrder(account.id, BigInt(999999)),
      ).rejects.toThrowDomain(404);
    });

    it('다른 매장 주문은 404', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersOrder = await createStoreOrder(other.store.id);

      await expect(
        service.sellerOrder(me.account.id, othersOrder.id),
      ).rejects.toThrowDomain(404);
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

    it('soft-delete된 아이템·상태 이력은 상세에서 제외한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
        deleted_at: new Date(),
      });
      await prisma.orderStatusHistory.create({
        data: {
          order_id: order.id,
          from_status: 'SUBMITTED',
          to_status: 'CONFIRMED',
          changed_at: new Date('2026-04-15T10:00:00Z'),
          deleted_at: new Date(),
        },
      });

      const result = await service.sellerOrder(account.id, order.id);
      expect(result.items).toHaveLength(1);
      expect(result.statusHistories).toHaveLength(0);
    });

    it('soft-delete된 아이템만 있는 주문은 상세·목록 모두에서 제외한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);
      await prisma.orderItem.updateMany({
        where: { order_id: order.id },
        data: { deleted_at: new Date() },
      });

      await expect(
        service.sellerOrder(account.id, order.id),
      ).rejects.toThrowDomain(404);
      const list = await service.sellerOrderList(account.id);
      expect(list.items).toHaveLength(0);
    });
  });

  describe('sellerUpdateOrderStatus', () => {
    it('주문이 없으면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerUpdateOrderStatus(account.id, {
          orderId: '999999',
          toStatus: 'CONFIRMED',
          note: null,
        }),
      ).rejects.toThrowDomain(404);
    });

    it('상태 전이가 잘못되면 400 (SUBMITTED → MADE 차단)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);
      await expect(
        service.sellerUpdateOrderStatus(account.id, {
          orderId: order.id.toString(),
          toStatus: 'MADE',
          note: null,
        }),
      ).rejects.toThrowDomain(400);
    });

    it('CANCELED 전환 시 note 누락되면 400', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);
      await expect(
        service.sellerUpdateOrderStatus(account.id, {
          orderId: order.id.toString(),
          toStatus: 'CANCELED',
          note: null,
        }),
      ).rejects.toThrowDomain(400);
    });

    it('정상 상태 전이: SUBMITTED → CONFIRMED, status_history row 생성 확인', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createOrder(prisma);
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
        product_name_snapshot: '확정 품목',
        product_thumbnail_url_snapshot: 'https://img/confirm.jpg',
      });

      const result = await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'CONFIRMED',
        note: null,
      });

      expect(result).toMatchObject({
        status: 'CONFIRMED',
        firstItemName: '확정 품목',
        firstItemImageUrl: 'https://img/confirm.jpg',
      });

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

    it('사전 검사 뒤 품목이 삭제돼도 상태는 바뀌고 첫 품목 필드는 null이다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);
      // 사전 검사(findOrderDetailByStore)와 잠금 사이에 품목이 soft-delete되는 경합 — 잠금 SQL은 품목 deleted_at을 안 본다
      const original = repo.findOrderDetailByStore.bind(repo);
      jest
        .spyOn(repo, 'findOrderDetailByStore')
        .mockImplementationOnce(async (args) => {
          const row = await original(args);
          await prisma.orderItem.updateMany({
            where: { order_id: order.id },
            data: { deleted_at: new Date() },
          });
          return row;
        });

      const result = await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'CONFIRMED',
        note: null,
      });

      expect(result).toMatchObject({
        status: 'CONFIRMED',
        firstItemName: null,
        firstItemImageUrl: null,
      });
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
