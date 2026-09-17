import { ReviewReadRepository } from '@/features/review/repositories/review-read.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrderItem,
  createProduct,
  createReview,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// repository에서만 도달 가능한 계약: 빈 id 배열 가드, 키별 통계 그룹핑, 전역 평균의 null 정책.
describe('ReviewReadRepository (real DB)', () => {
  let repo: ReviewReadRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ReviewReadRepository],
    });
    repo = module.get(ReviewReadRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('reviewIds가 비면 쿼리 없이 빈 컬렉션을 반환한다', async () => {
    await expect(repo.aggregateLikeCounts([])).resolves.toEqual(new Map());
    await expect(repo.aggregateCommentCounts([])).resolves.toEqual(new Map());
    await expect(
      repo.findLikedReviewIds({ reviewIds: [], accountId: BigInt(1) }),
    ).resolves.toEqual(new Set());
    await expect(repo.findReviewRowsByIds([])).resolves.toEqual([]);
    await expect(repo.findShowcaseReviewRowsByIds([])).resolves.toEqual([]);
    await expect(repo.aggregateReviewStats('product_id', [])).resolves.toEqual(
      new Map(),
    );
  });

  describe('aggregateReviewStats / globalReviewAverage', () => {
    async function review(storeId: bigint, productId: bigint, rating: number) {
      const orderItem = await createOrderItem(prisma, {
        store_id: storeId,
        product_id: productId,
      });
      return createReview(prisma, { order_item_id: orderItem.id, rating });
    }

    it('키별(store_id / product_id)로 평균·건수를 집계하고 Decimal은 number로 준다', async () => {
      const store = await createStore(prisma);
      const p1 = await createProduct(prisma, { store_id: store.id });
      const p2 = await createProduct(prisma, { store_id: store.id });
      await review(store.id, p1.id, 5);
      await review(store.id, p1.id, 4);
      await review(store.id, p2.id, 3);

      const byProduct = await repo.aggregateReviewStats('product_id', [
        p1.id,
        p2.id,
      ]);
      expect(byProduct.get(p1.id)).toEqual({ average: 4.5, count: 2 });
      expect(byProduct.get(p2.id)).toEqual({ average: 3, count: 1 });
      expect(typeof byProduct.get(p1.id)?.average).toBe('number');

      const byStore = await repo.aggregateReviewStats('store_id', [store.id]);
      expect(byStore.get(store.id)).toEqual({ average: 4, count: 3 });
    });

    it('리뷰가 없는 키는 Map에 없고(호출부가 0 처리), soft-delete 리뷰는 제외한다', async () => {
      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      const deleted = await review(store.id, product.id, 1);
      await prisma.review.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });

      const stats = await repo.aggregateReviewStats('product_id', [product.id]);
      expect(stats.has(product.id)).toBe(false);
    });

    it('전역 평균: 리뷰가 없으면 null, 있으면 활성 리뷰 평균', async () => {
      await expect(repo.globalReviewAverage()).resolves.toBeNull();

      const store = await createStore(prisma);
      const product = await createProduct(prisma, { store_id: store.id });
      await review(store.id, product.id, 5);
      await review(store.id, product.id, 2);

      await expect(repo.globalReviewAverage()).resolves.toBe(3.5);
    });
  });
});
