import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient, Product, Review } from '@prisma/client';

import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import { ProductReviewService } from '@/features/product/services/product-review.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createReview,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ProductReviewService (real DB)', () => {
  let service: ProductReviewService;
  let repo: ProductReviewRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ProductReviewService, ProductReviewRepository],
    });
    service = module.get(ProductReviewService);
    repo = module.get(ProductReviewRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /** 상품에 리뷰 1건 생성(작성자 프로필 포함 옵션). */
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
      await prisma.reviewMedia.create({
        data: { review_id: review.id, media_url: url, sort_order: index },
      });
    }
    return review;
  }

  /** 리뷰에 좋아요 n개 생성(각각 다른 사용자). */
  async function addLikes(reviewId: bigint, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await prisma.reviewLike.create({
        data: { review_id: reviewId, account_id: liker.id },
      });
    }
  }

  describe('productReviews', () => {
    it('잘못된 id 형식은 BadRequestException', async () => {
      await expect(
        service.productReviews({ productId: 'abc' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('최신순(id desc) 목록과 totalCount/photoTotalCount를 반환한다', async () => {
      const product = await createProduct(prisma);
      const first = await createProductReview(product);
      const second = await createProductReview(product, {
        mediaUrls: ['photo.png'],
      });

      const result = await service.productReviews({
        productId: product.id.toString(),
      });

      expect(result.items.map((r) => r.id)).toEqual([
        second.id.toString(),
        first.id.toString(),
      ]);
      expect(result.totalCount).toBe(2);
      expect(result.photoTotalCount).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('커서 페이지네이션: limit 초과 시 hasMore=true, 다음 페이지로 이어진다', async () => {
      const product = await createProduct(prisma);
      const reviews = [];
      for (let i = 0; i < 3; i += 1) {
        reviews.push(await createProductReview(product));
      }

      const page1 = await service.productReviews({
        productId: product.id.toString(),
        limit: 2,
      });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(reviews[1].id.toString());

      const page2 = await service.productReviews({
        productId: product.id.toString(),
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((r) => r.id)).toEqual([reviews[0].id.toString()]);
      expect(page2.hasMore).toBe(false);
    });

    it('photoOnly=true면 활성 미디어가 있는 리뷰만 반환한다', async () => {
      const product = await createProduct(prisma);
      await createProductReview(product);
      const withPhoto = await createProductReview(product, {
        mediaUrls: ['a.png'],
      });
      const deletedMediaReview = await createProductReview(product, {
        mediaUrls: ['b.png'],
      });
      await prisma.reviewMedia.updateMany({
        where: { review_id: deletedMediaReview.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.productReviews({
        productId: product.id.toString(),
        photoOnly: true,
      });

      expect(result.items.map((r) => r.id)).toEqual([withPhoto.id.toString()]);
      expect(result.photoTotalCount).toBe(1);
    });

    it('좋아요순 정렬: soft-delete 좋아요 제외 집계, 동률이면 최신순', async () => {
      const product = await createProduct(prisma);
      const zeroLikes = await createProductReview(product);
      const twoLikes = await createProductReview(product);
      const threeLikes = await createProductReview(product);
      await addLikes(twoLikes.id, 2);
      await addLikes(threeLikes.id, 3);
      // soft-delete된 좋아요는 집계에서 제외 → twoLikes는 2개 유지
      const canceledLiker = await createAccount(prisma, {
        account_type: 'USER',
      });
      await prisma.reviewLike.create({
        data: {
          review_id: twoLikes.id,
          account_id: canceledLiker.id,
          deleted_at: new Date(),
        },
      });

      const result = await service.productReviews({
        productId: product.id.toString(),
        sort: 'LIKES',
      });

      expect(result.items.map((r) => r.id)).toEqual([
        threeLikes.id.toString(),
        twoLikes.id.toString(),
        zeroLikes.id.toString(),
      ]);
      expect(result.items.map((r) => r.likeCount)).toEqual([3, 2, 0]);
    });

    it('좋아요순 + photoOnly 조합: 사진 리뷰만 좋아요순으로 반환한다', async () => {
      const product = await createProduct(prisma);
      const textOnlyPopular = await createProductReview(product);
      await addLikes(textOnlyPopular.id, 5);
      const photoFew = await createProductReview(product, {
        mediaUrls: ['a.png'],
      });
      await addLikes(photoFew.id, 1);
      const photoMany = await createProductReview(product, {
        mediaUrls: ['b.png'],
      });
      await addLikes(photoMany.id, 3);

      const result = await service.productReviews({
        productId: product.id.toString(),
        sort: 'LIKES',
        photoOnly: true,
      });

      // 좋아요 5개인 텍스트 리뷰는 photoOnly에서 제외된다
      expect(result.items.map((r) => r.id)).toEqual([
        photoMany.id.toString(),
        photoFew.id.toString(),
      ]);
    });

    it('좋아요순 커서: (likeCount, id) 키셋으로 다음 페이지를 이어받는다', async () => {
      const product = await createProduct(prisma);
      const reviewA = await createProductReview(product);
      const reviewB = await createProductReview(product);
      const reviewC = await createProductReview(product);
      await addLikes(reviewA.id, 2);
      await addLikes(reviewB.id, 2);
      await addLikes(reviewC.id, 1);

      // 동률(2)은 id desc → B, A 순. limit=2로 첫 페이지 [B, A]
      const page1 = await service.productReviews({
        productId: product.id.toString(),
        sort: 'LIKES',
        limit: 2,
      });
      expect(page1.items.map((r) => r.id)).toEqual([
        reviewB.id.toString(),
        reviewA.id.toString(),
      ]);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.productReviews({
        productId: product.id.toString(),
        sort: 'LIKES',
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((r) => r.id)).toEqual([reviewC.id.toString()]);
      expect(page2.hasMore).toBe(false);
    });

    it('좋아요순 커서: 경계 리뷰의 좋아요 수가 변해도 이전 페이지가 중복되지 않는다', async () => {
      const product = await createProduct(prisma);
      const reviewA = await createProductReview(product);
      const reviewB = await createProductReview(product);
      const reviewC = await createProductReview(product);
      await addLikes(reviewA.id, 2);
      await addLikes(reviewB.id, 2);
      await addLikes(reviewC.id, 1);

      // 첫 페이지 [B(2), A(2)] — 커서에 경계 시점 좋아요 수(2)가 담긴다
      const page1 = await service.productReviews({
        productId: product.id.toString(),
        sort: 'LIKES',
        limit: 2,
      });
      expect(page1.items.map((r) => r.id)).toEqual([
        reviewB.id.toString(),
        reviewA.id.toString(),
      ]);

      // 경계 리뷰 A의 좋아요가 요청 사이에 5개로 늘어도
      await addLikes(reviewA.id, 3);

      // 두 번째 페이지는 경계 시점 기준으로 이어져 B가 중복 노출되지 않는다
      const page2 = await service.productReviews({
        productId: product.id.toString(),
        sort: 'LIKES',
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((r) => r.id)).toEqual([reviewC.id.toString()]);
    });

    it('좋아요순 커서 형식이 잘못되면 BadRequestException', async () => {
      const product = await createProduct(prisma);

      await expect(
        service.productReviews({
          productId: product.id.toString(),
          sort: 'LIKES',
          cursor: '123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('좋아요순 커서 like count가 안전 정수 범위를 넘으면 BadRequestException', async () => {
      const product = await createProduct(prisma);

      // 309자리 숫자는 정규식은 통과하지만 Number 변환 시 Infinity가 된다
      await expect(
        service.productReviews({
          productId: product.id.toString(),
          sort: 'LIKES',
          cursor: `${'9'.repeat(309)}:1`,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('soft-delete 리뷰·비활성 상품 리뷰는 노출하지 않는다', async () => {
      const product = await createProduct(prisma);
      const review = await createProductReview(product);
      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.productReviews({
        productId: product.id.toString(),
      });
      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);

      const inactiveProduct = await createProduct(prisma, {
        is_active: false,
      });
      await createProductReview(inactiveProduct);
      const inactiveResult = await service.productReviews({
        productId: inactiveProduct.id.toString(),
      });
      expect(inactiveResult.items).toHaveLength(0);
      expect(inactiveResult.totalCount).toBe(0);
    });

    it('작성자·미디어·커스텀 정보·댓글 수·isLiked를 채운다', async () => {
      const product = await createProduct(prisma);
      const review = await createProductReview(product, {
        nickname: '곰돌이빵',
        profileImageUrl: 'profile.png',
        mediaUrls: ['1.png', '2.png'],
      });
      // 주문 옵션 스냅샷(커스텀 정보: 모양/크기/맛)
      const group = await prisma.productOptionGroup.create({
        data: { product_id: product.id, name: '모양' },
      });
      const item = await prisma.productOptionItem.create({
        data: { option_group_id: group.id, title: '(기본) 동그라미' },
      });
      await prisma.orderItemOptionItem.create({
        data: {
          order_item_id: review.order_item_id,
          option_group_id: group.id,
          option_item_id: item.id,
          group_name_snapshot: '모양',
          option_title_snapshot: '(기본) 동그라미',
        },
      });
      // 댓글 2건(1건은 soft-delete → 카운트 제외)
      const commenter = await createAccount(prisma, { account_type: 'USER' });
      await prisma.reviewComment.create({
        data: {
          review_id: review.id,
          account_id: commenter.id,
          content: '너무 귀여워요',
        },
      });
      await prisma.reviewComment.create({
        data: {
          review_id: review.id,
          account_id: commenter.id,
          content: '삭제된 댓글',
          deleted_at: new Date(),
        },
      });
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await prisma.reviewLike.create({
        data: { review_id: review.id, account_id: liker.id },
      });

      const result = await service.productReviews(
        { productId: product.id.toString() },
        liker.id,
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        authorNickname: '곰돌이빵',
        authorProfileImageUrl: 'profile.png',
        likeCount: 1,
        isLiked: true,
        commentCount: 1,
      });
      expect(result.items[0].media.map((m) => m.mediaUrl)).toEqual([
        '1.png',
        '2.png',
      ]);
      expect(result.items[0].customOptions).toEqual([
        { groupName: '모양', optionTitle: '(기본) 동그라미' },
      ]);
    });

    it('탈퇴(soft-delete) 작성자는 닉네임/프로필을 익명화한다', async () => {
      const product = await createProduct(prisma);
      const review = await createProductReview(product, {
        nickname: '탈퇴예정',
        profileImageUrl: 'gone.png',
      });
      await prisma.userProfile.updateMany({
        where: { account_id: review.account_id },
        data: { deleted_at: new Date() },
      });

      const result = await service.productReviews({
        productId: product.id.toString(),
      });

      expect(result.items[0].authorNickname).toBeNull();
      expect(result.items[0].authorProfileImageUrl).toBeNull();
    });
  });

  describe('reviewDetail', () => {
    it('없는 리뷰는 NotFoundException', async () => {
      await expect(service.reviewDetail('999999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('soft-delete 리뷰는 NotFoundException', async () => {
      const product = await createProduct(prisma);
      const review = await createProductReview(product);
      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: new Date() },
      });

      await expect(
        service.reviewDetail(review.id.toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
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
    it('없는 리뷰는 NotFoundException', async () => {
      await expect(
        service.reviewComments({ reviewId: '999999' }),
      ).rejects.toBeInstanceOf(NotFoundException);
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

  describe('repository 빈 입력 가드', () => {
    it('reviewIds가 비면 쿼리 없이 빈 컬렉션을 반환한다', async () => {
      await expect(repo.aggregateLikeCounts([])).resolves.toEqual(new Map());
      await expect(repo.aggregateCommentCounts([])).resolves.toEqual(new Map());
      await expect(
        repo.findLikedReviewIds({ reviewIds: [], accountId: BigInt(1) }),
      ).resolves.toEqual(new Set());
      await expect(repo.findProductReviewRowsByIds([])).resolves.toEqual([]);
    });
  });
});
