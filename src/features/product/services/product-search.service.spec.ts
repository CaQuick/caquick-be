import { BadRequestException } from '@nestjs/common';
import type { PrismaClient, Product, Store } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductSearchService } from '@/features/product/services/product-search.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createCategory,
  createOrder,
  createOrderItem,
  createProduct,
  createRegion,
  createReview,
  createStore,
  createTag,
  createUserProfile,
  linkProductCategory,
  linkProductTag,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ProductSearchService (real DB)', () => {
  let service: ProductSearchService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ProductSearchService, ProductRepository, ClockService],
    });
    service = module.get(ProductSearchService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function makeCake(
    store: Store,
    name: string,
    overrides: Parameters<typeof createProduct>[1] = {},
  ): Promise<Product> {
    return createProduct(prisma, { store_id: store.id, name, ...overrides });
  }

  async function tagProduct(product: Product, tagName: string): Promise<void> {
    const tag = await createTag(prisma, { name: tagName });
    await linkProductTag(prisma, { productId: product.id, tagId: tag.id });
  }

  async function categorize(
    product: Product,
    type: 'EVENT' | 'STYLE',
    name: string,
  ): Promise<bigint> {
    const category = await createCategory(prisma, {
      category_type: type,
      name,
    });
    await linkProductCategory(prisma, {
      productId: product.id,
      categoryId: category.id,
    });
    return category.id;
  }

  async function confirmOrders(
    product: Product,
    count: number,
    quantity = 1,
  ): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const order = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
        quantity,
      });
    }
  }

  async function names(input: Parameters<typeof service.searchProducts>[0]) {
    const result = await service.searchProducts(input);
    return result.items.map((i) => i.name);
  }

  describe('searchProducts — 매칭', () => {
    it('공백 분리 단어가 상품명·태그에 모두 포함돼야 매칭된다(AND, 순서 무관)', async () => {
      const store = await createStore(prisma);
      await makeCake(store, '딸기 생크림 케이크');
      const tagged = await makeCake(store, '생크림 케이크');
      await tagProduct(tagged, '딸기');
      await makeCake(store, '딸기 타르트');
      await makeCake(store, '초코 케이크');

      expect(await names({ keyword: '딸기 케이크' })).toEqual(
        expect.arrayContaining(['딸기 생크림 케이크', '생크림 케이크']),
      );
      expect(await names({ keyword: '케이크 딸기' })).toHaveLength(2);
    });

    it('삭제된 태그·삭제된 태그 연결은 매칭에 쓰지 않는다', async () => {
      const store = await createStore(prisma);
      const deletedTag = await makeCake(store, '케이크 A');
      const tag = await createTag(prisma, {
        name: '레터링',
        deleted_at: new Date(),
      });
      await linkProductTag(prisma, { productId: deletedTag.id, tagId: tag.id });
      const deletedLink = await makeCake(store, '케이크 B');
      const liveTag = await createTag(prisma, { name: '레터링2' });
      await linkProductTag(prisma, {
        productId: deletedLink.id,
        tagId: liveTag.id,
        deleted_at: new Date(),
      });

      expect(await names({ keyword: '레터링' })).toEqual([]);
    });

    it('비활성 상품·비활성/삭제 매장 상품은 제외한다', async () => {
      const store = await createStore(prisma);
      const closed = await createStore(prisma, { is_active: false });
      const deleted = await createStore(prisma);
      await prisma.store.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });
      await makeCake(store, '케이크 활성');
      await makeCake(store, '케이크 비활성', { is_active: false });
      await makeCake(closed, '케이크 휴업');
      await makeCake(deleted, '케이크 삭제매장');

      expect(await names({ keyword: '케이크' })).toEqual(['케이크 활성']);
    });

    it('빈 검색어·길이 초과는 400', async () => {
      await expect(service.searchProducts({ keyword: '  ' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.searchProducts({ keyword: 'a'.repeat(201) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('결과가 없으면 빈 커넥션', async () => {
      expect(await service.searchProducts({ keyword: '없음' })).toEqual({
        items: [],
        totalCount: 0,
        hasMore: false,
      });
    });
  });

  describe('searchProducts — 필터', () => {
    it('상황별은 그룹 내 OR, 스타일별과는 AND로 결합한다', async () => {
      const store = await createStore(prisma);
      const birthdayFlower = await makeCake(store, '케이크 생일 꽃');
      const birthdayId = await categorize(birthdayFlower, 'EVENT', '생일');
      const flowerId = await categorize(birthdayFlower, 'STYLE', '꽃장식');
      const loverFlower = await makeCake(store, '케이크 연인 꽃');
      const loverId = await categorize(loverFlower, 'EVENT', '연인');
      await linkProductCategory(prisma, {
        productId: loverFlower.id,
        categoryId: flowerId,
      });
      const birthdayPlain = await makeCake(store, '케이크 생일 기본');
      await linkProductCategory(prisma, {
        productId: birthdayPlain.id,
        categoryId: birthdayId,
      });

      expect(
        await names({
          keyword: '케이크',
          eventCategoryIds: [birthdayId.toString(), loverId.toString()],
        }),
      ).toHaveLength(3);
      expect(
        await names({
          keyword: '케이크',
          eventCategoryIds: [birthdayId.toString()],
          styleCategoryIds: [flowerId.toString()],
        }),
      ).toEqual(['케이크 생일 꽃']);
    });

    it('삭제된 카테고리 연결·비활성 카테고리는 필터에 걸리지 않는다', async () => {
      const store = await createStore(prisma);
      const product = await makeCake(store, '케이크');
      const inactive = await createCategory(prisma, { is_active: false });
      await linkProductCategory(prisma, {
        productId: product.id,
        categoryId: inactive.id,
      });
      const live = await createCategory(prisma);
      await prisma.productCategory.create({
        data: {
          product_id: product.id,
          category_id: live.id,
          deleted_at: new Date(),
        },
      });

      expect(
        await names({
          keyword: '케이크',
          eventCategoryIds: [inactive.id.toString(), live.id.toString()],
        }),
      ).toEqual([]);
    });

    it('가격 필터는 표시가(sale ?? regular) 기준이며 min/max 단독 지정을 허용한다', async () => {
      const store = await createStore(prisma);
      await makeCake(store, '케이크 3만', { regular_price: 30000 });
      await makeCake(store, '케이크 할인 4만', {
        regular_price: 60000,
        sale_price: 40000,
      });
      await makeCake(store, '케이크 7만', { regular_price: 70000 });

      expect(
        await names({ keyword: '케이크', minPrice: 40000, maxPrice: 70000 }),
      ).toEqual(expect.arrayContaining(['케이크 할인 4만', '케이크 7만']));
      expect(await names({ keyword: '케이크', maxPrice: 30000 })).toEqual([
        '케이크 3만',
      ]);
      expect(await names({ keyword: '케이크', minPrice: 70000 })).toEqual([
        '케이크 7만',
      ]);
    });

    it('minPrice > maxPrice는 400', async () => {
      await expect(
        service.searchProducts({
          keyword: '케이크',
          minPrice: 50000,
          maxPrice: 10000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('regionIds 지정 시 해당 지역 매장 상품만', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-s' });
      const inRegion = await createStore(prisma, { region_id: region.id });
      const outRegion = await createStore(prisma);
      await makeCake(inRegion, '케이크 지역');
      await makeCake(outRegion, '케이크 타지역');

      expect(
        await names({ keyword: '케이크', regionIds: [region.id.toString()] }),
      ).toEqual(['케이크 지역']);
    });
  });

  describe('searchProducts — 정렬', () => {
    it('기본(POPULAR)은 인기 점수순', async () => {
      const store = await createStore(prisma);
      const hot = await makeCake(store, '케이크 인기');
      await makeCake(store, '케이크 보통');
      await confirmOrders(hot, 3);

      expect(await names({ keyword: '케이크' })).toEqual([
        '케이크 인기',
        '케이크 보통',
      ]);
    });

    it('LATEST는 등록 최신순', async () => {
      const store = await createStore(prisma);
      const old = await makeCake(store, '케이크 옛날');
      await prisma.product.update({
        where: { id: old.id },
        data: { created_at: new Date('2025-01-01T00:00:00.000Z') },
      });
      await makeCake(store, '케이크 최신');

      expect(await names({ keyword: '케이크', sort: 'LATEST' })).toEqual([
        '케이크 최신',
        '케이크 옛날',
      ]);
    });

    it('BEST_SELLING은 최근 30일 판매 수량 합순(주문 건수가 아니라 수량)', async () => {
      const store = await createStore(prisma);
      const manyOrders = await makeCake(store, '케이크 주문 3건');
      const bigOrder = await makeCake(store, '케이크 주문 1건 수량 10');
      await makeCake(store, '케이크 미판매');
      await confirmOrders(manyOrders, 3);
      await confirmOrders(bigOrder, 1, 10);

      expect(await names({ keyword: '케이크', sort: 'BEST_SELLING' })).toEqual([
        '케이크 주문 1건 수량 10',
        '케이크 주문 3건',
        '케이크 미판매',
      ]);
    });

    it('PRICE_ASC/PRICE_DESC는 표시가 기준', async () => {
      const store = await createStore(prisma);
      await makeCake(store, '케이크 5만', { regular_price: 50000 });
      await makeCake(store, '케이크 할인 2만', {
        regular_price: 80000,
        sale_price: 20000,
      });
      await makeCake(store, '케이크 3만', { regular_price: 30000 });

      expect(await names({ keyword: '케이크', sort: 'PRICE_ASC' })).toEqual([
        '케이크 할인 2만',
        '케이크 3만',
        '케이크 5만',
      ]);
      expect(await names({ keyword: '케이크', sort: 'PRICE_DESC' })).toEqual([
        '케이크 5만',
        '케이크 3만',
        '케이크 할인 2만',
      ]);
    });

    it('동률은 id desc로 안정 정렬한다', async () => {
      const store = await createStore(prisma);
      await makeCake(store, '케이크 먼저', { regular_price: 10000 });
      await makeCake(store, '케이크 나중', { regular_price: 10000 });

      expect(await names({ keyword: '케이크', sort: 'PRICE_ASC' })).toEqual([
        '케이크 나중',
        '케이크 먼저',
      ]);
    });
  });

  describe('searchProducts — 페이지·카드', () => {
    it('offset/limit으로 자르고 totalCount·hasMore를 계산한다', async () => {
      const store = await createStore(prisma);
      for (let i = 0; i < 5; i += 1) await makeCake(store, `케이크 ${i}`);

      const first = await service.searchProducts({
        keyword: '케이크',
        sort: 'LATEST',
        offset: 0,
        limit: 2,
      });
      const last = await service.searchProducts({
        keyword: '케이크',
        sort: 'LATEST',
        offset: 4,
        limit: 2,
      });

      expect(first.totalCount).toBe(5);
      expect(first.items).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      expect(last.items).toHaveLength(1);
      expect(last.hasMore).toBe(false);
    });

    it('카드에 매장·지역·가격·할인율·평점·리뷰수·찜 여부를 채운다', async () => {
      const store = await createStore(prisma, {
        store_name: '청라 케이크',
        address_city: '인천',
        address_neighborhood: '청라동',
      });
      const cake = await makeCake(store, '케이크', {
        regular_price: 40000,
        sale_price: 30000,
      });
      await prisma.productImage.create({
        data: { product_id: cake.id, image_url: 'https://img/1.png' },
      });
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'PICKED_UP',
      });
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        product_id: cake.id,
      });
      await createReview(prisma, { order_item_id: item.id, rating: 4.5 });
      await prisma.wishlistItem.create({
        data: { account_id: account.id, product_id: cake.id },
      });

      const asUser = await service.searchProducts(
        { keyword: '케이크' },
        account.id,
      );
      const asGuest = await service.searchProducts({ keyword: '케이크' });

      expect(asUser.items[0]).toEqual({
        id: cake.id.toString(),
        storeId: store.id.toString(),
        name: '케이크',
        thumbnailUrl: 'https://img/1.png',
        storeName: '청라 케이크',
        regionLabel: '인천 청라동',
        regularPrice: 40000,
        salePrice: 30000,
        discountRate: 25,
        ratingAverage: 4.5,
        reviewCount: 1,
        isWishlisted: true,
      });
      expect(asGuest.items[0].isWishlisted).toBe(false);
    });
  });

  describe('countProducts', () => {
    it('목록과 동일 조건(키워드+지역)으로 센다', async () => {
      const store = await createStore(prisma);
      await makeCake(store, '케이크 1');
      await makeCake(store, '케이크 2');
      await makeCake(store, '타르트');

      expect(await service.countProducts({ words: ['케이크'] })).toBe(2);
    });
  });

  describe('searchProductFacets', () => {
    it('가격 조건을 제외한 조건으로 표시가 분포·최저/최고가·건수를 낸다', async () => {
      const store = await createStore(prisma);
      await makeCake(store, '케이크 3만', { regular_price: 30000 });
      await makeCake(store, '케이크 할인 4만', {
        regular_price: 60000,
        sale_price: 40000,
      });
      await makeCake(store, '케이크 4.5만', { regular_price: 45000 });
      await makeCake(store, '케이크 8만', { regular_price: 80000 });
      await makeCake(store, '타르트', { regular_price: 1000 });

      const facets = await service.searchProductFacets({ keyword: '케이크' });

      expect(facets.totalCount).toBe(4);
      expect(facets.minPrice).toBe(30000);
      expect(facets.maxPrice).toBe(80000);
      const countAt = (min: number) =>
        facets.buckets.find((b) => b.minPrice === min)?.count;
      expect(countAt(30000)).toBe(1);
      expect(countAt(40000)).toBe(1);
      expect(countAt(45000)).toBe(1);
      expect(countAt(70000)).toBe(1);
      expect(countAt(0)).toBe(0);
    });

    it('카테고리·지역 조건을 반영하고 결과가 없으면 min/max null', async () => {
      const store = await createStore(prisma);
      const birthday = await makeCake(store, '케이크 생일', {
        regular_price: 20000,
      });
      const birthdayId = await categorize(birthday, 'EVENT', '생일');
      await makeCake(store, '케이크 기타', { regular_price: 50000 });

      const filtered = await service.searchProductFacets({
        keyword: '케이크',
        eventCategoryIds: [birthdayId.toString()],
      });
      expect(filtered.totalCount).toBe(1);
      expect(filtered.minPrice).toBe(20000);

      const empty = await service.searchProductFacets({ keyword: '없음' });
      expect(empty).toMatchObject({
        totalCount: 0,
        minPrice: null,
        maxPrice: null,
      });
      expect(empty.buckets).toHaveLength(15);
    });
  });
});
