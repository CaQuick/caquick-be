import { ReviewReadRepository } from '@/features/review/repositories/review-read.repository';
import { ReviewListingService } from '@/features/review/services/review-listing.service';
import type {
  PrismaClient,
  Product,
  Review,
  Store,
} from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createReview,
  createReviewLike,
  createReviewMedia,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

type ScopeKind = 'product' | 'store';
const SCOPES: ScopeKind[] = ['product', 'store'];

/**
 * 상품·매장 리뷰 목록은 같은 파이프라인(id 페이지 → hydrate → 집계)을 타므로
 * 공통 동작은 두 범위를 it.each로 한 번에 고정하고, 범위별 차이만 따로 둔다.
 */
describe('ReviewListingService (real DB)', () => {
  let service: ReviewListingService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ReviewListingService, ReviewReadRepository],
    });
    service = module.get(ReviewListingService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /** 매장 1 + 그 매장의 상품 1. 두 범위가 같은 리뷰 집합을 본다. */
  async function makeTarget(): Promise<{ store: Store; product: Product }> {
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    return { store, product };
  }

  async function makeReview(
    target: { store: Store; product: Product },
    args: {
      nickname?: string;
      profileImageUrl?: string;
      content?: string | null;
      mediaUrls?: string[];
      productName?: string;
      product?: Product;
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
      store_id: target.store.id,
      product_id: (args.product ?? target.product).id,
      product_name_snapshot: args.productName ?? '케이크',
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

  async function addLikes(reviewId: bigint, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await createReviewLike(prisma, { review_id: reviewId });
    }
  }

  function list(
    kind: ScopeKind,
    target: { store: Store; product: Product },
    args: {
      photoOnly?: boolean;
      sort?: 'LATEST' | 'LIKES';
      cursor?: string;
      limit?: number;
    } = {},
    accountId?: bigint,
  ) {
    return kind === 'product'
      ? service.productReviews(
          { productId: target.product.id.toString(), ...args },
          accountId,
        )
      : service.storeReviews(
          { storeId: target.store.id.toString(), ...args },
          accountId,
        );
  }

  describe.each(SCOPES)('공통 파이프라인 — %s 범위', (kind) => {
    it('잘못된 id 형식은 INVALID_ID', async () => {
      await expect(
        kind === 'product'
          ? service.productReviews({ productId: 'abc' })
          : service.storeReviews({ storeId: 'abc' }),
      ).rejects.toThrowDomain('INVALID_ID');
    });

    it('리뷰가 없으면 빈 목록과 totalCount/photoTotalCount 0', async () => {
      const target = await makeTarget();
      const result = await list(kind, target);
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.photoTotalCount).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('최신순(id desc) + 커서 페이지네이션, totalCount/photoTotalCount', async () => {
      const target = await makeTarget();
      const r1 = await makeReview(target);
      const r2 = await makeReview(target, { mediaUrls: ['photo.png'] });
      const r3 = await makeReview(target);

      const page1 = await list(kind, target, { limit: 2 });
      expect(page1.items.map((r) => r.id)).toEqual([
        r3.id.toString(),
        r2.id.toString(),
      ]);
      expect(page1.totalCount).toBe(3);
      expect(page1.photoTotalCount).toBe(1);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(r2.id.toString());

      const page2 = await list(kind, target, {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((r) => r.id)).toEqual([r1.id.toString()]);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
    });

    it('photoOnly=true면 활성 미디어가 있는 리뷰만, 카운트는 필터와 무관', async () => {
      const target = await makeTarget();
      await makeReview(target);
      const withPhoto = await makeReview(target, { mediaUrls: ['a.png'] });
      const deletedMedia = await makeReview(target, { mediaUrls: ['b.png'] });
      await prisma.reviewMedia.updateMany({
        where: { review_id: deletedMedia.id },
        data: { deleted_at: new Date() },
      });

      const result = await list(kind, target, { photoOnly: true });

      expect(result.items.map((r) => r.id)).toEqual([withPhoto.id.toString()]);
      expect(result.totalCount).toBe(3);
      expect(result.photoTotalCount).toBe(1);
    });

    it('좋아요순 정렬: soft-delete 좋아요 제외 집계, 동률이면 최신순', async () => {
      const target = await makeTarget();
      const zeroLikes = await makeReview(target);
      const twoLikes = await makeReview(target);
      const threeLikes = await makeReview(target);
      await addLikes(twoLikes.id, 2);
      await addLikes(threeLikes.id, 3);
      await createReviewLike(prisma, {
        review_id: twoLikes.id,
        deleted_at: new Date(),
      });

      const result = await list(kind, target, { sort: 'LIKES' });

      expect(result.items.map((r) => r.id)).toEqual([
        threeLikes.id.toString(),
        twoLikes.id.toString(),
        zeroLikes.id.toString(),
      ]);
      expect(result.items.map((r) => r.likeCount)).toEqual([3, 2, 0]);
    });

    it('좋아요순 + photoOnly 조합: 사진 리뷰만 좋아요순', async () => {
      const target = await makeTarget();
      const textOnlyPopular = await makeReview(target);
      await addLikes(textOnlyPopular.id, 5);
      const photoFew = await makeReview(target, { mediaUrls: ['a.png'] });
      await addLikes(photoFew.id, 1);
      const photoMany = await makeReview(target, { mediaUrls: ['b.png'] });
      await addLikes(photoMany.id, 3);

      const result = await list(kind, target, {
        sort: 'LIKES',
        photoOnly: true,
      });

      expect(result.items.map((r) => r.id)).toEqual([
        photoMany.id.toString(),
        photoFew.id.toString(),
      ]);
    });

    it('좋아요순 커서: (likeCount, id) 키셋으로 이어받고 경계 리뷰의 좋아요 변동에도 중복되지 않는다', async () => {
      const target = await makeTarget();
      const reviewA = await makeReview(target);
      const reviewB = await makeReview(target);
      const reviewC = await makeReview(target);
      await addLikes(reviewA.id, 2);
      await addLikes(reviewB.id, 2);
      await addLikes(reviewC.id, 1);

      // 동률(2)은 id desc → B, A 순. 커서에 경계 시점 좋아요 수(2)가 담긴다
      const page1 = await list(kind, target, { sort: 'LIKES', limit: 2 });
      expect(page1.items.map((r) => r.id)).toEqual([
        reviewB.id.toString(),
        reviewA.id.toString(),
      ]);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(`2:${reviewA.id.toString()}`);

      // 경계 리뷰 A의 좋아요가 요청 사이에 5개로 늘어도 B가 중복 노출되지 않는다
      await addLikes(reviewA.id, 3);

      const page2 = await list(kind, target, {
        sort: 'LIKES',
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((r) => r.id)).toEqual([reviewC.id.toString()]);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
    });

    // 커서 반증: 형식·범위·zero 커서
    it.each([
      ['형식 불일치', 'abc', 'LIKES', 'INVALID_LIKES_CURSOR'],
      ['구분자 없음', '123', 'LIKES', 'INVALID_LIKES_CURSOR'],
      // 309자리 숫자는 정규식은 통과하지만 Number 변환 시 Infinity가 된다
      ['안전 정수 밖', `${'9'.repeat(309)}:1`, 'LIKES', 'INVALID_LIKES_CURSOR'],
      ['최신순 커서 형식 불일치', 'abc', 'LATEST', 'INVALID_CURSOR'],
    ] as const)('%s 커서(%s, %s)는 %s', async (_label, cursor, sort, code) => {
      const target = await makeTarget();
      await expect(list(kind, target, { sort, cursor })).rejects.toThrowDomain(
        code,
      );
    });

    it('cursor "0"은 페이지를 리셋하지 않고 빈 결과를 반환한다', async () => {
      const target = await makeTarget();
      await makeReview(target);

      const result = await list(kind, target, { cursor: '0' });

      expect(result.items).toEqual([]);
    });

    it('soft-delete 리뷰·비활성 매장의 리뷰는 목록·카운트에서 제외한다', async () => {
      const target = await makeTarget();
      const review = await makeReview(target);
      await prisma.review.update({
        where: { id: review.id },
        data: { deleted_at: new Date() },
      });
      expect((await list(kind, target)).totalCount).toBe(0);

      const inactiveStore = await createStore(prisma, { is_active: false });
      const inactiveTarget = {
        store: inactiveStore,
        product: await createProduct(prisma, { store_id: inactiveStore.id }),
      };
      await makeReview(inactiveTarget);
      const result = await list(kind, inactiveTarget);
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('탈퇴(soft-delete) 작성자·프로필 없음은 익명(null)', async () => {
      const target = await makeTarget();
      const noProfile = await makeReview(target);
      const withdrawn = await makeReview(target, { nickname: '탈퇴예정' });
      await prisma.userProfile.updateMany({
        where: { account_id: withdrawn.account_id },
        data: { deleted_at: new Date() },
      });

      const result = await list(kind, target);

      expect(result.items.map((r) => r.id)).toEqual([
        withdrawn.id.toString(),
        noProfile.id.toString(),
      ]);
      expect(result.items.map((r) => r.authorNickname)).toEqual([null, null]);
    });

    it('좋아요 수·isLiked(로그인 기준, 비로그인 false)·미디어를 채운다', async () => {
      const target = await makeTarget();
      const review = await makeReview(target, {
        nickname: '곰돌이빵',
        mediaUrls: ['1.png', '2.png'],
      });
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await createReviewLike(prisma, {
        review_id: review.id,
        account_id: liker.id,
      });
      await createReviewLike(prisma, { review_id: review.id });

      const anon = await list(kind, target);
      expect(anon.items[0]).toMatchObject({
        authorNickname: '곰돌이빵',
        likeCount: 2,
        isLiked: false,
      });
      expect(anon.items[0].media.map((m) => m.mediaUrl)).toEqual([
        '1.png',
        '2.png',
      ]);

      const loggedIn = await list(kind, target, {}, liker.id);
      expect(loggedIn.items[0].isLiked).toBe(true);
    });
  });

  describe('productReviews 고유', () => {
    it('프로필 이미지·커스텀 옵션·댓글 수(soft-delete 제외)를 채운다', async () => {
      const target = await makeTarget();
      const review = await makeReview(target, {
        nickname: '곰돌이빵',
        profileImageUrl: 'profile.png',
      });
      const group = await prisma.productOptionGroup.create({
        data: { product_id: target.product.id, name: '모양' },
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
      const commenter = await createAccount(prisma, { account_type: 'USER' });
      await prisma.reviewComment.create({
        data: { review_id: review.id, account_id: commenter.id, content: 'a' },
      });
      await prisma.reviewComment.create({
        data: {
          review_id: review.id,
          account_id: commenter.id,
          content: '삭제된 댓글',
          deleted_at: new Date(),
        },
      });

      const result = await service.productReviews({
        productId: target.product.id.toString(),
      });

      expect(result.items[0]).toMatchObject({
        authorProfileImageUrl: 'profile.png',
        commentCount: 1,
        customOptions: [{ groupName: '모양', optionTitle: '(기본) 동그라미' }],
      });
    });

    it('비활성 상품의 리뷰는 노출하지 않는다', async () => {
      const store = await createStore(prisma);
      const inactive = await createProduct(prisma, {
        store_id: store.id,
        is_active: false,
      });
      await makeReview({ store, product: inactive });

      const result = await service.productReviews({
        productId: inactive.id.toString(),
      });

      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('storeReviews 고유', () => {
    it('연결 상품명(주문 시점 스냅샷)·평점을 채운다', async () => {
      const target = await makeTarget();
      await makeReview(target, { productName: '레터링 케이크' });

      const result = await service.storeReviews({
        storeId: target.store.id.toString(),
      });

      expect(result.items[0]).toMatchObject({
        rating: 5,
        productName: '레터링 케이크',
      });
    });

    it('비활성 상품의 리뷰도 매장 목록에는 남는다 (D34: 상품 가시성 가드는 productReviews만)', async () => {
      const target = await makeTarget();
      const inactive = await createProduct(prisma, {
        store_id: target.store.id,
        is_active: false,
      });
      const review = await makeReview(target, { product: inactive });

      const result = await service.storeReviews({
        storeId: target.store.id.toString(),
      });

      expect(result.items.map((r) => r.id)).toEqual([review.id.toString()]);
      expect(result.totalCount).toBe(1);
    });
  });
});
