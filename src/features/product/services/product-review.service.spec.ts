import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import { ProductReviewService } from '@/features/product/services/product-review.service';
import { ReviewReadRepository } from '@/features/review';
import type { PrismaClient, Product, Review } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createReview,
  createReviewMedia,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ProductReviewService (real DB)', () => {
  let service: ProductReviewService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ProductReviewService,
        ProductReviewRepository,
        ReviewReadRepository,
      ],
    });
    service = module.get(ProductReviewService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function createProductReview(
    product: Product,
    args: {
      nickname?: string;
      profileImageUrl?: string;
      content?: string | null;
      mediaUrls?: string[];
    } = {},
  ): Promise<Review> {
    const account = await createAccount(prisma, { account_type: 'USER' });
    if (args.nickname) {
      await createUserProfile(prisma, {
        account_id: account.id,
        nickname: args.nickname,
        profile_image_url: args.profileImageUrl ?? null,
      });
    }
    const order = await createOrder(prisma, { account_id: account.id });
    const orderItem = await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
    });
    const review = await createReview(prisma, {
      order_item_id: orderItem.id,
      content: args.content,
    });
    for (const [index, url] of (args.mediaUrls ?? []).entries()) {
      await createReviewMedia(prisma, {
        review_id: review.id,
        media_url: url,
        sort_order: index,
      });
    }
    return review;
  }

  describe('reviewDetail', () => {
    it('없는 리뷰는 404', async () => {
      await expect(service.reviewDetail('999999')).rejects.toThrowDomain(404);
    });

    it('soft-delete 리뷰는 404', async () => {
      const product = await createProduct(prisma);
      const review = await createProductReview(product);
      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: new Date() },
      });

      await expect(
        service.reviewDetail(review.id.toString()),
      ).rejects.toThrowDomain(404);
    });

    it('리뷰 본문과 판매 케이크 정보(현재 상품 가격 기준)를 반환한다', async () => {
      const store = await createStore(prisma, {
        store_name: '해즈케이크',
        address_city: '인천',
        address_neighborhood: '청라동',
      });
      const product = await createProduct(prisma, {
        store_id: store.id,
        name: '그림일기 케이크',
        regular_price: 35000,
        sale_price: 33000,
      });
      await prisma.productImage.create({
        data: { product_id: product.id, image_url: 'thumb.png', sort_order: 0 },
      });
      const review = await createProductReview(product, {
        nickname: '곰돌이빵',
        content: '전체 리뷰 본문',
      });

      const result = await service.reviewDetail(review.id.toString());

      expect(result.review).toMatchObject({
        id: review.id.toString(),
        content: '전체 리뷰 본문',
        authorNickname: '곰돌이빵',
      });
      expect(result.product).toEqual({
        productId: product.id.toString(),
        name: '그림일기 케이크',
        thumbnailUrl: 'thumb.png',
        storeName: '해즈케이크',
        regionLabel: '인천 청라동',
        regularPrice: 35000,
        salePrice: 33000,
        discountRate: 6,
      });
    });

    it('address가 없으면 region명으로 regionLabel을 채운다', async () => {
      const region = await prisma.region.create({
        data: { level: 2, name: '청라동', slug: 'cheongna', sort_order: 0 },
      });
      const store = await createStore(prisma);
      // 팩토리 기본값(??)이 null override를 덮어쓰므로 직접 비운다
      await prisma.store.update({
        where: { id: store.id },
        data: {
          address_city: null,
          address_neighborhood: null,
          region_id: region.id,
        },
      });
      const product = await createProduct(prisma, { store_id: store.id });
      const review = await createProductReview(product);

      const result = await service.reviewDetail(review.id.toString());

      expect(result.product.regionLabel).toBe('청라동');
    });
  });

  describe('reviewComments', () => {
    it('없는 리뷰는 404', async () => {
      await expect(
        service.reviewComments({ reviewId: '999999' }),
      ).rejects.toThrowDomain(404);
    });

    it('등록순(id asc) + 커서 + soft-delete 제외, isMine을 채운다', async () => {
      const product = await createProduct(prisma);
      const review = await createProductReview(product);
      const me = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: me.id,
        nickname: '쫀뜩한샐러드',
      });
      const other = await createAccount(prisma, { account_type: 'USER' });

      const mine = await prisma.reviewComment.create({
        data: { review_id: review.id, account_id: me.id, content: '내 댓글' },
      });
      const others = await prisma.reviewComment.create({
        data: {
          review_id: review.id,
          account_id: other.id,
          content: '남의 댓글',
        },
      });
      await prisma.reviewComment.create({
        data: {
          review_id: review.id,
          account_id: other.id,
          content: '삭제된 댓글',
          deleted_at: new Date(),
        },
      });

      const page1 = await service.reviewComments(
        { reviewId: review.id.toString(), limit: 1 },
        me.id,
      );
      expect(page1.items.map((c) => c.id)).toEqual([mine.id.toString()]);
      expect(page1.items[0]).toMatchObject({
        content: '내 댓글',
        authorNickname: '쫀뜩한샐러드',
        isMine: true,
      });
      expect(page1.totalCount).toBe(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.reviewComments(
        { reviewId: review.id.toString(), limit: 1, cursor: page1.nextCursor! },
        me.id,
      );
      expect(page2.items.map((c) => c.id)).toEqual([others.id.toString()]);
      expect(page2.items[0].isMine).toBe(false);
      // 프로필 미생성 작성자는 닉네임 null
      expect(page2.items[0].authorNickname).toBeNull();
      expect(page2.hasMore).toBe(false);
    });

    it('비로그인 사용자는 모든 댓글이 isMine=false', async () => {
      const product = await createProduct(prisma);
      const review = await createProductReview(product);
      const commenter = await createAccount(prisma, { account_type: 'USER' });
      await prisma.reviewComment.create({
        data: {
          review_id: review.id,
          account_id: commenter.id,
          content: '댓글',
        },
      });

      const result = await service.reviewComments({
        reviewId: review.id.toString(),
      });

      expect(result.items[0].isMine).toBe(false);
    });
  });
});
