import type { OrderStatus, PrismaClient, Product, Store } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductBestSellerService } from '@/features/product/services/product-best-seller.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ProductBestSellerService (real DB)', () => {
  let service: ProductBestSellerService;
  let prisma: PrismaClient;
  let clock: ClockService;

  const NOW = new Date('2026-08-31T13:00:00.000Z');
  const HOUR_MS = 60 * 60 * 1000;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ProductBestSellerService, ProductRepository, ClockService],
    });
    service = module.get(ProductBestSellerService);
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

  /** 상품에 주문 1건(수량 quantity)을 만든다. 기본은 CONFIRMED, 현재 시각 1시간 전. */
  async function sell(
    product: Product,
    quantity: number,
    opts: { status?: OrderStatus; hoursAgo?: number } = {},
  ): Promise<void> {
    const order = await createOrder(prisma, {
      status: opts.status ?? 'CONFIRMED',
    });
    await prisma.order.update({
      where: { id: order.id },
      data: {
        created_at: new Date(NOW.getTime() - (opts.hoursAgo ?? 1) * HOUR_MS),
      },
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
      quantity,
    });
  }

  async function makeCake(
    store: Store,
    name: string,
    overrides: Parameters<typeof createProduct>[1] = {},
  ): Promise<Product> {
    return createProduct(prisma, { store_id: store.id, name, ...overrides });
  }

  describe('realtimeBestCakes', () => {
    it('최근 24시간 판매 수량 합 desc로 정렬하고 rank를 매긴다', async () => {
      const store = await createStore(prisma);
      const a = await makeCake(store, '수량 5');
      const b = await makeCake(store, '수량 7');
      const c = await makeCake(store, '수량 2');
      await sell(a, 2);
      await sell(a, 3);
      await sell(b, 7);
      await sell(c, 2);

      const result = await service.realtimeBestCakes();

      expect(result.items.map((i) => [i.rank, i.name])).toEqual([
        [1, '수량 7'],
        [2, '수량 5'],
        [3, '수량 2'],
      ]);
      expect(result.rankedAt).toEqual(NOW);
    });

    it('판매가 0인 상품은 제외하고, 아무 판매도 없으면 빈 목록', async () => {
      const store = await createStore(prisma);
      await makeCake(store, '미판매');

      const result = await service.realtimeBestCakes();

      expect(result.items).toEqual([]);
      expect(result.rankedAt).toEqual(NOW);
    });

    it('24시간 이전 주문·취소/접수 상태 주문·삭제된 주문은 집계하지 않는다', async () => {
      const store = await createStore(prisma);
      const stale = await makeCake(store, '오래된 판매');
      const canceled = await makeCake(store, '취소');
      const submitted = await makeCake(store, '접수만');
      const fresh = await makeCake(store, '유효');
      await sell(stale, 9, { hoursAgo: 25 });
      await sell(canceled, 9, { status: 'CANCELED' });
      await sell(submitted, 9, { status: 'SUBMITTED' });
      await sell(fresh, 1, { hoursAgo: 23 });
      const deletedOrder = await createOrder(prisma, {
        status: 'CONFIRMED',
        deleted_at: NOW,
      });
      await createOrderItem(prisma, {
        order_id: deletedOrder.id,
        product_id: canceled.id,
        quantity: 9,
      });

      const result = await service.realtimeBestCakes();

      expect(result.items.map((i) => i.name)).toEqual(['유효']);
    });

    it('비활성 상품·비활성 매장 상품은 후보에서 제외한다', async () => {
      const store = await createStore(prisma);
      const inactiveStore = await createStore(prisma, { is_active: false });
      const inactive = await makeCake(store, '비활성', { is_active: false });
      const ofInactiveStore = await makeCake(inactiveStore, '비활성 매장');
      const active = await makeCake(store, '활성');
      await sell(inactive, 9);
      await sell(ofInactiveStore, 9);
      await sell(active, 1);

      const result = await service.realtimeBestCakes();

      expect(result.items.map((i) => i.name)).toEqual(['활성']);
    });

    it('수량 동률은 인기 점수(찜 수)로 푼다', async () => {
      const store = await createStore(prisma);
      const plain = await makeCake(store, '찜 없음');
      const liked = await makeCake(store, '찜 있음');
      await sell(plain, 3);
      await sell(liked, 3);
      const account = await createAccount(prisma, { account_type: 'USER' });
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: liked.id },
      });

      const result = await service.realtimeBestCakes();

      expect(result.items.map((i) => i.name)).toEqual(['찜 있음', '찜 없음']);
    });

    it('limit만큼만 반환하며 상한 20을 넘지 않는다', async () => {
      const store = await createStore(prisma);
      for (let i = 0; i < 3; i += 1) {
        await sell(await makeCake(store, `케이크 ${i}`), i + 1);
      }

      const limited = await service.realtimeBestCakes({ limit: 2 });
      expect(limited.items).toHaveLength(2);

      const clamped = await service.realtimeBestCakes({ limit: 99 });
      expect(clamped.items).toHaveLength(3);
    });

    it('카드 필드(매장명·지역·가격·할인율·대표 이미지)를 채운다', async () => {
      const store = await createStore(prisma, {
        store_name: '청라 케이크',
        address_city: '인천',
        address_neighborhood: '청라동',
      });
      const cake = await makeCake(store, '딸기', {
        regular_price: 40000,
        sale_price: 30000,
      });
      await prisma.productImage.create({
        data: { product_id: cake.id, image_url: 'https://img/1.png' },
      });
      await sell(cake, 1);

      const result = await service.realtimeBestCakes();

      expect(result.items[0]).toMatchObject({
        id: cake.id.toString(),
        storeId: store.id.toString(),
        storeName: '청라 케이크',
        regionLabel: '인천 청라동',
        regularPrice: 40000,
        salePrice: 30000,
        discountRate: 25,
        thumbnailUrl: 'https://img/1.png',
      });
    });
  });
});
