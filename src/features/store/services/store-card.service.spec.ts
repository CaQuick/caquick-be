import { ReviewReadRepository } from '@/features/review';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import {
  StoreCardService,
  type StoreCardSource,
} from '@/features/store/services/store-card.service';
import type { PrismaClient, Store } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('StoreCardService (real DB)', () => {
  let service: StoreCardService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreCardService,
        StoreRepository,
        StoreWishlistRepository,
        ReviewReadRepository,
      ],
    });
    service = module.get(StoreCardService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  function source(store: Store): StoreCardSource {
    return {
      id: store.id,
      store_name: store.store_name,
      profile_image_url: store.profile_image_url,
      address_city: store.address_city,
      address_neighborhood: store.address_neighborhood,
      region: null,
    };
  }

  async function addProductImage(storeId: bigint, url: string): Promise<void> {
    const product = await createProduct(prisma, { store_id: storeId });
    await prisma.productImage.create({
      data: { product_id: product.id, image_url: url, sort_order: 0 },
    });
  }

  it('rows가 비면 빈 배열', async () => {
    await expect(service.buildCards([], undefined)).resolves.toEqual([]);
  });

  it('로고·지역 라벨·평점(소수 첫째 반올림)·리뷰 수를 채우고 rows 순서를 유지한다', async () => {
    const a = await createStore(prisma, {
      store_name: 'A',
      address_city: '인천',
      address_neighborhood: '청라동',
    });
    const b = await createStore(prisma, { store_name: 'B' });
    const orderItem = await createOrderItem(prisma, { store_id: a.id });
    await createReview(prisma, { order_item_id: orderItem.id, rating: 4 });
    await createReview(prisma, {
      order_item_id: (await createOrderItem(prisma, { store_id: a.id })).id,
      rating: 5,
    });

    const cards = await service.buildCards([source(b), source(a)], undefined);

    expect(cards.map((c) => c.storeName)).toEqual(['B', 'A']);
    expect(cards[1]).toMatchObject({
      id: a.id.toString(),
      profileImageUrl: a.profile_image_url,
      regionLabel: '인천 청라동',
      ratingAverage: 4.5,
      reviewCount: 2,
    });
    // 리뷰 없는 매장은 0.0 / 0건
    expect(cards[0]).toMatchObject({ ratingAverage: 0, reviewCount: 0 });
  });

  it('미리 집계된 stats가 있으면 그것을 쓴다(재집계 없음)', async () => {
    const store = await createStore(prisma);
    const stats = new Map([
      [store.id, { ratingAverage: 3.333, reviewCount: 7 }],
    ]);

    const [card] = await service.buildCards([source(store)], undefined, {
      stats,
    });

    expect(card).toMatchObject({ ratingAverage: 3.3, reviewCount: 7 });
  });

  it('찜 여부: 로그인 사용자 기준, 비로그인은 전부 false', async () => {
    const liked = await createStore(prisma);
    const other = await createStore(prisma);
    const viewer = await createAccount(prisma, { account_type: 'USER' });
    await createStoreWishlist(prisma, {
      account_id: viewer.id,
      store_id: liked.id,
    });

    const anon = await service.buildCards(
      [source(liked), source(other)],
      undefined,
    );
    expect(anon.map((c) => c.isWishlisted)).toEqual([false, false]);

    const mine = await service.buildCards(
      [source(liked), source(other)],
      viewer.id,
    );
    expect(mine.map((c) => c.isWishlisted)).toEqual([true, false]);
  });

  it('대표 케이크 이미지는 기본 최대 4장, imageLimit으로 줄일 수 있고 없으면 빈 배열', async () => {
    const store = await createStore(prisma);
    for (let i = 0; i < 5; i += 1) {
      await addProductImage(store.id, `img-${i}.png`);
    }
    const empty = await createStore(prisma);

    const [four, none] = await service.buildCards(
      [source(store), source(empty)],
      undefined,
    );
    expect(four.cakeImageUrls).toHaveLength(4);
    expect(none.cakeImageUrls).toEqual([]);

    const [three] = await service.buildCards([source(store)], undefined, {
      imageLimit: 3,
    });
    expect(three.cakeImageUrls).toHaveLength(3);
  });
});
