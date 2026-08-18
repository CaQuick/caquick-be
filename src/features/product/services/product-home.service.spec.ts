import type { PrismaClient, Product, Store } from '@prisma/client';

import { RandomService } from '@/common/providers/random.service';
import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductHomeService } from '@/features/product/services/product-home.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createCategory,
  createOrder,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
  createUserProfile,
  linkProductCategory,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ProductHomeService (real DB)', () => {
  let service: ProductHomeService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ProductHomeService, ProductRepository, ProductReviewRepository, RandomService],
    });
    service = module.get(ProductHomeService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /** 확정(CONFIRMED) 주문 n건을 만들어 상품의 최근 주문수를 채운다. */
  async function confirmOrders(product: Product, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const order = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
      });
    }
  }

  /** 활성 찜 n건 생성. */
  async function wishProduct(product: Product, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: product.id },
      });
    }
  }

  async function makeCake(
    store: Store,
    name: string,
    overrides: Parameters<typeof createProduct>[1] = {},
  ): Promise<Product> {
    return createProduct(prisma, {
      store_id: store.id,
      name,
      ...overrides,
    });
  }

  describe('popularCakes', () => {
    it('최근 주문수가 많은 순으로 랭킹과 rank 순번을 매긴다', async () => {
      const store = await createStore(prisma);
      const first = await makeCake(store, '1등 케이크');
      const second = await makeCake(store, '2등 케이크');
      const third = await makeCake(store, '3등 케이크');
      await confirmOrders(first, 5);
      await confirmOrders(second, 2);
      await confirmOrders(third, 1);

      const result = await service.popularCakes();

      expect(result.items.map((i) => i.name)).toEqual([
        '1등 케이크',
        '2등 케이크',
        '3등 케이크',
      ]);
      expect(result.items.map((i) => i.rank)).toEqual([1, 2, 3]);
      expect(result.rankedAt).toBeInstanceOf(Date);
    });

    it('찜 수도 점수에 반영한다(주문 동일 시 찜 많은 쪽 우선)', async () => {
      const store = await createStore(prisma);
      const liked = await makeCake(store, '찜 많은 케이크');
      await makeCake(store, '찜 없는 케이크');
      await wishProduct(liked, 3);

      const result = await service.popularCakes();

      expect(result.items[0].name).toBe('찜 많은 케이크');
    });

    it('categoryId 지정 시 해당 카테고리 상품만 랭킹 대상이다', async () => {
      const store = await createStore(prisma);
      const birthday = await createCategory(prisma, { name: '생일' });
      const inCategory = await makeCake(store, '생일 케이크');
      await makeCake(store, '무관 케이크');
      await linkProductCategory(prisma, {
        productId: inCategory.id,
        categoryId: birthday.id,
      });

      const result = await service.popularCakes({
        categoryId: birthday.id.toString(),
      });

      expect(result.items.map((i) => i.name)).toEqual(['생일 케이크']);
    });

    it('EVENT가 아닌 카테고리 id가 오면 빈 결과를 반환한다(홈 칩은 EVENT 한정)', async () => {
      const store = await createStore(prisma);
      const style = await createCategory(prisma, {
        category_type: 'STYLE',
        name: '입체',
      });
      const cake = await makeCake(store, '입체 케이크');
      await linkProductCategory(prisma, {
        productId: cake.id,
        categoryId: style.id,
      });

      const result = await service.popularCakes({
        categoryId: style.id.toString(),
      });

      expect(result.items).toEqual([]);
    });

    it('regionIds 지정 시 해당 지역 매장 상품만 랭킹 대상이다', async () => {
      const regionA = await prisma.region.create({
        data: { level: 2, name: '강남구', slug: 'test-gangnam' },
      });
      const storeIn = await createStore(prisma, { region_id: regionA.id });
      const storeOut = await createStore(prisma);
      await makeCake(storeIn, '강남 케이크');
      await makeCake(storeOut, '타지역 케이크');

      const result = await service.popularCakes({
        regionIds: [regionA.id.toString()],
      });

      expect(result.items.map((i) => i.name)).toEqual(['강남 케이크']);
    });

    it('비활성 상품과 비활성 매장 상품은 제외한다', async () => {
      const store = await createStore(prisma);
      await makeCake(store, '활성 케이크');
      await makeCake(store, '비활성 케이크', { is_active: false });
      const inactiveStore = await createStore(prisma, { is_active: false });
      await makeCake(inactiveStore, '비활성 매장 케이크');

      const result = await service.popularCakes();

      expect(result.items.map((i) => i.name)).toEqual(['활성 케이크']);
    });

    it('기본 3개, limit 지정 시 해당 수만큼 자른다', async () => {
      const store = await createStore(prisma);
      for (let i = 0; i < 5; i += 1) {
        await makeCake(store, `케이크 ${i}`);
      }

      const [byDefault, limited] = [
        await service.popularCakes(),
        await service.popularCakes({ limit: 2 }),
      ];

      expect(byDefault.items).toHaveLength(3);
      expect(limited.items).toHaveLength(2);
    });

    it('limit이 상한(3)을 넘으면 3으로 클램프한다', async () => {
      const store = await createStore(prisma);
      for (let i = 0; i < 5; i += 1) {
        await makeCake(store, `케이크 ${i}`);
      }

      // DTO(@Max)를 우회한 직접 호출에도 "최대 3개" 계약을 지킨다
      const result = await service.popularCakes({ limit: 5 });

      expect(result.items).toHaveLength(3);
    });

    it('카드에 매장명·지역명·가격·할인율·대표이미지를 매핑한다', async () => {
      const store = await createStore(prisma, {
        store_name: '청담 케이크샵',
        address_city: '서울',
        address_neighborhood: '청담동',
      });
      const cake = await makeCake(store, '레터링 케이크', {
        regular_price: 40000,
        sale_price: 30000,
      });
      await prisma.productImage.create({
        data: { product_id: cake.id, image_url: 'https://img/cake.png' },
      });

      const [item] = (await service.popularCakes()).items;

      expect(item).toMatchObject({
        name: '레터링 케이크',
        storeName: '청담 케이크샵',
        regionLabel: '서울 청담동',
        regularPrice: 40000,
        salePrice: 30000,
        discountRate: 25,
        thumbnailUrl: 'https://img/cake.png',
      });
    });

    it('상품이 없으면 빈 items를 반환한다', async () => {
      const result = await service.popularCakes();

      expect(result.items).toEqual([]);
      expect(result.banner).toBeNull();
    });
  });

  describe('popularCakes 배너 선택', () => {
    it('categoryId 지정 시 해당 카테고리의 CATEGORY 배너를 반환한다', async () => {
      const birthday = await createCategory(prisma, { name: '생일' });
      const other = await createCategory(prisma, { name: '웨딩' });
      await prisma.banner.create({
        data: {
          placement: 'CATEGORY',
          image_url: 'https://img/birthday-banner.png',
          link_type: 'CATEGORY',
          link_category_id: birthday.id,
        },
      });
      await prisma.banner.create({
        data: {
          placement: 'CATEGORY',
          image_url: 'https://img/other-banner.png',
          link_type: 'CATEGORY',
          link_category_id: other.id,
        },
      });

      const result = await service.popularCakes({
        categoryId: birthday.id.toString(),
      });

      expect(result.banner).toMatchObject({
        imageUrl: 'https://img/birthday-banner.png',
        linkType: 'CATEGORY',
        linkCategoryId: birthday.id.toString(),
      });
    });

    it('categoryId 미지정(전체 칩) 시 HOME_MAIN 배너를 반환한다', async () => {
      await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://img/main-banner.png',
          title: '메인 배너',
          link_type: 'URL',
          link_url: 'https://event.caquick.dev',
        },
      });

      const result = await service.popularCakes();

      expect(result.banner).toMatchObject({
        imageUrl: 'https://img/main-banner.png',
        title: '메인 배너',
        linkType: 'URL',
        linkUrl: 'https://event.caquick.dev',
        linkCategoryId: null,
      });
    });

    it('노출 기간을 벗어난 배너와 비활성 배너는 제외하고 없으면 null을 반환한다', async () => {
      const past = new Date(Date.now() - 60 * 60 * 1000);
      await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://img/expired.png',
          ends_at: past,
        },
      });
      await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://img/inactive.png',
          is_active: false,
        },
      });

      const result = await service.popularCakes();

      expect(result.banner).toBeNull();
    });

    it('EVENT가 아닌 카테고리의 배너는 반환하지 않는다', async () => {
      const style = await createCategory(prisma, {
        category_type: 'STYLE',
        name: '입체',
      });
      await prisma.banner.create({
        data: {
          placement: 'CATEGORY',
          image_url: 'https://img/style-banner.png',
          link_type: 'CATEGORY',
          link_category_id: style.id,
        },
      });

      const result = await service.popularCakes({
        categoryId: style.id.toString(),
      });

      expect(result.banner).toBeNull();
    });

    it('링크 대상이 비활성인 배너는 건너뛰고 다음 유효 배너를 반환한다', async () => {
      const store = await createStore(prisma);
      const deadProduct = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });
      await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://img/dead-link.png',
          link_type: 'PRODUCT',
          link_product_id: deadProduct.id,
          sort_order: 0,
        },
      });
      await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://img/alive.png',
          sort_order: 1,
        },
      });

      const result = await service.popularCakes();

      expect(result.banner?.imageUrl).toBe('https://img/alive.png');
    });

    it('동일 placement 다건이면 sort_order가 앞선 배너 1건만 반환한다', async () => {
      await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://img/second.png',
          sort_order: 1,
        },
      });
      await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://img/first.png',
          sort_order: 0,
        },
      });

      const result = await service.popularCakes();

      expect(result.banner?.imageUrl).toBe('https://img/first.png');
    });
  });

  describe('customCakeShowcase', () => {
    /**
     * Before(주문 커스텀 크롭)/After(리뷰 이미지)가 모두 있는 쇼케이스 후보 리뷰 생성.
     * storeId를 주면 해당 매장 소속으로 만든다.
     */
    async function makeShowcaseReview(args?: {
      storeId?: bigint;
      nickname?: string;
      content?: string;
      before?: boolean;
      after?: boolean;
    }): Promise<bigint> {
      const orderItem = await createOrderItem(
        prisma,
        args?.storeId !== undefined ? { store_id: args.storeId } : {},
      );
      if (args?.before !== false) {
        await prisma.orderItemCustomFreeEdit.create({
          data: {
            order_item_id: orderItem.id,
            crop_image_url: `https://img/before-${orderItem.id}.png`,
            description_text: '요청 디자인',
          },
        });
      }
      const review = await createReview(prisma, {
        order_item_id: orderItem.id,
        content: args?.content ?? '후기 본문',
      });
      if (args?.after !== false) {
        await prisma.reviewMedia.create({
          data: {
            review_id: review.id,
            media_type: 'IMAGE',
            media_url: `https://img/after-${review.id}.png`,
          },
        });
      }
      if (args?.nickname) {
        const order = await prisma.order.findUniqueOrThrow({
          where: { id: orderItem.order_id },
        });
        await createUserProfile(prisma, {
          account_id: order.account_id,
          nickname: args.nickname,
        });
      }
      return review.id;
    }

    /** 유효 좋아요 n건 생성. */
    async function likeReview(reviewId: bigint, count: number): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        const account = await createAccount(prisma, { account_type: 'USER' });
        await prisma.reviewLike.create({
          data: { review_id: reviewId, account_id: account.id },
        });
      }
    }

    it('좋아요순으로 정렬하고 rank·likeCount를 매긴다(soft-delete 좋아요 미집계)', async () => {
      const top = await makeShowcaseReview({ content: '1위 후기' });
      const second = await makeShowcaseReview({ content: '2위 후기' });
      await likeReview(top, 3);
      await likeReview(second, 1);
      // soft-delete된 좋아요는 집계에서 제외되어야 한다
      const ghost = await createAccount(prisma, { account_type: 'USER' });
      await prisma.reviewLike.create({
        data: {
          review_id: second,
          account_id: ghost.id,
          deleted_at: new Date(),
        },
      });

      const result = await service.customCakeShowcase();

      expect(result.map((i) => i.reviewText)).toEqual(['1위 후기', '2위 후기']);
      expect(result.map((i) => i.rank)).toEqual([1, 2]);
      expect(result.map((i) => i.likeCount)).toEqual([3, 1]);
    });

    it('Before(커스텀 크롭) 또는 After(리뷰 이미지)가 없는 리뷰는 제외한다', async () => {
      await makeShowcaseReview({ content: '페어 완성 후기' });
      await makeShowcaseReview({ content: 'before 없음', before: false });
      await makeShowcaseReview({ content: 'after 없음', after: false });

      const result = await service.customCakeShowcase();

      expect(result.map((i) => i.reviewText)).toEqual(['페어 완성 후기']);
    });

    it('VIDEO만 있는 리뷰는 제외하고, IMAGE가 있으면 IMAGE를 After로 쓴다', async () => {
      const review = await makeShowcaseReview({
        content: '비디오+이미지',
        after: false,
      });
      await prisma.reviewMedia.create({
        data: {
          review_id: review,
          media_type: 'VIDEO',
          media_url: 'https://img/video.mp4',
          sort_order: 0,
        },
      });
      await prisma.reviewMedia.create({
        data: {
          review_id: review,
          media_type: 'IMAGE',
          media_url: 'https://img/real-after.png',
          sort_order: 1,
        },
      });
      await makeShowcaseReview({ content: '비디오만', after: false }).then(
        (id) =>
          prisma.reviewMedia.create({
            data: {
              review_id: id,
              media_type: 'VIDEO',
              media_url: 'https://img/only-video.mp4',
            },
          }),
      );

      const result = await service.customCakeShowcase();

      expect(result.map((i) => i.reviewText)).toEqual(['비디오+이미지']);
      expect(result[0].afterImageUrl).toBe('https://img/real-after.png');
    });

    it('비활성 매장의 리뷰는 제외한다', async () => {
      const inactiveStore = await createStore(prisma, { is_active: false });
      await makeShowcaseReview({
        storeId: inactiveStore.id,
        content: '비활성 매장 후기',
      });

      await expect(service.customCakeShowcase()).resolves.toEqual([]);
    });

    it('작성자 닉네임을 매핑하고, 탈퇴 작성자는 null로 익명화한다', async () => {
      const active = await makeShowcaseReview({
        nickname: '곰돌이빵',
        content: '활성 작성자',
      });
      await likeReview(active, 1);
      const withdrawnReview = await makeShowcaseReview({
        nickname: '탈퇴자',
        content: '탈퇴 작성자',
      });
      const row = await prisma.review.findUniqueOrThrow({
        where: { id: withdrawnReview },
      });
      await prisma.userProfile.update({
        where: { account_id: row.account_id },
        data: { deleted_at: new Date() },
      });

      const result = await service.customCakeShowcase();

      expect(result.map((i) => i.authorNickname)).toEqual(['곰돌이빵', null]);
    });

    it('limit만큼 자르고, 후기가 없으면 빈 배열을 반환한다', async () => {
      await expect(service.customCakeShowcase()).resolves.toEqual([]);

      await makeShowcaseReview();
      await makeShowcaseReview();
      await makeShowcaseReview();

      const limited = await service.customCakeShowcase({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('beforeImageUrl은 sort_order가 앞선 커스텀 크롭을 사용한다', async () => {
      const review = await makeShowcaseReview({ before: false });
      const row = await prisma.review.findUniqueOrThrow({
        where: { id: review },
      });
      await prisma.orderItemCustomFreeEdit.create({
        data: {
          order_item_id: row.order_item_id,
          crop_image_url: 'https://img/second-crop.png',
          description_text: '두 번째',
          sort_order: 1,
        },
      });
      await prisma.orderItemCustomFreeEdit.create({
        data: {
          order_item_id: row.order_item_id,
          crop_image_url: 'https://img/first-crop.png',
          description_text: '첫 번째',
          sort_order: 0,
        },
      });

      const result = await service.customCakeShowcase();

      expect(result[0].beforeImageUrl).toBe('https://img/first-crop.png');
    });
  });

  describe('randomCakes', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    /** 대표 이미지가 있는 활성 케이크 n개 생성. */
    async function makeCakesWithImage(
      store: Store,
      count: number,
    ): Promise<Product[]> {
      const cakes: Product[] = [];
      for (let i = 0; i < count; i += 1) {
        const cake = await createProduct(prisma, { store_id: store.id });
        await prisma.productImage.create({
          data: {
            product_id: cake.id,
            image_url: `https://img/random-${cake.id}.png`,
          },
        });
        cakes.push(cake);
      }
      return cakes;
    }

    it('기본 9개를 중복 없이 반환하고 썸네일을 매핑한다', async () => {
      const store = await createStore(prisma);
      await makeCakesWithImage(store, 12);

      const result = await service.randomCakes();

      expect(result.items).toHaveLength(9);
      expect(new Set(result.items.map((i) => i.id)).size).toBe(9);
      for (const item of result.items) {
        expect(item.thumbnailUrl).toBe(`https://img/random-${item.id}.png`);
      }
    });

    it('categoryId 지정 시 해당 카테고리 케이크만 추출한다', async () => {
      const store = await createStore(prisma);
      const birthday = await createCategory(prisma, { name: '생일' });
      const [inCategory] = await makeCakesWithImage(store, 1);
      await makeCakesWithImage(store, 3);
      await linkProductCategory(prisma, {
        productId: inCategory.id,
        categoryId: birthday.id,
      });

      const result = await service.randomCakes({
        categoryId: birthday.id.toString(),
      });

      expect(result.items.map((i) => i.id)).toEqual([inCategory.id.toString()]);
    });

    it('EVENT가 아닌 카테고리 id가 오면 빈 결과를 반환한다(홈 칩과 동일 정책)', async () => {
      const store = await createStore(prisma);
      const style = await createCategory(prisma, {
        category_type: 'STYLE',
        name: '포토',
      });
      const [cake] = await makeCakesWithImage(store, 1);
      await linkProductCategory(prisma, {
        productId: cake.id,
        categoryId: style.id,
      });

      const result = await service.randomCakes({
        categoryId: style.id.toString(),
      });

      expect(result.items).toEqual([]);
    });

    it('이미지 없는 상품·비활성 상품·비활성 매장 상품은 후보에서 제외한다', async () => {
      const store = await createStore(prisma);
      await createProduct(prisma, { store_id: store.id }); // 이미지 없음
      const inactive = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });
      await prisma.productImage.create({
        data: { product_id: inactive.id, image_url: 'https://img/x.png' },
      });
      const inactiveStore = await createStore(prisma, { is_active: false });
      const cakeInInactiveStore = await createProduct(prisma, {
        store_id: inactiveStore.id,
      });
      await prisma.productImage.create({
        data: {
          product_id: cakeInInactiveStore.id,
          image_url: 'https://img/y.png',
        },
      });

      await expect(service.randomCakes()).resolves.toEqual({ items: [] });
    });

    it('후보가 limit보다 적으면 전량을 반환한다', async () => {
      const store = await createStore(prisma);
      await makeCakesWithImage(store, 4);

      const result = await service.randomCakes();

      expect(result.items).toHaveLength(4);
    });

    it('주입된 난수에 따라 결정적으로 추출한다', async () => {
      const store = await createStore(prisma);
      const cakes = await makeCakesWithImage(store, 5);
      const randomService = (service as unknown as { random: RandomService })
        .random;
      // random()=0이면 부분 셔플이 항등이 되어 id asc 앞에서부터 뽑힌다
      jest.spyOn(randomService, 'random').mockReturnValue(0);

      const result = await service.randomCakes({ limit: 2 });

      expect(result.items.map((i) => i.id)).toEqual([
        cakes[0].id.toString(),
        cakes[1].id.toString(),
      ]);
    });
  });
});
