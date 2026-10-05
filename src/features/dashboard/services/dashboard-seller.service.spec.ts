import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { SellerDashboardService } from '@/features/dashboard/services/dashboard-seller.service';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createStoreDailyCapacity,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

// KST 2026-10-05 12:00 — 기준일 범위는 [10-04T15:00Z, 10-05T15:00Z)
const NOW = new Date('2026-10-05T03:00:00Z');
const TODAY = '2026-10-05';
const TODAY_DATE_ONLY = new Date('2026-10-05');
const DAY_START = new Date('2026-10-04T15:00:00Z');
const BEFORE_DAY_START = new Date('2026-10-04T14:59:59.999Z');
const IN_DAY = new Date('2026-10-05T05:00:00Z');
const YESTERDAY = new Date('2026-10-04T05:00:00Z');

describe('SellerDashboardService (real DB)', () => {
  let service: SellerDashboardService;
  let conversations: ConversationRepository;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerDashboardService,
        StoreSellerRepository,
        OrderRepository,
        ProductRepository,
        ConversationRepository,
        ClockService,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        ...bookedQuantityProviders(),
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders(),
      ],
    });
    service = module.get(SellerDashboardService);
    conversations = module.get(ConversationRepository);
    clock = module.get(ClockService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.spyOn(clock, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function storeOrder(
    storeId: bigint,
    overrides: {
      status?: OrderStatus;
      pickupAt?: Date;
      createdAt?: Date;
      totalPrice?: number;
      quantity?: number;
      deletedAt?: Date;
      itemDeletedAt?: Date;
    } = {},
  ) {
    const order = await createOrder(prisma, {
      status: overrides.status,
      pickup_at: overrides.pickupAt ?? IN_DAY,
      created_at: overrides.createdAt ?? IN_DAY,
      total_price: overrides.totalPrice,
      deleted_at: overrides.deletedAt,
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: storeId,
      quantity: overrides.quantity,
      deleted_at: overrides.itemDeletedAt,
    });
    return order;
  }

  async function dashboard(accountId: bigint, date?: string | null) {
    return service.sellerDashboard(
      accountId,
      date === undefined ? undefined : { date },
    );
  }

  describe('기준 날짜', () => {
    it('생략하면 clock.now()의 KST 오늘이고 asOf는 현재 시각이다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const result = await dashboard(account.id);
      expect(result.date).toBe(TODAY);
      expect(result.asOf).toEqual(NOW);
      expect(result).toMatchObject({
        newOrderCount: 0,
        pickupDay: { orderCount: 0, salesAmount: 0 },
        createdDay: { orderCount: 0, salesAmount: 0 },
        capacity: null,
        remainingCapacity: null,
        bookedQuantity: 0,
        activeProductCount: 0,
        unansweredConversationCount: 0,
      });
    });

    it('null이면 오늘로 본다', async () => {
      const { account } = await setupSellerWithStore(prisma);
      expect((await dashboard(account.id, null)).date).toBe(TODAY);
    });

    it('다른 날짜를 주면 그 날짜 기준이고 asOf는 그대로 현재 시각이다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await storeOrder(store.id, { pickupAt: YESTERDAY, totalPrice: 500 });
      const result = await dashboard(account.id, '2026-10-04');
      expect(result.date).toBe('2026-10-04');
      expect(result.asOf).toEqual(NOW);
      expect(result.pickupDay).toEqual({ orderCount: 1, salesAmount: 500 });
    });

    it.each([
      ['존재하지 않는 날짜', '2026-02-30'],
      ['자릿수 부족', '2026-1-5'],
      ['빈 문자열(오늘로 폴백하지 않는다)', ''],
    ])('%s → INVALID_DATE', async (_label, date) => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(dashboard(account.id, date)).rejects.toThrowDomain(
        'INVALID_DATE',
      );
    });

    it('반증: KST 자정(14:59:59.999Z vs 15:00:00Z)으로 날짜를 가른다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await storeOrder(store.id, {
        pickupAt: DAY_START,
        createdAt: DAY_START,
        totalPrice: 1,
        quantity: 1,
      });
      await storeOrder(store.id, {
        pickupAt: BEFORE_DAY_START,
        createdAt: BEFORE_DAY_START,
        totalPrice: 10,
        quantity: 10,
      });

      const today = await dashboard(account.id);
      expect(today.pickupDay).toEqual({ orderCount: 1, salesAmount: 1 });
      expect(today.createdDay).toEqual({ orderCount: 1, salesAmount: 1 });
      expect(today.bookedQuantity).toBe(1);

      const yesterday = await dashboard(account.id, '2026-10-04');
      expect(yesterday.pickupDay).toEqual({ orderCount: 1, salesAmount: 10 });
      expect(yesterday.createdDay).toEqual({ orderCount: 1, salesAmount: 10 });
      expect(yesterday.bookedQuantity).toBe(10);
    });
  });

  describe('newOrderCount', () => {
    it('SUBMITTED만 날짜와 무관하게 세고 다른 매장·soft-delete 주문은 뺀다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      await storeOrder(store.id, { status: 'SUBMITTED' });
      await storeOrder(store.id, {
        status: 'SUBMITTED',
        pickupAt: YESTERDAY,
        createdAt: YESTERDAY,
      });
      await storeOrder(store.id, { status: 'CONFIRMED' });
      await storeOrder(store.id, { status: 'CANCELED' });
      await storeOrder(store.id, { status: 'SUBMITTED', deletedAt: NOW });
      await storeOrder(store.id, { status: 'SUBMITTED', itemDeletedAt: NOW });
      await storeOrder(other.store.id, { status: 'SUBMITTED' });

      expect((await dashboard(account.id)).newOrderCount).toBe(2);
    });
  });

  describe('pickupDay · createdDay', () => {
    it('픽업 기준과 생성 기준을 각자의 컬럼으로 센다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      // 픽업은 오늘, 생성은 어제
      await storeOrder(store.id, {
        pickupAt: IN_DAY,
        createdAt: YESTERDAY,
        totalPrice: 1_000,
      });
      // 픽업은 내일, 생성은 오늘
      await storeOrder(store.id, {
        pickupAt: new Date('2026-10-06T05:00:00Z'),
        createdAt: IN_DAY,
        totalPrice: 2_000,
      });
      await storeOrder(store.id, {
        pickupAt: IN_DAY,
        createdAt: IN_DAY,
        totalPrice: 4_000,
      });

      const result = await dashboard(account.id);
      expect(result.pickupDay).toEqual({ orderCount: 2, salesAmount: 5_000 });
      expect(result.createdDay).toEqual({ orderCount: 2, salesAmount: 6_000 });
    });

    it('CANCELED·soft-delete 주문·품목이 soft-delete된 주문·다른 매장은 뺀다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      await storeOrder(store.id, { status: 'PICKED_UP', totalPrice: 1_000 });
      await storeOrder(store.id, { status: 'CANCELED', totalPrice: 2_000 });
      await storeOrder(store.id, { totalPrice: 4_000, deletedAt: NOW });
      await storeOrder(store.id, { totalPrice: 8_000, itemDeletedAt: NOW });
      await storeOrder(other.store.id, { totalPrice: 16_000 });

      const result = await dashboard(account.id);
      expect(result.pickupDay).toEqual({ orderCount: 1, salesAmount: 1_000 });
      expect(result.createdDay).toEqual({ orderCount: 1, salesAmount: 1_000 });
    });
  });

  describe('capacity · remainingCapacity · bookedQuantity', () => {
    it('설정이 없으면 capacity·remainingCapacity는 null이고 예약 수량은 그대로 센다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await storeOrder(store.id, { quantity: 3 });
      expect(await dashboard(account.id)).toMatchObject({
        capacity: null,
        remainingCapacity: null,
        bookedQuantity: 3,
      });
    });

    it('설정 10 − 예약 3(2+1) = 7, CANCELED·품목 soft-delete·다른 날짜 픽업은 예약에서 뺀다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: TODAY_DATE_ONLY,
        capacity: 10,
      });
      await storeOrder(store.id, { quantity: 2 });
      await storeOrder(store.id, { quantity: 1, createdAt: YESTERDAY });
      await storeOrder(store.id, { quantity: 5, status: 'CANCELED' });
      await storeOrder(store.id, { quantity: 5, itemDeletedAt: NOW });
      await storeOrder(store.id, { quantity: 5, pickupAt: YESTERDAY });

      expect(await dashboard(account.id)).toMatchObject({
        capacity: 10,
        remainingCapacity: 7,
        bookedQuantity: 3,
      });
    });

    it('예약이 설정을 넘으면 remainingCapacity는 0이다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: TODAY_DATE_ONLY,
        capacity: 2,
      });
      await storeOrder(store.id, { quantity: 5 });
      expect(await dashboard(account.id)).toMatchObject({
        capacity: 2,
        remainingCapacity: 0,
        bookedQuantity: 5,
      });
    });

    it('설정 row가 soft-delete됐거나 다른 날짜면 설정 없음으로 본다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: TODAY_DATE_ONLY,
        capacity: 10,
        deleted_at: NOW,
      });
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date('2026-10-06'),
        capacity: 20,
      });
      expect(await dashboard(account.id)).toMatchObject({
        capacity: null,
        remainingCapacity: null,
      });
    });
  });

  describe('activeProductCount', () => {
    it('is_active 상품만 세고 soft-delete·다른 매장은 뺀다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      await createProduct(prisma, { store_id: store.id });
      await createProduct(prisma, { store_id: store.id });
      await createProduct(prisma, { store_id: store.id, is_active: false });
      await createProduct(prisma, { store_id: store.id, deleted_at: NOW });
      await createProduct(prisma, { store_id: other.store.id });

      expect((await dashboard(account.id)).activeProductCount).toBe(2);
    });

    it('반증: 매장이 비활성이어도 내 상품은 센다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await createProduct(prisma, { store_id: store.id });
      await prisma.store.update({
        where: { id: store.id },
        data: { is_active: false },
      });
      expect((await dashboard(account.id)).activeProductCount).toBe(1);
    });
  });

  describe('unansweredConversationCount', () => {
    it('읽지 않은 구매자 메시지가 있는 대화 1 → 읽음 처리 뒤 0', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const customer = await createAccount(prisma, { account_type: 'USER' });
      const conversation = await prisma.storeConversation.create({
        data: {
          account_id: customer.id,
          store_id: store.id,
          last_message_at: YESTERDAY,
        },
      });
      await prisma.storeConversationMessage.create({
        data: {
          conversation_id: conversation.id,
          sender_type: 'USER',
          sender_account_id: customer.id,
          body_format: 'TEXT',
          body_text: '문의',
          created_at: YESTERDAY,
        },
      });

      expect((await dashboard(account.id)).unansweredConversationCount).toBe(1);
      await conversations.markSellerRead(conversation.id);
      expect((await dashboard(account.id)).unansweredConversationCount).toBe(0);
    });
  });

  describe('권한', () => {
    it('USER 계정 → SELLER_ONLY', async () => {
      const user = await createAccount(prisma, { account_type: 'USER' });
      await expect(dashboard(user.id)).rejects.toThrowDomain('SELLER_ONLY');
    });

    it('매장 없는 SELLER → STORE_NOT_FOUND', async () => {
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(dashboard(seller.id)).rejects.toThrowDomain(
        'STORE_NOT_FOUND',
      );
    });
  });
});
