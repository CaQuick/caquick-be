import { Logger } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ORDER_STATUS_CHANGED } from '@/features/order/events/order-status-changed.event';
import {
  parsePaymentDepositClaimedPayload,
  PAYMENT_DEPOSIT_CLAIMED,
} from '@/features/order/events/payment-deposit-claimed.event';
import { REFUND_ACCOUNT_SUBMITTED } from '@/features/order/events/refund-account-submitted.event';
import { REFUND_REQUESTED } from '@/features/order/events/refund-requested.event';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { PaymentRepository } from '@/features/order/repositories/payment.repository';
import { RefundRepository } from '@/features/order/repositories/refund.repository';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { UserOrderService } from '@/features/order/services/order-my.service';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
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
  createReview,
  createStore,
  createThreeDOrderItemCustom,
  createUserProfile,
  MINIMAL_THREE_D_DESIGN,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { collectTopic } from '@/test/pubsub';

describe('UserOrderService (real DB)', () => {
  let service: UserOrderService;
  let clock: ClockService;
  let prisma: PrismaClient;
  let pubSub: PubSub;
  let cipher: AccountCipher;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
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
    service = module.get(UserOrderService);
    clock = module.get(ClockService);
    pubSub = module.get(PUB_SUB);
    cipher = module.get(AccountCipher);
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

  async function setupUser() {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    return account;
  }

  describe('listMyOrders', () => {
    it('최근 생성 순서로 주문을 반환하고 대표상품/매장/추가 아이템 수를 집계한다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, { store_name: '매장A' });
      const p1 = await createProduct(prisma, {
        store_id: store.id,
        name: '상품1',
      });
      const p2 = await createProduct(prisma, {
        store_id: store.id,
        name: '상품2',
      });

      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: p1.id,
        product_name_snapshot: '상품1 스냅샷',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: p2.id,
      });

      const result = await service.listMyOrders(account.id);

      expect(result.totalCount).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.items[0]).toMatchObject({
        orderId: order.id.toString(),
        representativeProductName: '상품1 스냅샷',
        storeName: '매장A',
        additionalItemCount: 1, // 첫 아이템 외 1개 더
      });
    });

    it('아이템이 없는 주문은 대표상품/매장 기본값을 반환한다', async () => {
      const account = await setupUser();
      await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });

      const result = await service.listMyOrders(account.id);

      expect(result.items[0]).toMatchObject({
        representativeProductName: '상품 정보 없음',
        representativeProductImageUrl: null,
        storeName: '매장 정보 없음',
        regionLabel: null,
        additionalItemCount: 0,
      });
    });

    it.each<[string, number, number, number]>([
      ['할인이 없으면 0', 10000, 0, 0],
      ['할인 금액 ÷ 할인 전 합계를 반올림한다', 40000, 2000, 5],
      // 정가 40,000·판매가 35,000(상품 카드 13%) + 옵션 5,000 — 옵션은 할인 대상이 아니다
      ['옵션 추가금이 붙으면 상품 할인율보다 낮다', 45000, 5000, 11],
      ['할인 전 합계가 0이면 0(0으로 나누지 않는다)', 0, 0, 0],
    ])(
      'discountRate는 주문 기준이다 — %s',
      async (_case, subtotal, discount, expected) => {
        const account = await setupUser();
        await createOrder(prisma, {
          account_id: account.id,
          subtotal_price: subtotal,
          discount_price: discount,
          total_price: subtotal - discount,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].discountRate).toBe(expected);
      },
    );

    it('regionLabel은 주문 시점 스냅샷이라 이후 매장 주소가 바뀌어도 그대로다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, {
        address_city: '인천',
        address_neighborhood: '청라동',
      });
      const order = await createOrder(prisma, { account_id: account.id });
      await createOrderItem(prisma, { order_id: order.id, store_id: store.id });
      await prisma.store.update({
        where: { id: store.id },
        data: { address_city: '서울특별시', address_neighborhood: '역삼동' },
      });

      const result = await service.listMyOrders(account.id);

      expect(result.items[0].regionLabel).toBe('인천 청라동');
    });

    it('대표 품목의 지역 스냅샷이 null이면 regionLabel도 null이다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, { account_id: account.id });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_region_label_snapshot: null,
      });

      const result = await service.listMyOrders(account.id);

      expect(result.items[0].regionLabel).toBeNull();
    });

    it('status 필터를 전달하면 해당 상태의 주문만 포함한다', async () => {
      const account = await setupUser();
      await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });

      const result = await service.listMyOrders(account.id, {
        statuses: ['PICKED_UP'],
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].status).toBe('PICKED_UP');
    });

    it('limit을 초과하면 hasMore true이고 정확히 limit개만 반환한다', async () => {
      const account = await setupUser();
      for (let i = 0; i < 4; i++) {
        await createOrder(prisma, {
          account_id: account.id,
          status: 'SUBMITTED',
        });
      }

      const result = await service.listMyOrders(account.id, {
        offset: 0,
        limit: 2,
      });

      expect(result.totalCount).toBe(4);
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it('다른 계정의 주문은 포함되지 않는다', async () => {
      const me = await setupUser();
      const other = await setupUser();
      await createOrder(prisma, { account_id: me.id, status: 'SUBMITTED' });
      await createOrder(prisma, {
        account_id: other.id,
        status: 'SUBMITTED',
      });

      const result = await service.listMyOrders(me.id);

      expect(result.totalCount).toBe(1);
    });

    it('주문이 0건이면 빈 connection을 반환한다', async () => {
      const account = await setupUser();

      const result = await service.listMyOrders(account.id);

      expect(result.totalCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    describe('hasReviewableItem', () => {
      async function createPickedUpOrderWithItem(accountId: bigint) {
        const store = await createStore(prisma);
        const product = await createProduct(prisma, { store_id: store.id });
        const order = await createOrder(prisma, {
          account_id: accountId,
          status: 'PICKED_UP',
        });
        const item = await createOrderItem(prisma, {
          order_id: order.id,
          product_id: product.id,
        });
        return { store, product, order, item };
      }

      async function makeReview(args: {
        orderItemId: bigint;
        accountId: bigint;
        storeId: bigint;
        productId: bigint;
        deletedAt?: Date | null;
      }) {
        return createReview(prisma, {
          order_item_id: args.orderItemId,
          account_id: args.accountId,
          store_id: args.storeId,
          product_id: args.productId,
          content: '리뷰 더미 텍스트입니다. 만족합니다.',
          deleted_at: args.deletedAt ?? null,
        });
      }

      it('PICKED_UP + 리뷰 미작성 item이 1건이면 true', async () => {
        const account = await setupUser();
        await createPickedUpOrderWithItem(account.id);

        const result = await service.listMyOrders(account.id);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].hasReviewableItem).toBe(true);
      });

      it('PICKED_UP + 모든 item에 active 리뷰가 있으면 false', async () => {
        const account = await setupUser();
        const { item, store, product } = await createPickedUpOrderWithItem(
          account.id,
        );
        await makeReview({
          orderItemId: item.id,
          accountId: account.id,
          storeId: store.id,
          productId: product.id,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].hasReviewableItem).toBe(false);
      });

      it('PICKED_UP + 모든 item의 리뷰가 soft-delete면 true', async () => {
        const account = await setupUser();
        const { item, store, product } = await createPickedUpOrderWithItem(
          account.id,
        );
        await makeReview({
          orderItemId: item.id,
          accountId: account.id,
          storeId: store.id,
          productId: product.id,
          deletedAt: new Date(),
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].hasReviewableItem).toBe(true);
      });

      it('CONFIRMED 등 비-PICKED_UP 상태는 false', async () => {
        const account = await setupUser();
        const store = await createStore(prisma);
        const product = await createProduct(prisma, { store_id: store.id });
        const order = await createOrder(prisma, {
          account_id: account.id,
          status: 'CONFIRMED',
        });
        await createOrderItem(prisma, {
          order_id: order.id,
          product_id: product.id,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].status).toBe('CONFIRMED');
        expect(result.items[0].hasReviewableItem).toBe(false);
      });

      it('CANCELED 상태는 false', async () => {
        const account = await setupUser();
        const store = await createStore(prisma);
        const product = await createProduct(prisma, { store_id: store.id });
        const order = await createOrder(prisma, {
          account_id: account.id,
          status: 'CANCELED',
        });
        await createOrderItem(prisma, {
          order_id: order.id,
          product_id: product.id,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].status).toBe('CANCELED');
        expect(result.items[0].hasReviewableItem).toBe(false);
      });

      it('PICKED_UP + 일부 item에만 리뷰 미작성이면 true (혼합 케이스)', async () => {
        const account = await setupUser();
        const { item, store, product, order } =
          await createPickedUpOrderWithItem(account.id);
        // item1에는 리뷰가 있고, item2에는 없음
        await makeReview({
          orderItemId: item.id,
          accountId: account.id,
          storeId: store.id,
          productId: product.id,
        });
        const product2 = await createProduct(prisma, { store_id: store.id });
        await createOrderItem(prisma, {
          order_id: order.id,
          product_id: product2.id,
        });

        const result = await service.listMyOrders(account.id);

        expect(result.items[0].hasReviewableItem).toBe(true);
      });
    });
  });

  describe('getMyOrder', () => {
    it('본인 주문의 상세(items/store/status) DTO를 반환한다', async () => {
      const account = await setupUser();
      const store = await createStore(prisma, {
        store_name: '매장B',
        store_phone: '02-1234-5678',
      });
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '상품X',
        regular_price: 30000,
        sale_price: 25000,
      });
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
        quantity: 2,
        regular_price_snapshot: 30000,
        sale_price_snapshot: 25000,
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { request_note: '초는 빼 주세요' },
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.orderId).toBe(order.id.toString());
      expect(result.requestNote).toBe('초는 빼 주세요');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        item: {
          productName: expect.any(String),
          quantity: 2,
          regularPrice: 30000,
          salePrice: 25000,
        },
        hasMyReview: false,
        canWriteReview: false, // 상태가 SUBMITTED이므로 불가
      });
      expect(result.store).toMatchObject({
        storeName: '매장B',
        storePhone: '02-1234-5678',
      });
    });

    it('커스텀 스냅샷(방식·대표·바탕 이미지·렌더 종류 순·3D 디자인·문구·자유 편집 영역)을 상세에 싣는다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, { account_id: account.id });
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        custom_mode_snapshot: 'THREE_D',
        custom_preview_image_url: 'https://img/THREE_D_TOP.png',
      });
      await createThreeDOrderItemCustom(prisma, item.id);
      const slot = await createOrderItem(prisma, {
        order_id: order.id,
        custom_mode_snapshot: 'SLOT',
        custom_base_image_url_snapshot: 'https://img/base.png',
        custom_preview_image_url: 'https://img/composite.png',
      });
      await prisma.orderItemCustomText.create({
        data: {
          order_item_id: slot.id,
          token_id: 77n,
          token_key_snapshot: 'top',
          label_snapshot: '윗줄',
          default_text_snapshot: '축하해',
          value_text: null,
          pos_x: 1000,
          pos_y: 1000,
          width: 8000,
          height: 1500,
          text_color: '#1D1D1D',
          text_align: 'RIGHT',
        },
      });
      await prisma.orderItemCustomFreeEdit.create({
        data: {
          order_item_id: slot.id,
          pos_x: 2000,
          pos_y: 4000,
          width: 6000,
          height: 4000,
          description_text: '여기에 그림',
        },
      });

      const result = await service.getMyOrder(account.id, order.id);

      const [threeD, slotItem] = result.items.map((i) => i.item);
      expect(threeD).toMatchObject({
        customMode: 'THREE_D',
        customPreviewImageUrl: 'https://img/THREE_D_TOP.png',
        customBaseImageUrl: null,
        threeDDesign: MINIMAL_THREE_D_DESIGN,
        customTexts: [],
        freeEdits: [],
      });
      expect(threeD.customImages.map((i) => i.kind)).toEqual([
        'THREE_D_TOP',
        'THREE_D_FRONT',
        'THREE_D_BACK',
        'THREE_D_LEFT',
        'THREE_D_RIGHT',
      ]);
      expect(slotItem).toMatchObject({
        customMode: 'SLOT',
        customPreviewImageUrl: 'https://img/composite.png',
        customBaseImageUrl: 'https://img/base.png',
        customImages: [],
        threeDDesign: null,
        customTexts: [
          {
            tokenId: '77',
            label: '윗줄',
            valueText: null,
            posX: 1000,
            posY: 1000,
            width: 8000,
            height: 1500,
            textColor: '#1D1D1D',
            textAlign: 'RIGHT',
          },
        ],
        freeEdits: [
          {
            posX: 2000,
            posY: 4000,
            width: 6000,
            height: 4000,
            descriptionText: '여기에 그림',
          },
        ],
      });
    });

    it('저장된 3D 디자인을 읽을 수 없으면 디자인만 null이고 상세는 내려간다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, { account_id: account.id });
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        custom_mode_snapshot: 'THREE_D',
      });
      await createThreeDOrderItemCustom(prisma, item.id, { schemaVersion: 1 });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.items[0].item.threeDDesign).toBeNull();
      expect(result.items[0].item.customImages).toHaveLength(5);
    });

    it('존재하지 않는 orderId면 404', async () => {
      const account = await setupUser();
      await expect(
        service.getMyOrder(account.id, BigInt(999999)),
      ).rejects.toThrowDomain(404);
    });

    it('다른 계정의 orderId는 404로 접근 차단', async () => {
      const me = await setupUser();
      const other = await setupUser();
      const othersOrder = await createOrder(prisma, {
        account_id: other.id,
        status: 'SUBMITTED',
      });

      await expect(
        service.getMyOrder(me.id, othersOrder.id),
      ).rejects.toThrowDomain(404);
    });

    it('PICKED_UP 상태면서 리뷰 미작성 아이템은 canWriteReview=true', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.items[0].canWriteReview).toBe(true);
      expect(result.items[0].hasMyReview).toBe(false);
    });

    it('PICKED_UP 주문 아이템에 리뷰가 있으면 hasMyReview=true, canWriteReview=false', async () => {
      const account = await setupUser();
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
      });

      await createReview(prisma, {
        order_item_id: item.id,
        account_id: account.id,
        store_id: store.id,
        product_id: product.id,
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.items[0].hasMyReview).toBe(true);
      expect(result.items[0].canWriteReview).toBe(false);
    });

    it('아이템이 없는 주문은 store에 "매장 정보 없음" 폴백을 반환한다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.items).toHaveLength(0);
      expect(result.store.storeId).toBe('0');
      expect(result.store.storeName).toBe('매장 정보 없음');
    });

    it('status_histories가 있으면 DTO에 포함되어 시간순으로 반환된다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'CONFIRMED',
      });

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

      const result = await service.getMyOrder(account.id, order.id);

      expect(result.statusHistories).toHaveLength(1);
      expect(result.statusHistories[0]).toMatchObject({
        fromStatus: 'SUBMITTED',
        toStatus: 'CONFIRMED',
        note: '접수 확정',
      });
    });
  });

  describe('결제 출력', () => {
    it('상세는 입금 안내를, 목록은 결제 대기일 때만 입금 기한을 싣는다', async () => {
      const account = await setupUser();
      const expiresAt = new Date('2026-09-16T08:00:00.000Z');
      const pending = await createOrder(prisma, {
        account_id: account.id,
        status: 'PENDING_PAYMENT',
      });
      await createPayment(prisma, {
        order_id: pending.id,
        depositor_name: '차차맘',
        expires_at: expiresAt,
      });
      const confirmed = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      await createPayment(prisma, {
        order_id: confirmed.id,
        status: 'CONFIRMED',
        confirmed_at: expiresAt,
      });
      const legacy = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });

      const detail = await service.getMyOrder(account.id, pending.id);
      expect(detail.payment).toEqual({
        method: 'BANK_TRANSFER',
        status: 'PENDING',
        amount: pending.total_price,
        depositorName: '차차맘',
        depositBank: { code: '004', name: 'KB국민은행' },
        depositAccountNumber: '12345678901234',
        depositAccountHolder: '케이퀵',
        expiresAt,
        buyerClaimedAt: null,
        confirmedAt: null,
        confirmSource: null,
      });
      expect((await service.getMyOrder(account.id, legacy.id)).payment).toBe(
        null,
      );

      const list = await service.listMyOrders(account.id);
      const expiresById = new Map(
        list.items.map((item) => [item.orderId, item.paymentExpiresAt]),
      );
      expect(expiresById).toEqual(
        new Map([
          [pending.id.toString(), expiresAt],
          [confirmed.id.toString(), null],
          [legacy.id.toString(), null],
        ]),
      );
    });
  });

  describe('markMyOrderDepositSent', () => {
    const NOW = new Date('2026-09-16T07:30:00.000Z');
    const EXPIRES_AT = new Date('2026-09-16T08:00:00.000Z');

    async function pendingOrder(accountId: bigint) {
      const order = await createOrder(prisma, {
        account_id: accountId,
        status: 'PENDING_PAYMENT',
      });
      await createPayment(prisma, {
        order_id: order.id,
        depositor_name: '차차맘',
        expires_at: EXPIRES_AT,
      });
      return order;
    }

    const claimedCount = () =>
      prisma.payment.count({ where: { buyer_claimed_at: { not: null } } });
    const claimEvents = () =>
      prisma.outbox.findMany({
        where: { event_type: PAYMENT_DEPOSIT_CLAIMED },
      });

    it('기한 전 첫 누름은 시각을 기록하고 확인 요청 이벤트를 남긴다', async () => {
      const account = await setupUser();
      const order = await pendingOrder(account.id);
      jest.spyOn(clock, 'now').mockReturnValue(NOW);

      const result = await service.markMyOrderDepositSent(account.id, order.id);

      expect(result.payment).toMatchObject({ buyerClaimedAt: NOW });
      await expect(
        prisma.payment.findUniqueOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({ buyer_claimed_at: NOW, status: 'PENDING' });
      const events = await claimEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        aggregate_id: order.id.toString(),
        actor_account_id: account.id,
        occurred_at: NOW,
      });
      expect(parsePaymentDepositClaimedPayload(events[0].payload_json)).toEqual(
        {
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          amount: order.total_price,
          depositorName: '차차맘',
        },
      );
    });

    it('다시 누르면 기한이 지났어도 바꾸지 않고 그대로 돌려준다(멱등)', async () => {
      const account = await setupUser();
      const order = await pendingOrder(account.id);
      jest.spyOn(clock, 'now').mockReturnValue(NOW);
      await service.markMyOrderDepositSent(account.id, order.id);

      jest
        .spyOn(clock, 'now')
        .mockReturnValue(new Date('2026-09-16T09:00:00Z'));
      const again = await service.markMyOrderDepositSent(account.id, order.id);

      expect(again.payment).toMatchObject({ buyerClaimedAt: NOW });
      expect(await claimEvents()).toHaveLength(1);
    });

    it.each([
      ['기한 정각', EXPIRES_AT],
      ['기한 뒤', new Date(EXPIRES_AT.getTime() + 1)],
    ])(
      '누르지 않은 채 %s이면 PAYMENT_DEADLINE_PASSED다',
      async (_case, now) => {
        const account = await setupUser();
        const order = await pendingOrder(account.id);
        jest.spyOn(clock, 'now').mockReturnValue(now);

        await expect(
          service.markMyOrderDepositSent(account.id, order.id),
        ).rejects.toThrowDomain('PAYMENT_DEADLINE_PASSED');
        expect(await claimedCount()).toBe(0);
        expect(await claimEvents()).toHaveLength(0);
      },
    );

    it('기한 1ms 전이면 받는다', async () => {
      const account = await setupUser();
      const order = await pendingOrder(account.id);
      jest
        .spyOn(clock, 'now')
        .mockReturnValue(new Date(EXPIRES_AT.getTime() - 1));

      await expect(
        service.markMyOrderDepositSent(account.id, order.id),
      ).resolves.toMatchObject({ status: 'PENDING_PAYMENT' });
    });

    it.each<
      [string, 'SUBMITTED' | 'CANCELED', 'CONFIRMED' | 'CANCELED' | null]
    >([
      ['입금 확인된 주문', 'SUBMITTED', 'CONFIRMED'],
      ['입금 전 취소된 주문', 'CANCELED', 'CANCELED'],
      ['결제 기록이 없는 주문', 'SUBMITTED', null],
    ])('%s은 PAYMENT_NOT_PENDING이다', async (_case, status, paymentStatus) => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status,
      });
      if (paymentStatus) {
        await createPayment(prisma, {
          order_id: order.id,
          status: paymentStatus,
        });
      }
      jest.spyOn(clock, 'now').mockReturnValue(NOW);

      await expect(
        service.markMyOrderDepositSent(account.id, order.id),
      ).rejects.toThrowDomain('PAYMENT_NOT_PENDING');
    });

    it('다른 계정·삭제된 주문은 ORDER_NOT_FOUND다', async () => {
      const account = await setupUser();
      const other = await setupUser();
      const order = await pendingOrder(other.id);
      const deleted = await pendingOrder(account.id);
      await prisma.order.update({
        where: { id: deleted.id },
        data: { deleted_at: NOW },
      });
      jest.spyOn(clock, 'now').mockReturnValue(NOW);

      for (const id of [order.id, deleted.id]) {
        await expect(
          service.markMyOrderDepositSent(account.id, id),
        ).rejects.toThrowDomain('ORDER_NOT_FOUND');
      }
      expect(await claimedCount()).toBe(0);
      expect(await claimEvents()).toHaveLength(0);
    });
  });

  describe('cancelMyOrder', () => {
    const NOW = new Date('2026-09-16T07:30:00.000Z');

    async function myOrder(
      accountId: bigint,
      status: OrderStatus,
      payment: 'PENDING' | 'CONFIRMED' | null,
    ) {
      const order = await createOrder(prisma, {
        account_id: accountId,
        status,
      });
      const item = await createOrderItem(prisma, { order_id: order.id });
      if (payment) {
        await createPayment(prisma, {
          order_id: order.id,
          status: payment,
          confirmed_at: payment === 'CONFIRMED' ? NOW : null,
        });
      }
      return { order, item };
    }

    it('입금 대기 주문은 환불 없이 취소되고 결제를 닫으며 판매자에게는 아무것도 가지 않는다', async () => {
      const account = await setupUser();
      const { order, item } = await myOrder(
        account.id,
        'PENDING_PAYMENT',
        'PENDING',
      );
      jest.spyOn(clock, 'now').mockReturnValue(NOW);
      const topic = await collectTopic(pubSub, `order.seller.${item.store_id}`);

      const result = await service.cancelMyOrder(account.id, {
        orderId: order.id.toString(),
        note: '  다시 주문할게요  ',
      });

      expect(result).toMatchObject({
        status: 'CANCELED',
        canceledAt: NOW,
        canCancel: false,
        cancellation: {
          actorType: 'BUYER',
          reason: 'BUYER_REQUEST',
          reasonLabel: '구매자 요청',
          note: '다시 주문할게요',
          fault: null,
          refundAmount: 0,
          refundStatus: null,
          canceledAt: NOW,
        },
      });
      expect(result.payment).toMatchObject({ status: 'CANCELED' });
      expect(await prisma.refund.count()).toBe(0);
      const events = await prisma.outbox.findMany();
      expect(events.map((e) => e.event_type)).toEqual([ORDER_STATUS_CHANGED]);
      expect(events[0].payload_json).toMatchObject({
        actorType: 'BUYER',
        cancelReason: 'BUYER_REQUEST',
      });
      expect(topic.received).toHaveLength(0);
      topic.stop();
    });

    it("'입금했어요'를 누른 입금 대기 주문도 취소할 수 있다", async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'PENDING_PAYMENT',
      });
      await createPayment(prisma, {
        order_id: order.id,
        buyer_claimed_at: NOW,
      });

      await expect(
        service.cancelMyOrder(account.id, { orderId: order.id.toString() }),
      ).resolves.toMatchObject({ status: 'CANCELED' });
    });

    it('접수 주문은 결제액 전액 환불(계좌 입력 대기)로 취소되고 판매자 구독에 알린다', async () => {
      const account = await setupUser();
      const { order, item } = await myOrder(
        account.id,
        'SUBMITTED',
        'CONFIRMED',
      );
      const topic = await collectTopic(pubSub, `order.seller.${item.store_id}`);

      const result = await service.cancelMyOrder(account.id, {
        orderId: order.id.toString(),
      });

      expect(result.cancellation).toMatchObject({
        refundAmount: order.total_price,
        refundStatus: 'AWAITING_ACCOUNT',
      });
      expect(result.payment).toMatchObject({ status: 'CONFIRMED' });
      await expect(
        prisma.refund.findFirstOrThrow({ where: { order_id: order.id } }),
      ).resolves.toMatchObject({
        kind: 'CANCEL',
        amount: order.total_price,
      });
      expect(
        (await prisma.outbox.findMany({ orderBy: { id: 'asc' } })).map(
          (e) => e.event_type,
        ),
      ).toEqual([ORDER_STATUS_CHANGED, REFUND_REQUESTED]);
      expect(topic.received).toEqual([
        expect.objectContaining({ kind: 'STATUS_CHANGED', status: 'CANCELED' }),
      ]);
      topic.stop();
    });

    it.each(['CONFIRMED', 'MADE', 'PICKED_UP', 'NO_SHOW', 'CANCELED'] as const)(
      '판매자 확정 뒤(%s)에는 ORDER_NOT_CANCELLABLE이다',
      async (status) => {
        const account = await setupUser();
        const { order } = await myOrder(account.id, status, 'CONFIRMED');

        await expect(
          service.cancelMyOrder(account.id, { orderId: order.id.toString() }),
        ).rejects.toThrowDomain('ORDER_NOT_CANCELLABLE');
        expect(await prisma.orderStatusHistory.count()).toBe(0);
      },
    );

    it('다른 계정·삭제된 주문은 ORDER_NOT_FOUND, 메모 501자는 TEXT_TOO_LONG이다', async () => {
      const account = await setupUser();
      const other = await setupUser();
      const { order: othersOrder } = await myOrder(other.id, 'SUBMITTED', null);
      const deleted = await createOrder(prisma, {
        account_id: account.id,
        deleted_at: NOW,
      });
      const { order } = await myOrder(account.id, 'SUBMITTED', null);

      for (const id of [othersOrder.id, deleted.id]) {
        await expect(
          service.cancelMyOrder(account.id, { orderId: id.toString() }),
        ).rejects.toThrowDomain('ORDER_NOT_FOUND');
      }
      await expect(
        service.cancelMyOrder(account.id, {
          orderId: order.id.toString(),
          note: 'x'.repeat(501),
        }),
      ).rejects.toThrowDomain('TEXT_TOO_LONG');
      expect(await prisma.orderStatusHistory.count()).toBe(0);
    });

    it.each([
      ['PENDING_PAYMENT', true],
      ['SUBMITTED', true],
      ['CONFIRMED', false],
      ['MADE', false],
      ['PICKED_UP', false],
      ['NO_SHOW', false],
      ['CANCELED', false],
    ] as const)('상세 canCancel: %s → %s', async (status, canCancel) => {
      const account = await setupUser();
      const { order } = await myOrder(account.id, status, null);

      const detail = await service.getMyOrder(account.id, order.id);

      expect(detail.canCancel).toBe(canCancel);
      expect(detail.cancellation).toBeNull();
    });
  });

  describe('환불 계좌', () => {
    const NOW = new Date('2026-09-16T07:30:00.000Z');
    const ACCOUNT = {
      bankCode: '088',
      accountHolder: ' 홍길동 ',
      accountNumber: '110-123-456789',
    };

    async function submittedOrder(accountId: bigint) {
      const order = await createOrder(prisma, {
        account_id: accountId,
        status: 'SUBMITTED',
      });
      await createOrderItem(prisma, { order_id: order.id });
      await createPayment(prisma, {
        order_id: order.id,
        status: 'CONFIRMED',
        confirmed_at: NOW,
      });
      return order;
    }

    async function expectAccount(refundId: bigint, accountNumber: string) {
      const row = await prisma.refund.findUniqueOrThrow({
        where: { id: refundId },
      });
      expect(cipher.decrypt(row.account_number_enc!, 'refund-account')).toBe(
        accountNumber,
      );
      return row;
    }

    beforeEach(() => {
      jest.spyOn(clock, 'now').mockReturnValue(NOW);
    });

    it('취소와 함께 계좌를 받으면 환불이 바로 송금 대기가 되고 이벤트에 계좌 입력을 싣는다', async () => {
      const account = await setupUser();
      const order = await submittedOrder(account.id);

      const result = await service.cancelMyOrder(account.id, {
        orderId: order.id.toString(),
        refundAccount: ACCOUNT,
      });

      expect(result.cancellation).toMatchObject({
        refundStatus: 'AWAITING_TRANSFER',
      });
      expect(result.refunds).toEqual([
        expect.objectContaining({
          kind: 'CANCEL',
          status: 'AWAITING_TRANSFER',
          bank: { code: '088', name: expect.any(String) },
          accountHolder: '홍길동',
          accountNumberMasked: '****6789',
          accountSubmittedAt: NOW,
        }),
      ]);
      const refund = await expectAccount(
        BigInt(result.refunds[0].id),
        '110123456789',
      );
      expect(refund.account_number_last4).toBe('6789');
      const requested = await prisma.outbox.findFirstOrThrow({
        where: { event_type: REFUND_REQUESTED },
      });
      expect(requested.payload_json).toMatchObject({ accountSubmitted: true });
    });

    it('환불이 없는 취소(입금 대기)에 보낸 계좌는 버린다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'PENDING_PAYMENT',
      });
      await createPayment(prisma, { order_id: order.id });

      const result = await service.cancelMyOrder(account.id, {
        orderId: order.id.toString(),
        refundAccount: ACCOUNT,
      });

      expect(result).toMatchObject({ status: 'CANCELED', refunds: [] });
      expect(await prisma.refund.count()).toBe(0);
    });

    it('계좌 형식이 틀리면 취소하지 않는다', async () => {
      const account = await setupUser();
      const order = await submittedOrder(account.id);

      await expect(
        service.cancelMyOrder(account.id, {
          orderId: order.id.toString(),
          refundAccount: { ...ACCOUNT, bankCode: '999' },
        }),
      ).rejects.toThrowDomain('INVALID_BANK_CODE');
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
          .status,
      ).toBe('SUBMITTED');
    });

    it('계좌 입력 대기 환불에 계좌를 넣으면 송금 대기가 되고, 완료 전에는 덮어쓸 수 있다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'CANCELED',
      });
      const refund = await createRefund(prisma, { order_id: order.id });

      const first = await service.submitMyRefundAccount(account.id, {
        refundId: refund.id.toString(),
        ...ACCOUNT,
      });
      expect(first.refunds).toEqual([
        expect.objectContaining({
          id: refund.id.toString(),
          status: 'AWAITING_TRANSFER',
          accountNumberMasked: '****6789',
          accountSubmittedAt: NOW,
        }),
      ]);

      const later = new Date(NOW.getTime() + 60_000);
      jest.spyOn(clock, 'now').mockReturnValue(later);
      const second = await service.submitMyRefundAccount(account.id, {
        refundId: refund.id.toString(),
        bankCode: '004',
        accountHolder: '김철수',
        accountNumber: '12345678',
      });

      expect(second.refunds[0]).toMatchObject({
        status: 'AWAITING_TRANSFER',
        bank: { code: '004' },
        accountHolder: '김철수',
        accountNumberMasked: '****5678',
        accountSubmittedAt: later,
      });
      await expectAccount(refund.id, '12345678');
      const events = await prisma.outbox.findMany({ orderBy: { id: 'asc' } });
      expect(events.map((e) => e.event_type)).toEqual([
        REFUND_ACCOUNT_SUBMITTED,
        REFUND_ACCOUNT_SUBMITTED,
      ]);
      expect(events[1].payload_json).toMatchObject({
        refundId: refund.id.toString(),
        orderNumber: order.order_number,
        buyerAccountId: account.id.toString(),
        amount: refund.amount,
      });
    });

    it('송금이 끝난 환불은 REFUND_ALREADY_COMPLETED로 거절하고 계좌를 바꾸지 않는다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'CANCELED',
      });
      const refund = await createRefund(prisma, {
        order_id: order.id,
        status: 'COMPLETED',
      });

      await expect(
        service.submitMyRefundAccount(account.id, {
          refundId: refund.id.toString(),
          ...ACCOUNT,
        }),
      ).rejects.toThrowDomain('REFUND_ALREADY_COMPLETED');
      await expect(
        prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }),
      ).resolves.toMatchObject({ account_number_last4: '5678' });
      expect(await prisma.outbox.count()).toBe(0);
    });

    it('다른 계정·삭제된 주문의 환불과 없는 환불은 REFUND_NOT_FOUND, 계좌번호 형식 오류는 INVALID_ACCOUNT_NUMBER다', async () => {
      const account = await setupUser();
      const other = await setupUser();
      const othersRefund = await createRefund(prisma, {
        order_id: (
          await createOrder(prisma, {
            account_id: other.id,
            status: 'CANCELED',
          })
        ).id,
      });
      const deletedRefund = await createRefund(prisma, {
        order_id: (
          await createOrder(prisma, {
            account_id: account.id,
            status: 'CANCELED',
            deleted_at: NOW,
          })
        ).id,
      });
      const mine = await createRefund(prisma, {
        order_id: (
          await createOrder(prisma, {
            account_id: account.id,
            status: 'CANCELED',
          })
        ).id,
      });

      for (const id of [othersRefund.id, deletedRefund.id, 999_999n]) {
        await expect(
          service.submitMyRefundAccount(account.id, {
            refundId: id.toString(),
            ...ACCOUNT,
          }),
        ).rejects.toThrowDomain('REFUND_NOT_FOUND');
      }
      await expect(
        service.submitMyRefundAccount(account.id, {
          refundId: mine.id.toString(),
          ...ACCOUNT,
          accountNumber: '1234-567',
        }),
      ).rejects.toThrowDomain('INVALID_ACCOUNT_NUMBER');
      expect(
        await prisma.refund.count({ where: { status: 'AWAITING_ACCOUNT' } }),
      ).toBe(3);
    });

    it('상세 refunds는 취소 환불과 입금 반환을 생긴 순서대로 싣는다', async () => {
      const account = await setupUser();
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'CANCELED',
      });
      const cancel = await createRefund(prisma, { order_id: order.id });
      const deposit = await createRefund(prisma, {
        order_id: order.id,
        kind: 'DEPOSIT_RETURN',
        amount: 5_000,
        status: 'COMPLETED',
      });

      const detail = await service.getMyOrder(account.id, order.id);

      expect(detail.refunds).toEqual([
        expect.objectContaining({
          id: cancel.id.toString(),
          kind: 'CANCEL',
          status: 'AWAITING_ACCOUNT',
          bank: null,
          accountNumberMasked: null,
        }),
        expect.objectContaining({
          id: deposit.id.toString(),
          kind: 'DEPOSIT_RETURN',
          amount: 5_000,
          status: 'COMPLETED',
        }),
      ]);
    });
  });
});
