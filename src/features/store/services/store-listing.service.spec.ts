import { ReviewReadRepository } from '@/features/review';
import { StoreWishlistRepository } from '@/features/review/repositories/store-wishlist.repository';
import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreCardService } from '@/features/store/services/store-card.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrder,
  createOrderItem,
  createRegion,
  createReview,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('StoreListingService (real DB)', () => {
  let service: StoreListingService;
  let repo: StoreRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreCardService,
        ReviewReadRepository,
        StoreStatsRepository,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
      ],
    });
    service = module.get(StoreListingService);
    repo = module.get(StoreRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function reviewStore(storeId: bigint, rating: number): Promise<void> {
    const orderItem = await createOrderItem(prisma, { store_id: storeId });
    await createReview(prisma, { order_item_id: orderItem.id, rating });
  }

  describe('popularStores', () => {
    it('매장이 없으면 빈 커넥션과 rankedAt을 반환한다', async () => {
      const result = await service.popularStores();

      expect(result.totalCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.rankedAt).toBeInstanceOf(Date);
    });

    it('인기순(찜 많은 매장이 상위)으로 정렬하고 rank를 부여한다', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-rank' });
      const hot = await createStore(prisma, {
        store_name: '핫',
        region_id: region.id,
      });
      const cold = await createStore(prisma, {
        store_name: '콜드',
        region_id: region.id,
      });
      for (let i = 0; i < 3; i++) {
        await createStoreWishlist(prisma, { store_id: hot.id });
      }

      const result = await service.popularStores();

      expect(result.items.map((s) => s.store.storeName)).toEqual([
        '핫',
        '콜드',
      ]);
      expect(result.items[0]).toMatchObject({
        store: { id: hot.id.toString() },
        rank: 1,
      });
      expect(result.items[1].rank).toBe(2);
      expect(cold.id.toString()).toBe(result.items[1].store.id);
    });

    it('지역 필터(regionIds)에 해당하는 시군구 매장만 반환한다', async () => {
      const r1 = await createRegion(prisma, { level: 2, slug: 'sgg-a' });
      const r2 = await createRegion(prisma, { level: 2, slug: 'sgg-b' });
      const target = await createStore(prisma, { region_id: r1.id });
      await createStore(prisma, { region_id: r2.id });

      const result = await service.popularStores({
        regionIds: [r1.id.toString()],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].store.id).toBe(target.id.toString());
    });

    it('평균 평점(소수 첫째)과 리뷰 수를 집계한다', async () => {
      const store = await createStore(prisma);
      await reviewStore(store.id, 4);
      await reviewStore(store.id, 5);

      const result = await service.popularStores();
      const item = result.items.find((s) => s.store.id === store.id.toString());

      expect(item?.store.ratingAverage).toBe(4.5);
      expect(item?.store.reviewCount).toBe(2);
    });

    it('최근 30일 유효 주문만 점수에 반영한다(오래된 주문 매장은 하위)', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-ord' });
      const recent = await createStore(prisma, {
        store_name: '최근주문',
        region_id: region.id,
      });
      const stale = await createStore(prisma, {
        store_name: '오래된주문',
        region_id: region.id,
      });

      const recentOrder = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: recentOrder.id,
        store_id: recent.id,
      });

      const staleOrder = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: staleOrder.id,
        store_id: stale.id,
      });
      await prisma.order.update({
        where: { id: staleOrder.id },
        data: { created_at: new Date(Date.now() - 40 * DAY_MS) },
      });

      const result = await service.popularStores();

      expect(result.items[0].store.storeName).toBe('최근주문');
    });

    it('soft-delete된 주문은 점수에 반영하지 않는다', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-sd' });
      const valid = await createStore(prisma, {
        store_name: '유효주문',
        region_id: region.id,
      });
      const removed = await createStore(prisma, {
        store_name: '삭제주문',
        region_id: region.id,
      });

      const validOrder = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: validOrder.id,
        store_id: valid.id,
      });

      const removedOrder = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: removedOrder.id,
        store_id: removed.id,
      });
      await prisma.order.update({
        where: { id: removedOrder.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.popularStores();

      expect(result.items[0].store.storeName).toBe('유효주문');
    });

    it('offset/limit 페이지네이션과 hasMore를 처리한다', async () => {
      for (let i = 0; i < 3; i++) {
        await createStore(prisma, { store_name: `매장${i}` });
      }

      const result = await service.popularStores({ offset: 0, limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    it('비활성 매장은 제외된다', async () => {
      await createStore(prisma, { is_active: false });

      const result = await service.popularStores();

      expect(result.totalCount).toBe(0);
    });
  });

  describe('sortStores', () => {
    async function sold(storeId: bigint, quantity: number, daysAgo = 0) {
      const order = await createOrder(prisma, { status: 'CONFIRMED' });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: storeId,
        quantity,
      });
      if (daysAgo > 0) {
        await prisma.order.update({
          where: { id: order.id },
          data: { created_at: new Date(Date.now() - daysAgo * DAY_MS) },
        });
      }
    }

    async function sortedNames(sort: Parameters<typeof service.sortStores>[1]) {
      const candidates = await repo.findActiveStoresForRanking();
      const { ordered } = await service.sortStores(
        candidates,
        sort,
        new Date(),
      );
      return ordered.map((c) => c.store_name);
    }

    it('LATEST는 등록일 최신순, 같은 등록일은 id desc로 정렬한다', async () => {
      const old = await createStore(prisma, { store_name: '오래된' });
      const tieA = await createStore(prisma, { store_name: '동률A' });
      const tieB = await createStore(prisma, { store_name: '동률B' });
      await createStore(prisma, { store_name: '최신' });
      const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS);
      await prisma.store.update({
        where: { id: old.id },
        data: { created_at: at(10) },
      });
      for (const id of [tieA.id, tieB.id]) {
        await prisma.store.update({
          where: { id },
          data: { created_at: at(5) },
        });
      }

      expect(await sortedNames('LATEST')).toEqual([
        '최신',
        '동률B',
        '동률A',
        '오래된',
      ]);
    });

    it('BEST_SELLING은 최근 30일 판매 수량 합순, 판매 0건도 뒤에 남기고 동률은 id desc', async () => {
      const few = await createStore(prisma, { store_name: '주문많고수량적음' });
      const many = await createStore(prisma, { store_name: '수량많음' });
      const stale = await createStore(prisma, { store_name: '오래된판매' });
      await createStore(prisma, { store_name: '판매없음A' });
      await createStore(prisma, { store_name: '판매없음B' });
      await sold(few.id, 1);
      await sold(few.id, 1);
      await sold(many.id, 5);
      await sold(stale.id, 10, 40);

      expect(await sortedNames('BEST_SELLING')).toEqual([
        '수량많음',
        '주문많고수량적음',
        '판매없음B',
        '판매없음A',
        '오래된판매',
      ]);
    });

    it('POPULAR는 인기 점수순이고 카드용 통계를 함께 돌려준다', async () => {
      await createStore(prisma, { store_name: '보통' });
      const hot = await createStore(prisma, { store_name: '인기' });
      await reviewStore(hot.id, 5);

      const candidates = await repo.findActiveStoresForRanking();
      const result = await service.sortStores(
        candidates,
        'POPULAR',
        new Date(),
      );

      expect(result.ordered.map((c) => c.store_name)).toEqual(['인기', '보통']);
      expect(result.stats?.get(hot.id)).toMatchObject({
        ratingAverage: 5,
        reviewCount: 1,
      });
    });

    it('LATEST·BEST_SELLING은 통계를 채우지 않는다(카드가 직접 집계)', async () => {
      await createStore(prisma);
      const candidates = await repo.findActiveStoresForRanking();

      for (const sort of ['LATEST', 'BEST_SELLING'] as const) {
        const result = await service.sortStores(candidates, sort, new Date());
        expect(result.stats).toBeUndefined();
      }
    });
  });
});
