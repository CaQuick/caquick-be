import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { StoreReviewRepository } from '@/features/store/repositories/store-review.repository';
import { StoreReviewService } from '@/features/store/services/store-review.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createReview,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('StoreReviewService (real DB)', () => {
  let service: StoreReviewService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [StoreReviewService, StoreReviewRepository],
    });
    service = module.get(StoreReviewService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function makeReview(
    storeId: bigint,
    opts: { rating?: number; nickname?: string; productName?: string } = {},
  ) {
    const account = await createAccount(prisma, { account_type: 'USER' });
    if (opts.nickname !== undefined) {
      await prisma.userProfile.create({
        data: { account_id: account.id, nickname: opts.nickname },
      });
    }
    const order = await createOrder(prisma, { account_id: account.id });
    const orderItem = await createOrderItem(prisma, {
      order_id: order.id,
      store_id: storeId,
      product_name_snapshot: opts.productName ?? '케이크',
    });
    return createReview(prisma, {
      order_item_id: orderItem.id,
      rating: opts.rating ?? 5,
    });
  }

  async function addLikes(reviewId: bigint, count: number) {
    for (let i = 0; i < count; i += 1) {
      const liker = await createAccount(prisma, { account_type: 'USER' });
      await prisma.reviewLike.create({
        data: { review_id: reviewId, account_id: liker.id },
      });
    }
  }

  async function addMedia(reviewId: bigint) {
    await prisma.reviewMedia.create({
      data: {
        review_id: reviewId,
        media_type: 'IMAGE',
        media_url: 'a.png',
        sort_order: 0,
      },
    });
  }

  it('리뷰가 없으면 빈 목록과 totalCount/photoTotalCount 0', async () => {
    const store = await createStore(prisma);
    const result = await service.storeReviews({ storeId: store.id.toString() });
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.photoTotalCount).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('작성자 닉네임·연결 상품명·평점·미디어를 반환한다', async () => {
    const store = await createStore(prisma);
    const review = await makeReview(store.id, {
      rating: 4,
      nickname: '구매자1',
      productName: '레터링 케이크',
    });
    await prisma.reviewMedia.create({
      data: {
        review_id: review.id,
        media_type: 'IMAGE',
        media_url: 'a.png',
        thumbnail_url: 't.png',
        sort_order: 0,
      },
    });

    const result = await service.storeReviews({ storeId: store.id.toString() });

    expect(result.totalCount).toBe(1);
    expect(result.photoTotalCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      rating: 4,
      authorNickname: '구매자1',
      productName: '레터링 케이크',
    });
    expect(result.items[0].media).toEqual([
      {
        mediaType: 'IMAGE',
        mediaUrl: 'a.png',
        thumbnailUrl: 't.png',
        sortOrder: 0,
      },
    ]);
  });

  it('user_profile이 없으면 authorNickname은 null', async () => {
    const store = await createStore(prisma);
    await makeReview(store.id, {});
    const result = await service.storeReviews({ storeId: store.id.toString() });
    expect(result.items[0].authorNickname).toBeNull();
  });

  it('좋아요 수를 집계하고 isLiked는 로그인 사용자 기준(비로그인 false)', async () => {
    const store = await createStore(prisma);
    const review = await makeReview(store.id, {});
    const liker1 = await createAccount(prisma, { account_type: 'USER' });
    const liker2 = await createAccount(prisma, { account_type: 'USER' });
    await prisma.reviewLike.create({
      data: { review_id: review.id, account_id: liker1.id },
    });
    await prisma.reviewLike.create({
      data: { review_id: review.id, account_id: liker2.id },
    });

    const anon = await service.storeReviews({ storeId: store.id.toString() });
    expect(anon.items[0].likeCount).toBe(2);
    expect(anon.items[0].isLiked).toBe(false);

    const loggedIn = await service.storeReviews(
      { storeId: store.id.toString() },
      liker1.id,
    );
    expect(loggedIn.items[0].isLiked).toBe(true);
  });

  it('photoOnly=true면 활성 미디어가 있는 리뷰만 반환한다', async () => {
    const store = await createStore(prisma);
    await makeReview(store.id, {});
    const photoReview = await makeReview(store.id, {});
    await prisma.reviewMedia.create({
      data: {
        review_id: photoReview.id,
        media_type: 'IMAGE',
        media_url: 'a.png',
        sort_order: 0,
      },
    });

    const result = await service.storeReviews({
      storeId: store.id.toString(),
      photoOnly: true,
    });

    expect(result.items.map((r) => r.id)).toEqual([photoReview.id.toString()]);
    // totalCount는 필터와 무관한 전체 리뷰 수, photoTotalCount는 사진 리뷰 수
    expect(result.totalCount).toBe(2);
    expect(result.photoTotalCount).toBe(1);
  });

  it('soft-delete된 미디어만 있는 리뷰는 사진후기로 치지 않는다', async () => {
    const store = await createStore(prisma);
    const review = await makeReview(store.id, {});
    await prisma.reviewMedia.create({
      data: {
        review_id: review.id,
        media_type: 'IMAGE',
        media_url: 'a.png',
        sort_order: 0,
        deleted_at: new Date(),
      },
    });

    const result = await service.storeReviews({
      storeId: store.id.toString(),
      photoOnly: true,
    });

    expect(result.items).toEqual([]);
    expect(result.photoTotalCount).toBe(0);
  });

  it('soft-delete된 리뷰는 목록·카운트에서 제외한다', async () => {
    const store = await createStore(prisma);
    const review = await makeReview(store.id, {});
    await prisma.review.update({
      where: { id: review.id },
      data: { deleted_at: new Date() },
    });

    const result = await service.storeReviews({ storeId: store.id.toString() });
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('최신순(id desc) + 커서 페이지네이션을 처리한다', async () => {
    const store = await createStore(prisma);
    const r1 = await makeReview(store.id, {});
    const r2 = await makeReview(store.id, {});
    const r3 = await makeReview(store.id, {});

    const first = await service.storeReviews({
      storeId: store.id.toString(),
      limit: 2,
    });
    expect(first.items.map((r) => r.id)).toEqual([
      r3.id.toString(),
      r2.id.toString(),
    ]);
    expect(first.hasMore).toBe(true);
    expect(first.totalCount).toBe(3);

    const second = await service.storeReviews({
      storeId: store.id.toString(),
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((r) => r.id)).toEqual([r1.id.toString()]);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it('좋아요순 정렬: soft-delete 좋아요 제외 집계, 동률이면 최신순', async () => {
    const store = await createStore(prisma);
    const zeroLikes = await makeReview(store.id, {});
    const twoLikes = await makeReview(store.id, {});
    const threeLikes = await makeReview(store.id, {});
    await addLikes(twoLikes.id, 2);
    await addLikes(threeLikes.id, 3);
    // soft-delete된 좋아요는 집계에서 제외 → twoLikes는 2개 유지
    const canceledLiker = await createAccount(prisma, { account_type: 'USER' });
    await prisma.reviewLike.create({
      data: {
        review_id: twoLikes.id,
        account_id: canceledLiker.id,
        deleted_at: new Date(),
      },
    });

    const result = await service.storeReviews({
      storeId: store.id.toString(),
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
    const store = await createStore(prisma);
    const textOnlyPopular = await makeReview(store.id, {});
    await addLikes(textOnlyPopular.id, 5);
    const photoFew = await makeReview(store.id, {});
    await addMedia(photoFew.id);
    await addLikes(photoFew.id, 1);
    const photoMany = await makeReview(store.id, {});
    await addMedia(photoMany.id);
    await addLikes(photoMany.id, 3);

    const result = await service.storeReviews({
      storeId: store.id.toString(),
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
    const store = await createStore(prisma);
    const reviewA = await makeReview(store.id, {});
    const reviewB = await makeReview(store.id, {});
    const reviewC = await makeReview(store.id, {});
    await addLikes(reviewA.id, 2);
    await addLikes(reviewB.id, 2);
    await addLikes(reviewC.id, 1);

    // 동률(2)은 id desc → B, A 순. limit=2로 첫 페이지 [B, A]
    const page1 = await service.storeReviews({
      storeId: store.id.toString(),
      sort: 'LIKES',
      limit: 2,
    });
    expect(page1.items.map((r) => r.id)).toEqual([
      reviewB.id.toString(),
      reviewA.id.toString(),
    ]);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBe(`2:${reviewA.id.toString()}`);

    const page2 = await service.storeReviews({
      storeId: store.id.toString(),
      sort: 'LIKES',
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items.map((r) => r.id)).toEqual([reviewC.id.toString()]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it('좋아요순 커서 형식이 잘못되면 BAD_USER_INPUT', async () => {
    const store = await createStore(prisma);

    await expect(
      service.storeReviews({
        storeId: store.id.toString(),
        sort: 'LIKES',
        cursor: 'abc',
      }),
    ).rejects.toThrow(BadRequestException);

    // 자릿수 폭탄: 안전 정수 범위를 벗어난 likeCount는 형식 오류로 거부
    await expect(
      service.storeReviews({
        storeId: store.id.toString(),
        sort: 'LIKES',
        cursor: `${'1'.repeat(400)}:1`,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('비활성/삭제 매장의 리뷰는 목록·카운트에서 제외한다', async () => {
    const store = await createStore(prisma, { is_active: false });
    await makeReview(store.id, {});

    const result = await service.storeReviews({ storeId: store.id.toString() });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('탈퇴(soft-delete)한 작성자의 닉네임은 노출하지 않는다', async () => {
    const store = await createStore(prisma);
    const account = await createAccount(prisma, { account_type: 'USER' });
    await prisma.userProfile.create({
      data: {
        account_id: account.id,
        nickname: `deleted_${account.id}`,
        deleted_at: new Date(),
      },
    });
    const order = await createOrder(prisma, { account_id: account.id });
    const orderItem = await createOrderItem(prisma, {
      order_id: order.id,
      store_id: store.id,
    });
    await createReview(prisma, { order_item_id: orderItem.id, rating: 5 });

    const result = await service.storeReviews({ storeId: store.id.toString() });

    expect(result.items[0].authorNickname).toBeNull();
  });

  it('cursor "0"은 페이지를 리셋하지 않고 빈 결과를 반환한다', async () => {
    const store = await createStore(prisma);
    await makeReview(store.id, {});

    const result = await service.storeReviews({
      storeId: store.id.toString(),
      cursor: '0',
    });

    expect(result.items).toEqual([]);
  });
});
