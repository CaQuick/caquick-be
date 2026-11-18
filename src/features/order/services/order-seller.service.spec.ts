import { PubSub } from 'graphql-subscriptions';

import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { SellerCancelOrderInput } from '@/features/order/dto/inputs/seller-cancel-order.input';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { SellerOrderService } from '@/features/order/services/order-seller.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { OrderStatus, type PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createPayment,
  createProduct,
  createThreeDOrderItemCustom,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { collectTopic } from '@/test/pubsub';

describe('SellerOrderService (real DB)', () => {
  let service: SellerOrderService;
  let prisma: PrismaClient;
  let repo: OrderRepository;
  let pubSub: PubSub;
  let clock: ClockService;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerOrderService,
        StoreSellerRepository,
        OrderRepository,
        OrderStatusTransitionPolicy,
        OrderCancelPolicy,
        OrderTransitionRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
        OrderEventsService,
        // 발행-구독 왕복은 실 Redis spec(events service) 담당 — 여기선 in-memory
        { provide: PUB_SUB, useValue: new PubSub() },
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders(),
      ],
    });
    service = module.get(SellerOrderService);
    repo = module.get(OrderRepository);
    pubSub = module.get(PUB_SUB);
    clock = module.get(ClockService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createStoreOrder(
    storeId: bigint,
    opts: {
      status?: OrderStatus;
      buyerId?: bigint;
      /** 확인된 결제를 함께 만든다 */
      paid?: boolean;
      commissionRateBps?: number;
      pickupAt?: Date;
      confirmDeadlineAt?: Date;
    } = {},
  ) {
    const buyerId =
      opts.buyerId ??
      (await createAccount(prisma, { account_type: 'USER' })).id;
    const order = await createOrder(prisma, {
      account_id: buyerId,
      status: opts.status ?? 'SUBMITTED',
      commission_rate_bps: opts.commissionRateBps,
      pickup_at: opts.pickupAt,
      confirm_deadline_at: opts.confirmDeadlineAt,
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: storeId,
    });
    if (opts.paid) {
      await createPayment(prisma, {
        order_id: order.id,
        status: 'CONFIRMED',
        confirmed_at: new Date(),
      });
    }
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

    it.each([
      ['3D', 'THREE_D', 'https://img/top.png', true],
      ['슬롯형', 'SLOT', 'https://img/composite.png', true],
      ['커스텀 없음', 'NONE', null, false],
    ] as const)(
      '%s 첫 품목이면 커스텀 배지·대표 이미지를 싣는다',
      async (_case, mode, url, hasCustom) => {
        const { account, store } = await setupSellerWithStore(prisma);
        const order = await createOrder(prisma);
        await createOrderItem(prisma, {
          order_id: order.id,
          store_id: store.id,
          custom_mode_snapshot: mode,
          custom_preview_image_url: url,
        });

        const result = await service.sellerOrderList(account.id);
        expect(result.items[0]).toMatchObject({
          hasCustom,
          firstItemCustomImageUrl: url,
        });
      },
    );

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

    it('입금 확인 전(submitted_at 없음) 주문은 목록·건수에서 빠진다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const visible = await createStoreOrder(store.id);
      await createStoreOrder(store.id, { status: 'PENDING_PAYMENT' });
      // 입금 전 취소도 submitted_at이 없어 함께 숨는다
      const unpaidCanceled = await createOrder(prisma, {
        status: 'CANCELED',
        submitted_at: null,
      });
      await createOrderItem(prisma, {
        order_id: unpaidCanceled.id,
        store_id: store.id,
      });

      const all = await service.sellerOrderList(account.id);
      expect(all.items.map((o) => o.id)).toEqual([visible.id.toString()]);
      expect(all.totalCount).toBe(1);
      const pending = await service.sellerOrderList(account.id, {
        status: 'PENDING_PAYMENT',
      });
      expect(pending.totalCount).toBe(0);
    });

    it('buyerAccountId면 그 구매자 주문만 준다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const buyer = await createAccount(prisma, { account_type: 'USER' });
      const mine = await createStoreOrder(store.id, { buyerId: buyer.id });
      await createStoreOrder(store.id);

      const result = await service.sellerOrderList(account.id, {
        buyerAccountId: buyer.id.toString(),
      });
      expect(result.items.map((o) => o.id)).toEqual([mine.id.toString()]);
      expect(result.totalCount).toBe(1);
    });

    it('buyerAccountId 빈 문자열은 INVALID_ID, "0"은 버리지 않고 필터로 쓴다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createStoreOrder(store.id);
      await expect(
        service.sellerOrderList(account.id, { buyerAccountId: '' }),
      ).rejects.toThrowDomain('INVALID_ID');
      const zero = await service.sellerOrderList(account.id, {
        buyerAccountId: '0',
      });
      expect(zero.totalCount).toBe(0);
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
          actor_type: 'SELLER',
          note: '접수 확정',
        },
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { request_note: '초는 빼 주세요' },
      });

      const result = await service.sellerOrder(account.id, order.id);
      expect(result.id).toBe(order.id.toString());
      expect(result.status).toBe('CONFIRMED');
      expect(result.requestNote).toBe('초는 빼 주세요');
      expect(result.items).toHaveLength(1);
      expect(result.statusHistories).toHaveLength(1);
      expect(result.statusHistories[0].toStatus).toBe('CONFIRMED');
      // 결제 도입 전 주문은 결제 수단이 없다
      expect(result.paymentMethod).toBeNull();
      expect(result.statusHistories[0].actorType).toBe('SELLER');
      expect(result.cancellation).toBeNull();
    });

    describe('자동 전이 예정·노쇼', () => {
      const NOW = new Date('2026-11-19T05:00:00.000Z');
      const PICKUP_AT = new Date('2026-11-19T04:00:00.000Z');
      const DEADLINE = new Date('2026-11-19T06:00:00.000Z');
      const AUTO_PICKUP = new Date('2026-11-20T04:00:00.000Z');

      it.each([
        ['SUBMITTED', DEADLINE, null, false],
        ['CONFIRMED', null, AUTO_PICKUP, true],
        ['MADE', null, AUTO_PICKUP, true],
        ['NO_SHOW', null, null, false],
        ['CANCELED', null, null, false],
      ] as const)(
        '%s: 확정 마감 %p, 자동 픽업 %p, 노쇼 가능 %s',
        async (status, confirmDeadlineAt, autoPickupAt, canMarkNoShow) => {
          jest.spyOn(clock, 'now').mockReturnValue(NOW);
          const { account, store } = await setupSellerWithStore(prisma);
          // 확정 마감 값은 상태가 바뀌어도 남는다 — 접수 상태에서만 내려 준다
          const order = await createStoreOrder(store.id, {
            status,
            pickupAt: PICKUP_AT,
            confirmDeadlineAt: DEADLINE,
          });

          const detail = await service.sellerOrder(account.id, order.id);
          const [summary] = (await service.sellerOrderList(account.id)).items;

          expect(detail).toMatchObject({
            confirmDeadlineAt,
            autoPickupAt,
            canMarkNoShow,
            noShowAt: null,
          });
          expect(summary.confirmDeadlineAt).toEqual(confirmDeadlineAt);
        },
      );

      it('픽업 시각 전이면 노쇼로 처리할 수 없다', async () => {
        jest
          .spyOn(clock, 'now')
          .mockReturnValue(new Date(PICKUP_AT.getTime() - 1));
        const { account, store } = await setupSellerWithStore(prisma);
        const order = await createStoreOrder(store.id, {
          status: 'MADE',
          pickupAt: PICKUP_AT,
        });

        const detail = await service.sellerOrder(account.id, order.id);

        expect(detail.canMarkNoShow).toBe(false);
      });
    });

    it('입금 반환 환불은 판매자 취소 정보에 섞이지 않는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, { status: 'CANCELED' });
      await prisma.orderStatusHistory.create({
        data: {
          order_id: order.id,
          from_status: 'SUBMITTED',
          to_status: 'CANCELED',
          actor_type: 'ADMIN',
          cancel_reason: 'OTHER',
          refund_amount: 0,
        },
      });
      await prisma.refund.create({
        data: {
          order_id: order.id,
          kind: 'DEPOSIT_RETURN',
          amount: 500,
          requested_at: new Date(),
        },
      });

      const result = await service.sellerOrder(account.id, order.id);
      expect(result.cancellation).toMatchObject({
        actorType: 'ADMIN',
        refundAmount: 0,
        refundStatus: null,
      });
    });

    it('상세 품목에 렌더 이미지(종류 순)·3D 디자인을 싣는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createOrder(prisma);
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
        custom_mode_snapshot: 'THREE_D',
      });
      await createThreeDOrderItemCustom(prisma, item.id);

      const [detail] = (await service.sellerOrder(account.id, order.id)).items;
      expect(detail.customMode).toBe('THREE_D');
      expect(detail.threeDDesign?.basic.shape).toBe('heart');
      expect(detail.customImages.map((i) => i.imageUrl)).toEqual([
        'https://img/THREE_D_TOP.png',
        'https://img/THREE_D_FRONT.png',
        'https://img/THREE_D_BACK.png',
        'https://img/THREE_D_LEFT.png',
        'https://img/THREE_D_RIGHT.png',
      ]);
    });

    it('결제가 있으면 결제 수단을 준다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, { status: 'SUBMITTED' });
      await createPayment(prisma, { order_id: order.id, status: 'CONFIRMED' });

      const result = await service.sellerOrder(account.id, order.id);
      expect(result.paymentMethod).toBe('BANK_TRANSFER');
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
          actor_type: 'SELLER',
          deleted_at: new Date(),
        },
      });

      const result = await service.sellerOrder(account.id, order.id);
      expect(result.items).toHaveLength(1);
      expect(result.statusHistories).toHaveLength(0);
    });

    it('입금 대기 주문 상세는 404다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, {
        status: 'PENDING_PAYMENT',
      });
      await expect(
        service.sellerOrder(account.id, order.id),
      ).rejects.toThrowDomain('ORDER_NOT_FOUND');
    });

    it('입금 대기 이력은 빠지고 접수 이력의 출발 상태는 null(최초)이다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);
      const at = (m: number) => new Date(Date.UTC(2026, 3, 15, 10, m));
      await prisma.orderStatusHistory.createMany({
        data: [
          {
            order_id: order.id,
            from_status: null,
            to_status: 'PENDING_PAYMENT',
            changed_at: at(0),
            actor_type: 'BUYER',
          },
          {
            order_id: order.id,
            from_status: 'PENDING_PAYMENT',
            to_status: 'SUBMITTED',
            changed_at: at(10),
            actor_type: 'ADMIN',
          },
        ],
      });

      const result = await service.sellerOrder(account.id, order.id);
      expect(result.statusHistories).toEqual([
        expect.objectContaining({ fromStatus: null, toStatus: 'SUBMITTED' }),
      ]);
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

    it.each(['SUBMITTED', 'CONFIRMED', 'MADE'] as const)(
      '%s 주문도 상태 변경으로는 취소할 수 없다(INVALID_ORDER_STATUS_TRANSITION, sellerCancelOrder로만)',
      async (status) => {
        const { account, store } = await setupSellerWithStore(prisma);
        const order = await createStoreOrder(store.id, { status });
        await expect(
          service.sellerUpdateOrderStatus(account.id, {
            orderId: order.id.toString(),
            toStatus: 'CANCELED',
            note: '재고 부족',
          }),
        ).rejects.toThrowDomain('INVALID_ORDER_STATUS_TRANSITION');
        expect(
          await prisma.orderStatusHistory.count({
            where: { order_id: order.id },
          }),
        ).toBe(0);
      },
    );

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
      expect(histories[0]).toMatchObject({
        from_status: 'SUBMITTED',
        to_status: 'CONFIRMED',
        actor_type: 'SELLER',
        actor_account_id: account.id,
      });
    });

    it.each([
      [OrderStatus.PENDING_PAYMENT, 'INVALID_ORDER_STATUS_TRANSITION'],
      // 기본 픽업은 하루 뒤라 아직 노쇼 구간이 아니다
      [OrderStatus.NO_SHOW, 'NO_SHOW_NOT_ALLOWED'],
    ] as const)(
      '판매자는 %s로 바꿀 수 없다(%s, 상태 불변)',
      async (toStatus, code) => {
        const { account, store } = await setupSellerWithStore(prisma);
        const order = await createStoreOrder(store.id, { status: 'MADE' });

        await expect(
          service.sellerUpdateOrderStatus(account.id, {
            orderId: order.id.toString(),
            toStatus,
          }),
        ).rejects.toThrowDomain(code);
        const row = await prisma.order.findUniqueOrThrow({
          where: { id: order.id },
        });
        expect(row.status).toBe('MADE');
      },
    );

    it.each(['CONFIRMED', 'MADE'] as const)(
      '%s 주문을 픽업 시각 뒤 노쇼로 처리하면 노쇼 시각·정산을 남기고 환불은 없다',
      async (status) => {
        const now = new Date('2026-11-19T05:00:00.000Z');
        jest.spyOn(clock, 'now').mockReturnValue(now);
        const { account, store } = await setupSellerWithStore(prisma);
        const order = await createStoreOrder(store.id, {
          status,
          paid: true,
          commissionRateBps: 1_000,
          pickupAt: new Date(now.getTime() - 60 * 60_000),
        });

        const result = await service.sellerUpdateOrderStatus(account.id, {
          orderId: order.id.toString(),
          toStatus: 'NO_SHOW',
        });

        expect(result.status).toBe('NO_SHOW');
        await expect(
          prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
        ).resolves.toMatchObject({
          status: 'NO_SHOW',
          no_show_at: now,
          settlement_base_amount: 10_000,
          commission_amount: 1_000,
          settlement_finalized_at: now,
        });
        expect(
          await prisma.orderStatusHistory.findMany({
            where: { order_id: order.id },
          }),
        ).toEqual([
          expect.objectContaining({
            from_status: status,
            to_status: 'NO_SHOW',
            actor_type: 'SELLER',
          }),
        ]);
        expect(await prisma.refund.count()).toBe(0);
        const [event] = await prisma.outbox.findMany();
        expect(event.payload_json).toMatchObject({
          fromStatus: status,
          toStatus: 'NO_SHOW',
          actorType: 'SELLER',
        });
      },
    );

    it('확정 주문도 바로 픽업 완료할 수 있다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, { status: 'CONFIRMED' });

      const result = await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'PICKED_UP',
      });

      expect(result.status).toBe('PICKED_UP');
    });

    it('입금 대기 주문은 상태를 바꿀 수 없다(404)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, {
        status: 'PENDING_PAYMENT',
      });
      await expect(
        service.sellerUpdateOrderStatus(account.id, {
          orderId: order.id.toString(),
          toStatus: 'CONFIRMED',
        }),
      ).rejects.toThrowDomain('ORDER_NOT_FOUND');
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

    it('픽업 완료는 확인된 결제액으로 정산을 확정한다(수수료 원 미만 버림)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, {
        status: 'MADE',
        paid: true,
        commissionRateBps: 333,
      });

      const now = new Date('2026-09-16T07:00:00.000Z');
      jest.spyOn(clock, 'now').mockReturnValue(now);

      await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'PICKED_UP',
      });

      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({
        status: 'PICKED_UP',
        picked_up_at: now,
        settlement_base_amount: 10_000,
        commission_amount: 333,
        settlement_finalized_at: now,
        settlement_id: null,
      });
    });

    it('확인된 결제가 없는 주문(결제 도입 전)의 픽업 완료는 정산을 확정하지 않는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, { status: 'MADE' });

      await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'PICKED_UP',
      });

      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({
        status: 'PICKED_UP',
        settlement_base_amount: null,
        settlement_finalized_at: null,
      });
    });

    it('픽업 완료가 아닌 전이는 정산을 확정하지 않는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, {
        status: 'CONFIRMED',
        paid: true,
      });

      await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'MADE',
      });

      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({ settlement_finalized_at: null });
    });
  });

  describe('sellerCancelOrder', () => {
    function cancelInput(
      orderId: bigint,
      overrides: Partial<SellerCancelOrderInput> = {},
    ): SellerCancelOrderInput {
      return {
        orderId: orderId.toString(),
        reason: 'OUT_OF_MATERIALS',
        ...overrides,
      };
    }

    it('접수 주문 거절은 결제액 전액 환불이고 사정은 기록하지 않는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, { paid: true });
      const topic = await collectTopic(pubSub, `order.seller.${store.id}`);

      const result = await service.sellerCancelOrder(
        account.id,
        cancelInput(order.id, {
          reason: 'DESIGN_NOT_FEASIBLE',
          note: '도안이 어려워요',
          fault: 'BUYER',
          refundAmount: 0,
        }),
      );

      expect(result).toMatchObject({
        status: 'CANCELED',
        firstItemName: 'Product snapshot',
      });
      await expect(
        prisma.orderStatusHistory.findFirstOrThrow({
          where: { order_id: order.id },
        }),
      ).resolves.toMatchObject({
        from_status: 'SUBMITTED',
        actor_type: 'SELLER',
        actor_account_id: account.id,
        cancel_reason: 'DESIGN_NOT_FEASIBLE',
        cancel_fault: null,
        refund_amount: 10_000,
        note: '도안이 어려워요',
      });
      await expect(
        prisma.refund.findFirstOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({ amount: 10_000, status: 'AWAITING_ACCOUNT' });
      expect(topic.received).toEqual([
        expect.objectContaining({
          kind: 'STATUS_CHANGED',
          orderId: order.id.toString(),
          status: 'CANCELED',
        }),
      ]);
      topic.stop();
    });

    it('제작 완료 주문도 취소할 수 있고 구매자 사정이면 R만 환불하고 남는 금액을 정산 확정한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, {
        status: 'MADE',
        paid: true,
        commissionRateBps: 1_000,
      });

      await service.sellerCancelOrder(
        account.id,
        cancelInput(order.id, {
          reason: 'BUYER_REQUEST',
          fault: 'BUYER',
          refundAmount: 2_500,
        }),
      );

      await expect(
        prisma.refund.findFirstOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({ amount: 2_500 });
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({
        status: 'CANCELED',
        settlement_base_amount: 7_500,
        commission_amount: 750,
      });
    });

    it.each([
      [
        '미입금 사유',
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
        'CONFIRMED',
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
        '픽업 완료 주문',
        'PICKED_UP',
        { fault: 'SELLER' },
        'ORDER_NOT_CANCELLABLE',
      ],
      ['이미 취소된 주문', 'CANCELED', {}, 'ORDER_NOT_CANCELLABLE'],
    ] as const)(
      '%s는 %s로 거절한다',
      async (_label, status, overrides, code) => {
        const { account, store } = await setupSellerWithStore(prisma);
        const order = await createStoreOrder(store.id, { status, paid: true });

        await expect(
          service.sellerCancelOrder(
            account.id,
            cancelInput(order.id, overrides),
          ),
        ).rejects.toThrowDomain(code);
        expect(
          await prisma.orderStatusHistory.count({
            where: { order_id: order.id },
          }),
        ).toBe(0);
      },
    );

    it('다른 매장 주문과 입금 확인 전 주문은 404다', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersOrder = await createStoreOrder(other.store.id);
      const pending = await createStoreOrder(me.store.id, {
        status: 'PENDING_PAYMENT',
      });

      for (const order of [othersOrder, pending]) {
        await expect(
          service.sellerCancelOrder(me.account.id, cancelInput(order.id)),
        ).rejects.toThrowDomain('ORDER_NOT_FOUND');
      }
      expect(await prisma.orderStatusHistory.count()).toBe(0);
    });

    it('취소된 주문 상세는 취소 정보(주체·사유·환불)를 준다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id, {
        status: 'CONFIRMED',
        paid: true,
      });
      await service.sellerCancelOrder(
        account.id,
        cancelInput(order.id, { fault: 'SELLER' }),
      );

      const detail = await service.sellerOrder(account.id, order.id);

      expect(detail.cancellation).toMatchObject({
        actorType: 'SELLER',
        reason: 'OUT_OF_MATERIALS',
        reasonLabel: '재료 소진',
        fault: 'SELLER',
        refundAmount: 10_000,
        refundStatus: 'AWAITING_ACCOUNT',
      });
      expect(detail.statusHistories[0]).toMatchObject({
        toStatus: 'CANCELED',
        actorType: 'SELLER',
        cancelReason: 'OUT_OF_MATERIALS',
      });
    });
  });

  describe('sellerOrderUpdated 발행', () => {
    it('상태 변경 시 매장 토픽에 1건 — 첫 품목 상품명·커스텀 여부와 갱신된 updated_at을 싣는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createOrder(prisma);
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
        product_name_snapshot: '확정 품목',
        custom_mode_snapshot: 'THREE_D',
      });
      const topic = await collectTopic(pubSub, `order.seller.${store.id}`);

      await service.sellerUpdateOrderStatus(account.id, {
        orderId: order.id.toString(),
        toStatus: 'CONFIRMED',
        note: null,
      });

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(topic.received).toEqual([
        {
          kind: 'STATUS_CHANGED',
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          status: 'CONFIRMED',
          pickupAt: order.pickup_at.toISOString(),
          buyerName: order.buyer_name,
          totalPrice: order.total_price,
          productName: '확정 품목',
          hasCustom: true,
          updatedAt: row.updated_at.toISOString(),
        },
      ]);
      expect(row.updated_at.getTime()).toBeGreaterThan(
        order.updated_at.getTime(),
      );
      topic.stop();
    });

    it('반증: 전이 거절(INVALID_ORDER_STATUS_TRANSITION)은 발행하지 않는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const order = await createStoreOrder(store.id);
      const topic = await collectTopic(pubSub, `order.seller.${store.id}`);

      await expect(
        service.sellerUpdateOrderStatus(account.id, {
          orderId: order.id.toString(),
          toStatus: 'MADE',
          note: null,
        }),
      ).rejects.toThrowDomain('INVALID_ORDER_STATUS_TRANSITION');

      expect(topic.received).toHaveLength(0);
      topic.stop();
    });
  });
});
