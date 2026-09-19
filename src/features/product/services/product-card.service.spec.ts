import { ProductRepository } from '@/features/product/repositories/product.repository';
import {
  ProductCardService,
  type ProductCardSource,
} from '@/features/product/services/product-card.service';
import { ReviewReadRepository } from '@/features/review';
import { WishlistRepository } from '@/features/review/repositories/wishlist.repository';
import type { PrismaClient, Product, Store } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ProductCardService (real DB)', () => {
  let service: ProductCardService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        WishlistRepository,
        ProductCardService,
        ProductRepository,
        ReviewReadRepository,
      ],
    });
    service = module.get(ProductCardService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  function source(
    product: Product,
    store: Store,
    images: string[] = [],
  ): ProductCardSource {
    return {
      id: product.id,
      store_id: store.id,
      name: product.name,
      regular_price: product.regular_price,
      sale_price: product.sale_price,
      images: images.map((image_url) => ({ image_url })),
      store: {
        store_name: store.store_name,
        address_city: store.address_city,
        address_neighborhood: store.address_neighborhood,
        region: null,
      },
    };
  }

  it('rows가 비면 빈 배열', async () => {
    await expect(service.buildCards([], undefined)).resolves.toEqual([]);
  });

  it('대표 이미지·할인율·지역 라벨·평점(소수 첫째 반올림)·리뷰 수를 채우고 rows 순서를 유지한다', async () => {
    const store = await createStore(prisma, {
      address_city: '인천',
      address_neighborhood: '청라동',
    });
    const a = await createProduct(prisma, {
      store_id: store.id,
      name: 'A',
      regular_price: 30000,
      sale_price: 24000,
    });
    const b = await createProduct(prisma, { store_id: store.id, name: 'B' });
    for (const rating of [4, 5]) {
      const orderItem = await createOrderItem(prisma, {
        store_id: store.id,
        product_id: a.id,
      });
      await createReview(prisma, { order_item_id: orderItem.id, rating });
    }

    const cards = await service.buildCards(
      [source(b, store), source(a, store, ['1.png', '2.png'])],
      undefined,
    );

    expect(cards.map((c) => c.name)).toEqual(['B', 'A']);
    expect(cards[1]).toMatchObject({
      id: a.id.toString(),
      storeId: store.id.toString(),
      thumbnailUrl: '1.png',
      regularPrice: 30000,
      salePrice: 24000,
      discountRate: 20,
      storeName: store.store_name,
      regionLabel: '인천 청라동',
      ratingAverage: 4.5,
      reviewCount: 2,
    });
    // 리뷰·이미지·할인 없는 상품
    expect(cards[0]).toMatchObject({
      thumbnailUrl: null,
      discountRate: 0,
      ratingAverage: 0,
      reviewCount: 0,
    });
  });

  it('미리 집계된 stats가 있으면 그것을 쓴다(재집계 없음)', async () => {
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    const stats = new Map([[product.id, { average: 3.333, count: 7 }]]);

    const [card] = await service.buildCards(
      [source(product, store)],
      undefined,
      { stats },
    );

    expect(card).toMatchObject({ ratingAverage: 3.3, reviewCount: 7 });
  });

  it('찜 여부: 로그인 사용자 기준, 비로그인은 전부 false', async () => {
    const store = await createStore(prisma);
    const liked = await createProduct(prisma, { store_id: store.id });
    const other = await createProduct(prisma, { store_id: store.id });
    const viewer = await createAccount(prisma, { account_type: 'USER' });
    await prisma.wishlistItem.create({
      data: { account_id: viewer.id, product_id: liked.id },
    });

    const rows = [source(liked, store), source(other, store)];
    const anon = await service.buildCards(rows, undefined);
    expect(anon.map((c) => c.isWishlisted)).toEqual([false, false]);

    const mine = await service.buildCards(rows, viewer.id);
    expect(mine.map((c) => c.isWishlisted)).toEqual([true, false]);
  });
});
