import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Account, PrismaClient, Product, Store } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { RandomService } from '@/common/providers/random.service';
import type { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { OrderCheckoutService } from '@/features/order/services/order-checkout.service';
import { ProductRepository } from '@/features/product';
import { StorePickupScheduleService } from '@/features/store';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder as createOrderRow,
  createOrderItem,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-09-16(수) 16:00 KST 고정
const NOW = new Date('2026-09-16T07:00:00.000Z');
/** 2026-09-18(금) 14:00 KST — 기본 유효 픽업 일시. */
const VALID_PICKUP_AT = new Date('2026-09-18T05:00:00.000Z');

describe('OrderCheckoutService (real DB)', () => {
  let service: OrderCheckoutService;
  let clock: ClockService;
  let random: RandomService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OrderCheckoutService,
        OrderRepository,
        ProductRepository,
        StorePickupScheduleService,
        StoreRepository,
        ClockService,
        RandomService,
      ],
    });
    service = module.get(OrderCheckoutService);
    clock = module.get(ClockService);
    random = module.get(RandomService);
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

  function baseInput(overrides: Partial<CreateOrderInput>): CreateOrderInput {
    return {
      productId: '0',
      optionItemIds: [],
      pickupAt: VALID_PICKUP_AT,
      ...overrides,
    };
  }

  describe('createOrder', () => {
    it('주문을 생성하고 가격·옵션·상태 히스토리를 스냅샷한다', async () => {
      const store = await makeOpenStore();
      const { product, sizeSmallId, candleId } = await makeProductWithOptions(
        store.id,
      );
      const buyer = await makeBuyer();

      const result = await service.createOrder(
        buyer.id,
        baseInput({
          productId: product.id.toString(),
          optionItemIds: [sizeSmallId.toString(), candleId.toString()],
          quantity: 2,
          buyerName: '차차',
          buyerPhone: '010-0000-1111',
        }),
      );

      // (25000 + 2000 + 1000) × 2
      expect(result.totalPrice).toBe(56000);
      expect(result.status).toBe('SUBMITTED');
      expect(result.pickupAt).toEqual(VALID_PICKUP_AT);
      expect(result.orderNumber).toMatch(/^ORD-20260916-[A-HJ-NP-Z2-9]{6}$/);

      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(result.orderId) },
        include: {
          items: { include: { option_items: true } },
          status_histories: true,
        },
      });
      expect(saved.status).toBe('SUBMITTED');
      expect(saved.submitted_at).toEqual(NOW);
      expect(saved.buyer_name).toBe('차차');
      expect(saved.buyer_phone).toBe('010-0000-1111');
      expect(saved.subtotal_price).toBe(66000); // (30000+3000)×2
      expect(saved.discount_price).toBe(10000); // (30000-25000)×2
      expect(saved.total_price).toBe(56000);

      const [item] = saved.items;
      expect(item.product_name_snapshot).toBe(product.name);
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
        to_status: 'SUBMITTED',
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
        baseInput({ productId: product.id.toString() }),
      );

      expect(result.totalPrice).toBe(20000);
      const saved = await prisma.order.findUniqueOrThrow({
        where: { id: BigInt(result.orderId) },
      });
      expect(saved.subtotal_price).toBe(20000);
      expect(saved.discount_price).toBe(0);
    });

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
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            optionItemIds: [sizeSmallId.toString(), sizeLargeId.toString()],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
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
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            optionItemIds: [sizeSmallId.toString(), sizeSmallId.toString()],
          }),
        ),
      ).rejects.toThrow(BadRequestException);

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
      ).rejects.toThrow(BadRequestException);
    });

    it('설명/이미지 필수 옵션 선택은 커스텀 확장 전까지 거절한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const group = await prisma.productOptionGroup.create({
        data: {
          product_id: product.id,
          name: '레터링',
          is_required: false,
          min_select: 1,
          max_select: 1,
          option_requires_description: true,
        },
      });
      const item = await prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: '문구 입력', price_delta: 0 },
      });
      const buyer = await makeBuyer();

      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            optionItemIds: [item.id.toString()],
          }),
        ),
      ).rejects.toThrow(BadRequestException);

      // 해당 그룹을 선택하지 않으면 주문 가능(선택 그룹이므로)
      const ok = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );
      expect(ok.status).toBe('SUBMITTED');
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
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: inactiveProduct.id.toString() }),
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({ productId: productInInactiveStore.id.toString() }),
        ),
      ).rejects.toThrow(NotFoundException);
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
      ).rejects.toThrow(BadRequestException);
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
      ).rejects.toThrow(BadRequestException);
      // 슬롯 비정렬(14:10)
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            pickupAt: new Date('2026-09-18T05:10:00.000Z'),
          }),
        ),
      ).rejects.toThrow(BadRequestException);
      // 과거(9/15)
      await expect(
        service.createOrder(
          buyer.id,
          baseInput({
            productId: product.id.toString(),
            pickupAt: new Date('2026-09-15T05:00:00.000Z'),
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('capacity 잔여가 주문 수량보다 작으면 거절한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyer = await makeBuyer();
      await prisma.storeDailyCapacity.create({
        data: {
          store_id: store.id,
          capacity_date: new Date(Date.UTC(2026, 8, 18)),
          capacity: 3,
        },
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
      ).rejects.toThrow(BadRequestException);

      const ok = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString(), quantity: 1 }),
      );
      expect(ok.status).toBe('SUBMITTED');
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
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.createOrder(
          profileless.id,
          baseInput({ productId: product.id.toString() }),
        ),
      ).rejects.toThrow(UnauthorizedException);
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
      ).rejects.toThrow(BadRequestException);

      const ok = await service.createOrder(
        buyer.id,
        baseInput({ productId: product.id.toString() }),
      );
      expect(ok.status).toBe('SUBMITTED');
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
      ).rejects.toThrow(BadRequestException);
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
      ).rejects.toThrow(BadRequestException);

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
      ).rejects.toThrow(BadRequestException);
    });

    it('동시 주문이 마지막 capacity 잔여를 함께 차지하지 못한다', async () => {
      const store = await makeOpenStore();
      const product = await createProduct(prisma, { store_id: store.id });
      const buyerA = await makeBuyer();
      const buyerB = await makeBuyer();
      await prisma.storeDailyCapacity.create({
        data: {
          store_id: store.id,
          capacity_date: new Date(Date.UTC(2026, 8, 18)),
          capacity: 1,
        },
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
      const submittedCount = await prisma.order.count({
        where: { status: 'SUBMITTED', deleted_at: null },
      });
      expect(submittedCount).toBe(1);
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
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
