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

  it('리뷰가 없으면 빈 목록과 totalCount 0', async () => {
    const store = await createStore(prisma);
    const result = await service.storeReviews({ storeId: store.id.toString() });
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
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
});
