import { RandomService } from '@/common/providers/random.service';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductHomeQueryResolver } from '@/features/product/resolvers/product-home-query.resolver';
import { ProductCardService } from '@/features/product/services/product-card.service';
import { ProductHomeService } from '@/features/product/services/product-home.service';
import { ReviewReadRepository } from '@/features/review';
import { WishlistRepository } from '@/features/review/repositories/wishlist.repository';
import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrderItem,
  createProduct,
  createReview,
  createReviewMedia,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 랭킹/배너/필터 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
describe('ProductHome Query Resolver (real DB)', () => {
  let resolver: ProductHomeQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        WishlistRepository,
        ProductCardService,
        StoreStatsRepository,
        ProductHomeQueryResolver,
        ProductHomeService,
        ProductRepository,
        ReviewReadRepository,
        RandomService,
      ],
    });
    resolver = module.get(ProductHomeQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('popularCakes: 서비스에 위임해 섹션 데이터를 반환한다', async () => {
    const store = await createStore(prisma);
    await createProduct(prisma, { store_id: store.id, name: '인기 케이크' });

    const result = await resolver.popularCakes(undefined, undefined);

    expect(result.items.map((i) => i.product.name)).toEqual(['인기 케이크']);
    expect(result.banner).toBeNull();
  });

  it('customCakeShowcase: 서비스에 위임해 제작 후기 목록을 반환한다', async () => {
    const orderItem = await createOrderItem(prisma);
    await prisma.orderItemCustomFreeEdit.create({
      data: {
        order_item_id: orderItem.id,
        crop_image_url: 'https://img/before.png',
        description_text: '요청 디자인',
      },
    });
    const review = await createReview(prisma, {
      order_item_id: orderItem.id,
      content: '제작 후기',
    });
    await createReviewMedia(prisma, {
      review_id: review.id,
      media_type: 'IMAGE',
      media_url: 'https://img/after.png',
    });

    const result = await resolver.customCakeShowcase();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      storeId: orderItem.store_id.toString(),
      reviewText: '제작 후기',
      beforeImageUrl: 'https://img/before.png',
      afterImageUrl: 'https://img/after.png',
    });
  });

  it('randomCakes: 서비스에 위임해 랜덤 그리드를 반환한다', async () => {
    const store = await createStore(prisma);
    const cake = await createProduct(prisma, { store_id: store.id });
    await prisma.productImage.create({
      data: { product_id: cake.id, image_url: 'https://img/grid.png' },
    });

    const result = await resolver.randomCakes();

    expect(result.items).toEqual([
      {
        id: cake.id.toString(),
        storeId: store.id.toString(),
        thumbnailUrl: 'https://img/grid.png',
      },
    ]);
  });
});
