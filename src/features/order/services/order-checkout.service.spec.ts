import { PubSub } from 'graphql-subscriptions';

import { ClockService } from '@/common/providers/clock.service';
import { RandomService } from '@/common/providers/random.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';
import { ORDER_SUBMITTED } from '@/features/order/events/order-submitted.event';
import { pendingPaymentLockName } from '@/features/order/repositories/order-pending-payment-lock.helper';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { PaymentSettingRepository } from '@/features/order/repositories/payment-setting.repository';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { ProductRepository } from '@/features/product';
import { StorePickupScheduleService } from '@/features/store';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import type {
  Account,
  PrismaClient,
  Product,
  Store,
} from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder as createOrderRow,
  createOrderItem,
  createPaymentSetting,
  createProduct,
  createRegion,
  createStore,
  createStoreDailyCapacity,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { collectTopic } from '@/test/pubsub';

// 2026-09-16(수) 16:00 KST 고정
const NOW = new Date('2026-09-16T07:00:00.000Z');
/** 2026-09-18(금) 14:00 KST — 기본 유효 픽업 일시. */
const VALID_PICKUP_AT = new Date('2026-09-18T05:00:00.000Z');

describe('OrderCheckoutService (real DB)', () => {
  let service: OrderCheckoutService;
  let orderRepo: OrderRepository;
  let pickupSchedule: StorePickupScheduleService;
  let clock: ClockService;
  let random: RandomService;
  let pubSub: PubSub;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OrderCheckoutService,
        OrderRepository,
        PaymentSettingRepository,
        ProductRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        StorePickupScheduleService,
        StoreRepository,
        ClockService,
        RandomService,
        // 생성은 판매자 토픽에 발행하지 않는다 — 발행 수단을 열어 두고 미발행을 확인한다(in-memory)
        OrderEventsService,
        { provide: PUB_SUB, useValue: new PubSub() },
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders({ clock: true }),
        ...bookedQuantityProviders(),
      ],
    });
    service = module.get(OrderCheckoutService);
    orderRepo = module.get(OrderRepository);
    pickupSchedule = module.get(StorePickupScheduleService);
    clock = module.get(ClockService);
    random = module.get(RandomService);
    pubSub = module.get(PUB_SUB);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    // truncateAll이 마이그레이션이 넣은 결제 설정 행까지 지운다
    await createPaymentSetting(prisma);
    jest.spyOn(clock, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** 전 요일 10~20시 영업 매장. */
  async function makeOpenStore(): Promise<Store> {
    const store = await createStore(prisma, {
      pickup_slot_interval_minutes: 30,
      min_lead_time_minutes: 60,
    });
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      await prisma.storeBusinessHour.create({
        data: {
          store_id: store.id,
          day_of_week: dayOfWeek,
          is_closed: false,
          open_time: new Date(Date.UTC(1970, 0, 1, 10)),
          close_time: new Date(Date.UTC(1970, 0, 1, 20)),
        },
      });
    }
    return store;
  }

  /** 정가 30000/판매가 25000 상품 + 필수 사이즈(2종) + 선택 초(1종) 옵션. */
  async function makeProductWithOptions(storeId: bigint): Promise<{
    product: Product;
    sizeSmallId: bigint;
    sizeLargeId: bigint;
    candleId: bigint;
  }> {
    const product = await createProduct(prisma, {
      store_id: storeId,
      regular_price: 30000,
      sale_price: 25000,
    });
    const sizeGroup = await prisma.productOptionGroup.create({
      data: {
        product_id: product.id,
        name: '사이즈',
        is_required: true,
        min_select: 1,
        max_select: 1,
      },
    });
    const sizeSmall = await prisma.productOptionItem.create({
      data: {
        option_group_id: sizeGroup.id,
        title: '도시락',
        price_delta: 2000,
      },
    });
    const sizeLarge = await prisma.productOptionItem.create({
      data: { option_group_id: sizeGroup.id, title: '1호', price_delta: 5000 },
    });
    const candleGroup = await prisma.productOptionGroup.create({
      data: {
        product_id: product.id,
        name: '디자인 초',
        is_required: false,
        min_select: 1,
        max_select: 1,
      },
    });
    const candle = await prisma.productOptionItem.create({
      data: {
        option_group_id: candleGroup.id,
        title: '곰돌이',
        price_delta: 1000,
      },
    });
    return {
      product,
      sizeSmallId: sizeSmall.id,
      sizeLargeId: sizeLarge.id,
      candleId: candle.id,
    };
  }

  async function makeBuyer(
    phone: string | null = '010-1234-5678',
    nickname?: string,
  ): Promise<Account> {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, {
      account_id: account.id,
      ...(nickname ? { nickname } : {}),
      phone_number: phone,
    });
    return account;
  }

  // 호출마다 새 키 — 한 케이스에서 createOrder를 여러 번 부를 때 의도치 않은
  // 멱등 replay로 두 번째 생성이 생략되는 것을 막는다.
  // 기대 금액 기본값은 factory 기본 상품(정가 10000·판매가 없음·옵션 없음) 기준이다.
  let idemSeq = 0;
  function baseInput(overrides: Partial<CreateOrderInput>): CreateOrderInput {
    idemSeq += 1;
    return {
      idempotencyKey: `idem-key-${idemSeq}`,
      productId: '0',
      optionItemIds: [],
      pickupAt: VALID_PICKUP_AT,
      expectedTotalPrice: 10_000 * (overrides.quantity ?? 1),
      ...overrides,
    };
  }

  describe('createOrder', () => {
    it('주문을 생성하고 가격·옵션·상태 히스토리를 스냅샷한다', async () => {
      const store = await makeOpenStore();
      const { product, sizeSmallId, candleId } = await makeProductWithOptions(
        store.id,
      );
      // 썸네일 스냅샷은 활성 첫 이미지(sort_order 순) — 뒤 순서를 먼저 만들어 정렬을 확인한다
      for (const [url, sortOrder] of [
        ['https://img/second.png', 1],
        ['https://img/first.png', 0],
      ] as const) {
        await prisma.productImage.create({
          data: {
            product_id: product.id,
            image_url: url,
            sort_order: sortOrder,
          },
        });
      }
      const buyer = await makeBuyer();

      const result = await service.createOrder(
        buyer.id,
        baseInput({
          productId: product.id.toString(),
          optionItemIds: [sizeSmallId.toString(), candleId.toString()],
          quantity: 2,
          buyerName: '차차',
          buyerPhone: '010-0000-1111',
          expectedTotalPrice: 56000,
        }),
      );

      // (25000 + 2000 + 1000) × 2
      expect(result.totalPrice).toBe(56000);
      expect(result.status).toBe('PENDING_PAYMENT');
      expect(result.pickupAt).toEqual(VALID_PICKUP_AT);
      expect(result.orderNumber).toMatch(/^ORD-20260916-[A-HJ-NP-Z2-9]{6}$/);

      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(result.orderId) },
        include: {
          items: { include: { option_items: true } },
          status_histories: true,
        },
      });
      expect(saved.status).toBe('PENDING_PAYMENT');
      expect(saved.submitted_at).toBeNull();
      expect(saved.buyer_name).toBe('차차');
      expect(saved.buyer_phone).toBe('010-0000-1111');
      expect(saved.subtotal_price).toBe(66000); // (30000+3000)×2
      expect(saved.discount_price).toBe(10000); // (30000-25000)×2
      expect(saved.total_price).toBe(56000);

      const [item] = saved.items;
      expect(item.product_name_snapshot).toBe(product.name);
      expect(item.store_name_snapshot).toBe(store.store_name);
      expect(item.product_thumbnail_url_snapshot).toBe('https://img/first.png');
      expect(item.regular_price_snapshot).toBe(30000);
      expect(item.sale_price_snapshot).toBe(25000);
      expect(item.quantity).toBe(2);
      expect(item.item_subtotal_price).toBe(56000);
      expect(
        item.option_items.map((o) => o.option_title_snapshot).sort(),
      ).toEqual(['곰돌이', '도시락']);
      expect(
        item.option_items.map((o) => o.option_price_delta_snapshot).sort(),
      ).toEqual([1000, 2000]);

      expect(saved.status_histories).toHaveLength(1);
      expect(saved.status_histories[0]).toMatchObject({
        from_status: null,
        to_status: 'PENDING_PAYMENT',
        actor_type: 'BUYER',
      });
    });

    it('선택 그룹 미선택은 허용하고 판매가 없으면 정가 기준으로 계산한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, {
        store_id: store.id,
        regular_price: 20000,
        sale_price: null,
      });
      const buyer = await makeBuyer();

      const result = await service.createOrder(
        buyer.id,
        baseInput({
          productId: product.id.toString(),
          expectedTotalPrice: 20000,
        }),
      );

      expect(result.totalPrice).toBe(20000);
      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(result.orderId) },
      });
      expect(saved.subtotal_price).toBe(20000);
      expect(saved.discount_price).toBe(0);
    });

    it.each<
      [
        string,
        { city: string | null; dong: string | null; regionName?: string },
        string | null,
      ]
    >([
      [
        '시·동이 있으면 "시 동"',
        { city: '인천', dong: '청라동' },
        '인천 청라동',
      ],
      [
        '시·동이 비어 있으면 2차 지역명',
        { city: '', dong: null, regionName: '서구' },
        '서구',
      ],
      ['주소·지역이 모두 없으면 null', { city: null, dong: null }, null],
    ])(
      '매장 지역 표기를 품목에 스냅샷한다 — %s',
      async (_case, { city, dong, regionName }, expected) => {
        const store = await makeOpenStore();
        const region = regionName
          ? await createRegion(prisma, { name: regionName, level: 2 })
          : null;
        await prisma.store.update({
          where: { id: store.id },
          data: {
            address_city: city,
            address_neighborhood: dong,
            region_id: region?.id ?? null,
          },
        });
        const product = await createProduct(prisma, { store_id: store.id });
        const buyer = await makeBuyer();

        const result = await service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString() }),
        );

        const item = await prisma.orderItem.findFirstOrThrow({
          where: { order_id: BigInt(result.orderId) },
        });
        expect(item.store_region_label_snapshot).toBe(expected);
      },
    );

    it('필수 그룹 누락·max 초과는 그룹 규칙 위반으로 거절한다', async () => {
      const store = await makeOpenStore();
      const { product, sizeSmallId, sizeLargeId } =
        await makeProductWithOptions(store.id);
      const buyer = await makeBuyer();

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString(), optionItemIds: [] }),
        ),
      ).rejects.toThrowDomain(400);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            optionItemIds: [sizeSmallId.toString(), sizeLargeId.toString()],
          }),
        ),
      ).rejects.toThrowDomain(400);
    });

    it('타 상품 옵션·중복 옵션·비활성 옵션은 거절한다', async () => {
      const store = await makeOpenStore();
      const { product, sizeSmallId } = await makeProductWithOptions(store.id);
      const other = await makeProductWithOptions(store.id);
      const buyer = await makeBuyer();

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            optionItemIds: [other.sizeSmallId.toString()],
          }),
        ),
      ).rejects.toThrowDomain(400);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            optionItemIds: [sizeSmallId.toString(), sizeSmallId.toString()],
          }),
        ),
      ).rejects.toThrowDomain(400);

      // 비활성 아이템은 활성 조회에서 빠져 '타 상품 옵션'과 동일하게 거절된다
      await prisma.productOptionItem.update({
        where: { id: sizeSmallId },
        data: { is_active: false },
      });
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            optionItemIds: [sizeSmallId.toString()],
          }),
        ),
      ).rejects.toThrowDomain(400);
    });

    it('없거나 비활성 상품·비활성 매장 상품은 NOT_FOUND다', async () => {
      const buyer = await makeBuyer();
      const inactiveStore = await createStore(prisma, { is_active: false });
      const productInInactiveStore = await createProduct(prisma, {
        store_id: inactiveStore.id,
      });
      const inactiveProduct = await createProduct(prisma, { is_active: false });

      await expect(
        service.createOrder(buyer.id, baseInput({ productId: '999999' })),
      ).rejects.toThrowDomain(404);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: inactiveProduct.id.toString() }),
        ),
      ).rejects.toThrowDomain(404);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: productInInactiveStore.id.toString() }),
        ),
      ).rejects.toThrowDomain(404);
    });

    it('주문자 정보 미입력 시 프로필로 채우고, 전화번호가 어디에도 없으면 거절한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer('010-9999-8888', '주문자닉네임');

      const result = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );
      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(result.orderId) },
      });
      expect(saved.buyer_name).toBe('주문자닉네임');
      expect(saved.buyer_phone).toBe('010-9999-8888');

      // 공백만 입력된 이름은 미입력으로 취급해 닉네임 fallback
      const whitespaceName = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString(), buyerName: '   ' }),
      );
      const savedWhitespace = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(whitespaceName.orderId) },
      });
      expect(savedWhitespace.buyer_name).toBe('주문자닉네임');

      const phonelessBuyer = await makeBuyer(null);
      await expect(
        service.createOrder(
          phonelessBuyer.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ).rejects.toThrowDomain(400);
    });

    it('휴무일·슬롯 비정렬·과거 픽업 일시는 거절한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      await prisma.storeSpecialClosure.create({
        data: {
          store_id: store.id,
          closure_date: new Date(Date.UTC(2026, 8, 19)),
        },
      });

      // 휴무일(9/19 토)
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            pickupAt: new Date('2026-09-19T05:00:00.000Z'),
          }),
        ),
      ).rejects.toThrowDomain(400);
      // 슬롯 비정렬(14:10)
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            pickupAt: new Date('2026-09-18T05:10:00.000Z'),
          }),
        ),
      ).rejects.toThrowDomain(400);
      // 과거(9/15)
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            pickupAt: new Date('2026-09-15T05:00:00.000Z'),
          }),
        ),
      ).rejects.toThrowDomain(400);
    });

    it('capacity 잔여가 주문 수량보다 작으면 거절한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 3,
      });
      // 기존 점유 2 → 잔여 1
      const existing = await createOrderRow(prisma, {
        status: 'CONFIRMED',
        pickup_at: VALID_PICKUP_AT,
      });
      await createOrderItem(prisma, {
        order_id: existing.id,
        store_id: store.id,
        quantity: 2,
      });

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString(), quantity: 2 }),
        ),
      ).rejects.toThrowDomain(400);

      const ok = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString(), quantity: 1 }),
      );
      expect(ok.status).toBe('PENDING_PAYMENT');
    });

    it('SELLER 계정·프로필 없는 계정은 주문할 수 없다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const profileless = await createAccount(prisma, { account_type: 'USER' });

      await expect(
        service.createOrder(
          seller.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ).rejects.toThrowDomain(403);
      await expect(
        service.createOrder(
          profileless.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ).rejects.toThrowDomain(401);
    });

    it('상품 제작 소요시간 이전 픽업 일시는 거절한다', async () => {
      const store = await makeOpenStore();
      // 제작 26시간 — 현재(9/16 16:00) 기준 9/17 14:00(22h)은 미달, 9/18 14:00(46h)은 충족
      const product = await createProduct(prisma, {
        store_id: store.id,
        preparation_time_minutes: 26 * 60,
      });
      const buyer = await makeBuyer();

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            pickupAt: new Date('2026-09-17T05:00:00.000Z'),
          }),
        ),
      ).rejects.toThrowDomain(400);

      const ok = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );
      expect(ok.status).toBe('PENDING_PAYMENT');
    });

    it('KRW가 아닌 통화 상품은 거절한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, {
        store_id: store.id,
        currency: 'USD',
      });
      const buyer = await makeBuyer();

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ).rejects.toThrowDomain(400);
    });

    it('32비트 초과·음수 금액은 커밋 전에 거절한다', async () => {
      const store = await makeOpenStore();
      const buyer = await makeBuyer();
      // 10억 × 3 = 30억 → GraphQL Int(2,147,483,647) 초과
      const expensive = await createProduct(prisma, {
        store_id: store.id,
        regular_price: 1_000_000_000,
      });
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: expensive.id.toString(), quantity: 3 }),
        ),
      ).rejects.toThrowDomain(400);

      // 음수 델타가 상품가를 초과 → 음수 금액
      const cheap = await createProduct(prisma, {
        store_id: store.id,
        regular_price: 20000,
      });
      const group = await prisma.productOptionGroup.create({
        data: {
          product_id: cheap.id,
          name: '할인',
          is_required: true,
          min_select: 1,
          max_select: 1,
        },
      });
      const negativeItem = await prisma.productOptionItem.create({
        data: {
          option_group_id: group.id,
          title: '과도한 할인',
          price_delta: -30000,
        },
      });
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: cheap.id.toString(),
            optionItemIds: [negativeItem.id.toString()],
          }),
        ),
      ).rejects.toThrowDomain(400);
    });

    it('반증: 복제 지연 — catalog 설정이 아직 복제되지 않았으면 제한 없이 받는다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      // 설정만 있고 order 복제본이 없는 상태(변경 이벤트 미소비)
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 1,
        replicate: false,
      });

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString(), quantity: 5 }),
        ),
      ).resolves.toMatchObject({ status: 'PENDING_PAYMENT' });
    });

    it('반증: 복제 지연 — catalog 기준으로는 이미 소진이어도 복제본이 없으면 받는다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      // catalog 설정(capacity 1)만 있고 복제본은 없다. 기존 예약 2건이라 catalog 기준으로는 이미 소진 상태
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 1,
        replicate: false,
      });
      const booked = await createOrderRow(prisma, {
        status: 'CONFIRMED',
        pickup_at: VALID_PICKUP_AT,
      });
      await createOrderItem(prisma, {
        order_id: booked.id,
        store_id: store.id,
        quantity: 2,
      });

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ).resolves.toMatchObject({ status: 'PENDING_PAYMENT' });
    });

    it('반증: 설정 삭제가 아직 복제되지 않았으면 기존 제한이 유지된다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      const capacity = await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 1,
      });
      // catalog에서만 지우고 삭제 이벤트는 아직 소비되지 않은 상태
      await prisma.storeDailyCapacity.update({
        where: { id: capacity.id },
        data: { deleted_at: new Date() },
      });

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString(), quantity: 2 }),
        ),
      ).rejects.toThrowDomain(400);
    });

    it('동시 주문이 마지막 capacity 잔여를 함께 차지하지 못한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyerA = await makeBuyer();
      const buyerB = await makeBuyer();
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 1,
      });

      // 둘 다 사전 검사는 통과하지만, 트랜잭션 내 FOR UPDATE 재검사가
      // 직렬화해 정확히 한 건만 성공해야 한다
      const results = await Promise.allSettled([
        service.createOrder(
          buyerA.id,
          baseInput({ productId: product.id.toString() }),
        ),
        service.createOrder(
          buyerB.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // 교착 등 다른 실패로 한 건이 떨어진 것이 아니다
      expect(rejected[0].reason).toMatchObject({
        code: 'PICKUP_NOT_AVAILABLE',
      });
      const createdCount = await prisma.order.count({
        where: { status: 'PENDING_PAYMENT', deleted_at: null },
      });
      expect(createdCount).toBe(1);
    });

    it('주문번호 충돌 시 새 번호로 재시도하고, 계속 충돌하면 실패한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      // random.int()=0 → 'AAAAAA'. 선점된 번호와 충돌 후 두 번째 시도는 'BBBBBB'.
      await createOrderRow(prisma, { order_number: 'ORD-20260916-AAAAAA' });

      let calls = 0;
      jest.spyOn(random, 'int').mockImplementation(() => (calls++ < 6 ? 0 : 1));
      const retried = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );
      expect(retried.orderNumber).toBe('ORD-20260916-BBBBBB');

      // 항상 같은 번호만 나오면 재시도 소진 후 실패
      jest.spyOn(random, 'int').mockReturnValue(0);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ).rejects.toThrowDomain(500);
    });

    it('같은 키 재요청은 새 주문 없이 기존 주문을 반환한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      const input = baseInput({
        idempotencyKey: 'fixed-idem-key-01',
        productId: product.id.toString(),
      });

      const first = await service.createOrder(buyer.id, input);
      const replayed = await service.createOrder(buyer.id, input);

      expect(replayed).toEqual(first);
      expect(await prisma.order.count()).toBe(1);
    });

    it('다른 계정의 같은 키는 서로 간섭하지 않는다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyerA = await makeBuyer();
      const buyerB = await makeBuyer();

      const orderA = await service.createOrder(
        buyerA.id,
        baseInput({
          idempotencyKey: 'shared-idem-key',
          productId: product.id.toString(),
        }),
      );
      const orderB = await service.createOrder(
        buyerB.id,
        baseInput({
          idempotencyKey: 'shared-idem-key',
          productId: product.id.toString(),
        }),
      );

      expect(orderB.orderId).not.toBe(orderA.orderId);
      expect(await prisma.order.count()).toBe(2);
    });

    it('soft-delete된 주문이 키를 점유하면 재시도 유도 대신 새 주문서를 안내한다', async () => {
      // MySQL unique는 deleted_at을 보지 않아 삭제된 주문도 키를 계속 점유한다.
      // 사전 조회는 활성 주문만 보므로 통과 → INSERT에서 P2002 → 같은 키로는
      // 영영 실패. 재시도를 유도하는 500 대신 409로 새 키 사용을 알린다.
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();

      const created = await service.createOrder(
        buyer.id,
        baseInput({
          idempotencyKey: 'deleted-holder-key',
          productId: product.id.toString(),
        }),
      );
      await prisma.order.update({
        where: { id: BigInt(created.orderId) },
        data: { deleted_at: new Date() },
      });

      const retry = () =>
        service.createOrder(
          buyer.id,
          baseInput({
            idempotencyKey: 'deleted-holder-key',
            productId: product.id.toString(),
          }),
        );
      // BadRequest여야 GraphQL 코드가 BAD_USER_INPUT으로 나간다 — 500(재시도
      // 유도)으로 보이면 클라이언트가 같은 키로 재시도해 같은 실패를 반복한다
      await expect(retry()).rejects.toThrowDomain(400);
      await expect(retry()).rejects.toThrowDomain(
        'IDEMPOTENCY_KEY_UNAVAILABLE',
      );

      // 새 키로는 정상 생성된다(키 단위 문제임을 확인)
      const retried = await service.createOrder(
        buyer.id,
        baseInput({
          idempotencyKey: 'fresh-key-after-delete',
          productId: product.id.toString(),
        }),
      );
      expect(retried.orderId).not.toBe(created.orderId);
    });

    it('대소문자만 다른 키는 다른 키로 취급한다(utf8mb4_bin)', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();

      const lower = await service.createOrder(
        buyer.id,
        baseInput({
          idempotencyKey: 'checkout-a',
          productId: product.id.toString(),
        }),
      );
      const upper = await service.createOrder(
        buyer.id,
        baseInput({
          idempotencyKey: 'CHECKOUT-A',
          productId: product.id.toString(),
        }),
      );

      expect(upper.orderId).not.toBe(lower.orderId);
      expect(await prisma.order.count()).toBe(2);
    });

    it('같은 키의 동시 재시도가 capacity를 채웠으면 픽업 불가 대신 replay로 응답한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 1,
      });

      const first = await service.createOrder(
        buyer.id,
        baseInput({
          idempotencyKey: 'race-idem-key',
          productId: product.id.toString(),
        }),
      );

      // 사전 조회를 통과한 뒤 첫 요청이 커밋되는 race 재현 — 첫 조회만 miss 처리
      jest
        .spyOn(orderRepo, 'findOrderByIdempotencyKey')
        .mockResolvedValueOnce(null);
      const raced = await service.createOrder(
        buyer.id,
        baseInput({
          idempotencyKey: 'race-idem-key',
          productId: product.id.toString(),
        }),
      );

      // capacity가 가득 찼지만 채운 것이 내 주문 — 실패 대신 기존 주문 반환
      expect(raced).toEqual(first);
      expect(await prisma.order.count()).toBe(1);
    });

    it('검증 실패 요청은 키를 소모하지 않아 같은 키로 재시도해 성공한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();

      // 과거 픽업 일시로 실패 — 주문 row가 안 생기므로 키도 저장되지 않는다
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            idempotencyKey: 'retry-after-fail-key',
            productId: product.id.toString(),
            pickupAt: new Date('2026-09-01T05:00:00.000Z'),
          }),
        ),
      ).rejects.toThrowDomain(400);

      const retried = await service.createOrder(
        buyer.id,
        baseInput({
          idempotencyKey: 'retry-after-fail-key',
          productId: product.id.toString(),
        }),
      );
      expect(retried.status).toBe('PENDING_PAYMENT');
      expect(await prisma.order.count()).toBe(1);
    });
  });

  describe('createOrder — 기대 금액·요청 사항', () => {
    it.each([-1, 1])(
      '기대 금액이 서버 계산과 %i원 다르면 ORDER_PRICE_CHANGED이고 키를 소모하지 않는다',
      async (diff) => {
        const store = await makeOpenStore();
        const product = await createProduct(prisma, { store_id: store.id });
        const buyer = await makeBuyer();
        const input = baseInput({
          productId: product.id.toString(),
          expectedTotalPrice: 10_000 + diff,
        });

        await expect(
          service.createOrder(buyer.id, input),
        ).rejects.toThrowDomain('ORDER_PRICE_CHANGED');
        expect(await prisma.order.count()).toBe(0);

        const ok = await service.createOrder(buyer.id, {
          ...input,
          expectedTotalPrice: 10_000,
        });
        expect(ok.totalPrice).toBe(10_000);
      },
    );

    it.each<[string, string | undefined, string | null]>([
      ['앞뒤 공백은 지운다', '  초는 빼 주세요 ', '초는 빼 주세요'],
      ['공백만 보내면 없음', '   ', null],
      ['안 보내면 없음', undefined, null],
    ])('요청 사항을 저장한다 — %s', async (_case, requestNote, expected) => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();

      const result = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString(), requestNote }),
      );

      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(result.orderId) },
      });
      expect(saved.request_note).toBe(expected);
    });
  });

  describe('createOrder — 픽업 판정이 달력과 같다', () => {
    // 9/17 10:00~19:30(30분 간격) 전 슬롯. 지금(9/16 16:00) + 제작 26시간 = 9/17 18:00이
    // 매장 리드타임(60분)보다 늦어 하한이 된다
    const DAY_SLOTS = Array.from({ length: 20 }, (_, index) => {
      const minutes = 10 * 60 + index * 30;
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      return [time, minutes >= 18 * 60] as const;
    });

    it.each(DAY_SLOTS)(
      '%s 슬롯: available=%s ⇔ createOrder 성공',
      async (time, expectedAvailable) => {
        const store = await makeOpenStore();
        const product = await createProduct(prisma, {
          store_id: store.id,
          preparation_time_minutes: 26 * 60,
        });
        const buyer = await makeBuyer();

        const slots = await pickupSchedule.pickupTimeSlots(
          store.id,
          '2026-09-17',
          product.id,
        );
        const daySlots = [...slots.morning, ...slots.afternoon];
        expect(daySlots).toHaveLength(DAY_SLOTS.length);
        const slot = daySlots.find((candidate) => candidate.time === time);
        expect(slot?.available).toBe(expectedAvailable);

        const attempt = service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            pickupAt: new Date(`2026-09-17T${time}:00+09:00`),
          }),
        );
        if (slot?.available) {
          await expect(attempt).resolves.toMatchObject({
            status: 'PENDING_PAYMENT',
          });
        } else {
          await expect(attempt).rejects.toThrowDomain('PICKUP_NOT_AVAILABLE');
        }
      },
    );
  });

  describe('createOrder — 멱등 입력 해시', () => {
    async function setup() {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      return { store, product, buyer };
    }

    it('같은 키·같은 입력이면 기존 주문을 돌려주고 해시를 저장해 둔다', async () => {
      const { product, buyer } = await setup();
      const input = baseInput({
        idempotencyKey: 'hash-same-key',
        productId: product.id.toString(),
        requestNote: '메모',
      });

      const first = await service.createOrder(buyer.id, input);
      const replayed = await service.createOrder(buyer.id, { ...input });

      expect(replayed).toEqual(first);
      expect(await prisma.order.count()).toBe(1);
      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(first.orderId) },
      });
      expect(saved.idempotency_input_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each<[string, Partial<CreateOrderInput>]>([
      ['수량', { quantity: 2, expectedTotalPrice: 20_000 }],
      ['픽업 일시', { pickupAt: new Date('2026-09-18T05:30:00.000Z') }],
      ['주문자 이름', { buyerName: '다른 이름' }],
      ['주문자 연락처', { buyerPhone: '010-9999-9999' }],
      ['입금자명', { depositorName: '다른 입금자' }],
      ['요청 사항', { requestNote: '다른 메모' }],
      ['기대 금액', { expectedTotalPrice: 9_999 }],
    ])(
      '같은 키로 %s만 달라도 IDEMPOTENCY_KEY_INPUT_MISMATCH다',
      async (_field, change) => {
        const { product, buyer } = await setup();
        const input = baseInput({
          idempotencyKey: 'hash-mismatch-key',
          productId: product.id.toString(),
        });
        await service.createOrder(buyer.id, input);

        await expect(
          service.createOrder(buyer.id, { ...input, ...change }),
        ).rejects.toThrowDomain('IDEMPOTENCY_KEY_INPUT_MISMATCH');
        expect(await prisma.order.count()).toBe(1);
      },
    );

    it('해시가 없는 기존 주문(도입 전)은 입력이 달라도 비교 없이 돌려준다', async () => {
      const { product, buyer } = await setup();
      const legacy = await createOrderRow(prisma, {
        account_id: buyer.id,
        idempotency_key: 'legacy-hashless-key',
      });

      const replayed = await service.createOrder(
        buyer.id,
        baseInput({
          idempotencyKey: 'legacy-hashless-key',
          productId: product.id.toString(),
          quantity: 5,
        }),
      );

      expect(replayed.orderId).toBe(legacy.id.toString());
      expect(await prisma.order.count()).toBe(1);
    });

    it('quantity를 생략하면 1을 보낸 것과 같은 입력이다', async () => {
      const { product, buyer } = await setup();
      const input = baseInput({
        idempotencyKey: 'hash-quantity-key',
        productId: product.id.toString(),
      });

      const first = await service.createOrder(buyer.id, {
        ...input,
        quantity: 1,
      });
      expect(input.quantity).toBeUndefined();
      await expect(service.createOrder(buyer.id, input)).resolves.toEqual(
        first,
      );
    });

    it.each([
      ['tx 밖 사전 검사', false],
      ['tx 안 잠금 재검사', true],
    ])(
      'capacity 거절 뒤 replay도 입력을 비교한다 — %s',
      async (_path, bypassPrecheck) => {
        const { store, product, buyer } = await setup();
        await createStoreDailyCapacity(prisma, {
          store_id: store.id,
          capacity_date: new Date(Date.UTC(2026, 8, 18)),
          capacity: 1,
        });
        const input = baseInput({
          idempotencyKey: 'capacity-hash-key',
          productId: product.id.toString(),
        });
        const first = await service.createOrder(buyer.id, input);

        const raceOnce = () => {
          jest
            .spyOn(orderRepo, 'findOrderByIdempotencyKey')
            .mockResolvedValueOnce(null);
          if (bypassPrecheck) {
            jest
              .spyOn(orderRepo, 'isDailyCapacityExceeded')
              .mockResolvedValueOnce(false);
          }
        };
        raceOnce();
        await expect(
          service.createOrder(buyer.id, { ...input, requestNote: '다른 메모' }),
        ).rejects.toThrowDomain('IDEMPOTENCY_KEY_INPUT_MISMATCH');
        raceOnce();
        await expect(service.createOrder(buyer.id, input)).resolves.toEqual(
          first,
        );
        expect(await prisma.order.count()).toBe(1);
      },
    );

    it('멱등 키 unique 경합(P2002) 뒤 replay도 입력을 비교한다', async () => {
      const { product, buyer } = await setup();
      const input = baseInput({
        idempotencyKey: 'p2002-hash-key',
        productId: product.id.toString(),
      });
      await service.createOrder(buyer.id, input);

      // 사전 조회를 놓친 동시 제출 — INSERT가 키 unique에 걸린 뒤 기존 주문을 다시 읽는다
      jest
        .spyOn(orderRepo, 'findOrderByIdempotencyKey')
        .mockResolvedValueOnce(null);
      const insert = jest.spyOn(orderRepo, 'createPendingPaymentOrder');
      await expect(
        service.createOrder(buyer.id, { ...input, requestNote: '다른 메모' }),
      ).rejects.toThrowDomain('IDEMPOTENCY_KEY_INPUT_MISMATCH');
      expect(insert).toHaveBeenCalledTimes(1);
      expect(await prisma.order.count()).toBe(1);
    });
  });

  describe('createOrder — 판매자 비노출', () => {
    it('판매자 새 주문 이벤트(order.submitted)도 구독 발행도 없다(입금 확인 뒤에 보인다)', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      const topic = await collectTopic(pubSub, `order.seller.${store.id}`);

      await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );

      expect(await prisma.order.count()).toBe(1);
      expect(
        await prisma.outbox.count({ where: { event_type: ORDER_SUBMITTED } }),
      ).toBe(0);
      expect(topic.received).toEqual([]);
      topic.stop();
    });
  });

  describe('createOrder — 결제(입금 안내)', () => {
    it('결제를 입금 대기로 만들고 계좌·기한(1시간)·수수료율을 주문 시점 값으로 스냅샷한다', async () => {
      await createPaymentSetting(prisma, {
        commission_rate_bps: 550,
        deposit_bank_code: '088',
        deposit_account_number: '110123456789',
        deposit_account_holder: '케이퀵 주식회사',
      });
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer('010-1234-5678', '차차');

      const result = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );

      const expiresAt = new Date(NOW.getTime() + 60 * 60_000);
      expect(result.payment).toEqual({
        method: 'BANK_TRANSFER',
        status: 'PENDING',
        amount: 10_000,
        depositorName: '차차',
        depositBank: { code: '088', name: '신한은행' },
        depositAccountNumber: '110123456789',
        depositAccountHolder: '케이퀵 주식회사',
        expiresAt,
        buyerClaimedAt: null,
        confirmedAt: null,
        confirmSource: null,
      });
      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(result.orderId) },
        include: { payment: true },
      });
      expect(saved.commission_rate_bps).toBe(550);
      expect(saved.payment).toMatchObject({
        amount: 10_000,
        expires_at: expiresAt,
      });

      // 설정이 바뀌어도 만들어진 주문의 안내·수수료율은 그대로다(replay)
      await createPaymentSetting(prisma, { commission_rate_bps: 0 });
      const input = baseInput({
        idempotencyKey: 'snapshot-key',
        productId: product.id.toString(),
      });
      const first = await service.createOrder(buyer.id, input);
      await createPaymentSetting(prisma, { deposit_bank_code: '004' });
      await expect(service.createOrder(buyer.id, input)).resolves.toEqual(
        first,
      );
    });

    it.each<[string, string | undefined, string]>([
      ['생략하면 주문자 이름', undefined, '주문자'],
      ['공백만 보내면 주문자 이름', '   ', '주문자'],
      ['입력값은 앞뒤 공백을 뗀다', ' 입금자 ', '입금자'],
      [
        '20자(코드 포인트, 이모지 포함)',
        `${'가'.repeat(18)}🎂🎂`,
        `${'가'.repeat(18)}🎂🎂`,
      ],
    ])('입금자명: %s', async (_case, depositorName, expected) => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();

      const result = await service.createOrder(
        buyer.id,
        baseInput({
          productId: product.id.toString(),
          buyerName: '주문자',
          depositorName,
        }),
      );

      expect(result.payment?.depositorName).toBe(expected);
    });

    it.each<[string, Partial<CreateOrderInput>]>([
      ['입력 21자', { depositorName: '가'.repeat(21) }],
      // 잘라 쓰면 은행 입금자명과 어긋나 오확인을 부른다
      ['생략했는데 주문자 이름이 21자', { buyerName: '가'.repeat(21) }],
    ])(
      '입금자명이 20자를 넘으면 DEPOSITOR_NAME_INVALID다 — %s',
      async (_case, change) => {
        const store = await makeOpenStore();
        const product = await createProduct(prisma, { store_id: store.id });
        const buyer = await makeBuyer();

        await expect(
          service.createOrder(
            buyer.id,
            baseInput({ productId: product.id.toString(), ...change }),
          ),
        ).rejects.toThrowDomain('DEPOSITOR_NAME_INVALID');
        expect(await prisma.order.count()).toBe(0);
      },
    );

    it.each<[string, Parameters<typeof createPaymentSetting>[1] | null]>([
      ['설정 행 없음', null],
      ['은행 없음', { deposit_bank_code: null }],
      ['계좌번호 없음', { deposit_account_number: null }],
      ['예금주 없음', { deposit_account_holder: null }],
    ])(
      '입금 계좌가 다 채워지지 않았으면 PAYMENT_ACCOUNT_NOT_CONFIGURED다 — %s',
      async (_case, overrides) => {
        if (overrides === null) {
          await prisma.paymentSetting.deleteMany();
        } else {
          await createPaymentSetting(prisma, overrides);
        }
        const store = await makeOpenStore();
        const product = await createProduct(prisma, { store_id: store.id });
        const buyer = await makeBuyer();

        await expect(
          service.createOrder(
            buyer.id,
            baseInput({ productId: product.id.toString() }),
          ),
        ).rejects.toThrowDomain('PAYMENT_ACCOUNT_NOT_CONFIGURED');
        expect(await prisma.order.count()).toBe(0);
      },
    );
  });

  describe('createOrder — 계정당 입금 대기 2건', () => {
    async function setup() {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      return { store, product, buyer };
    }

    function pendingOrder(accountId: bigint, overrides = {}) {
      return createOrderRow(prisma, {
        account_id: accountId,
        status: 'PENDING_PAYMENT',
        ...overrides,
      });
    }

    function sleep(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it('입금 대기가 1건이면 받고, 2건이면 PENDING_PAYMENT_LIMIT_EXCEEDED다', async () => {
      const { product, buyer } = await setup();
      await pendingOrder(buyer.id);

      const second = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );
      expect(second.status).toBe('PENDING_PAYMENT');

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ).rejects.toThrowDomain('PENDING_PAYMENT_LIMIT_EXCEEDED');
      expect(
        await prisma.order.count({ where: { account_id: buyer.id } }),
      ).toBe(2);
    });

    it('다른 상태·삭제된 입금 대기·다른 계정의 입금 대기는 세지 않는다', async () => {
      const { product, buyer } = await setup();
      const other = await makeBuyer();
      await pendingOrder(buyer.id, { deleted_at: NOW });
      await createOrderRow(prisma, {
        account_id: buyer.id,
        status: 'SUBMITTED',
      });
      await createOrderRow(prisma, {
        account_id: buyer.id,
        status: 'CANCELED',
      });
      await pendingOrder(other.id);
      await pendingOrder(other.id);

      for (let i = 0; i < 2; i += 1) {
        await service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString() }),
        );
      }
      expect(
        await prisma.order.count({
          where: { account_id: buyer.id, status: 'PENDING_PAYMENT' },
        }),
      ).toBe(2);
    });

    it('상한에 걸려도 같은 키 재요청은 기존 주문을 돌려준다', async () => {
      const { product, buyer } = await setup();
      await pendingOrder(buyer.id);
      const input = baseInput({
        idempotencyKey: 'limit-replay-key',
        productId: product.id.toString(),
      });
      const first = await service.createOrder(buyer.id, input);

      // 사전 조회를 놓친 재시도 — tx 안 건수 거절 뒤 내 주문을 찾아 replay한다
      jest
        .spyOn(orderRepo, 'findOrderByIdempotencyKey')
        .mockResolvedValueOnce(null);
      await expect(service.createOrder(buyer.id, input)).resolves.toEqual(
        first,
      );
      expect(await prisma.order.count()).toBe(2);
    });

    it('동시 2요청은 하나만 받는다(입금 대기 1건에서 시작)', async () => {
      const { product, buyer } = await setup();
      await pendingOrder(buyer.id);

      const results = await Promise.allSettled([
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString() }),
        ),
        service.createOrder(
          buyer.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        code: 'PENDING_PAYMENT_LIMIT_EXCEEDED',
      });
      expect(
        await prisma.order.count({ where: { status: 'PENDING_PAYMENT' } }),
      ).toBe(2);
    });

    it('앞 요청의 입금 대기 행이 커밋되기 전이면 기다렸다가 커밋된 건수로 거절한다', async () => {
      const { product, buyer } = await setup();
      await pendingOrder(buyer.id);
      let commit!: () => void;
      const gate = new Promise<void>((resolve) => (commit = resolve));
      let inserted!: () => void;
      const insertedSignal = new Promise<void>(
        (resolve) => (inserted = resolve),
      );
      // 계정 잠금 없이 같은 계정 입금 대기 행을 미커밋으로 잡아 둔다
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.order.create({
            data: {
              account_id: buyer.id,
              order_number: 'ORD-UNCOMMITTED-1',
              status: 'PENDING_PAYMENT',
              pickup_at: VALID_PICKUP_AT,
              buyer_name: '차차',
              buyer_phone: '010-0000-0000',
            },
          });
          inserted();
          await gate;
        },
        { timeout: 20_000 },
      );
      await insertedSignal;

      const attempt = service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );
      const settled = attempt.then(
        () => 'settled',
        () => 'settled',
      );
      await expect(
        Promise.race([settled, sleep(500).then(() => 'waiting')]),
      ).resolves.toBe('waiting');

      commit();
      await holder;
      await expect(attempt).rejects.toThrowDomain(
        'PENDING_PAYMENT_LIMIT_EXCEEDED',
      );
      expect(
        await prisma.order.count({ where: { account_id: buyer.id } }),
      ).toBe(2);
    });

    it('같은 계정 요청이 3초 안에 계정 잠금을 얻지 못하면 CONCURRENT_REQUEST다', async () => {
      const { product, buyer } = await setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockedSignal = new Promise<void>((resolve) => (locked = resolve));
      const name = pendingPaymentLockName(buyer.id);
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT GET_LOCK(${name}, 0)`;
          locked();
          await gate;
          await tx.$queryRaw`SELECT RELEASE_LOCK(${name})`;
        },
        { timeout: 20_000 },
      );
      await lockedSignal;

      try {
        await expect(
          service.createOrder(
            buyer.id,
            baseInput({ productId: product.id.toString() }),
          ),
        ).rejects.toThrowDomain('CONCURRENT_REQUEST');
        expect(await prisma.order.count()).toBe(0);
      } finally {
        release();
        await holder;
      }
    });

    it('다른 계정끼리는 같은 매장·날짜(capacity 잠금)로 동시에 주문해도 교착 없이 둘 다 받는다', async () => {
      const { store, product } = await setup();
      await createStoreDailyCapacity(prisma, {
        store_id: store.id,
        capacity_date: new Date(Date.UTC(2026, 8, 18)),
        capacity: 10,
      });
      const buyers = [await makeBuyer(), await makeBuyer()];

      for (let round = 0; round < 5; round += 1) {
        const results = await Promise.allSettled(
          buyers.map((buyer) =>
            service.createOrder(
              buyer.id,
              baseInput({ productId: product.id.toString() }),
            ),
          ),
        );
        expect(results.map((r) => r.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
        // 다음 라운드도 상한에 걸리지 않게 입금 대기를 비운다
        await prisma.order.updateMany({ data: { status: 'CANCELED' } });
      }
    });
  });
});
