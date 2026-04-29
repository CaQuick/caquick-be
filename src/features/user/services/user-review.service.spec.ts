import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ReviewRepository } from '@/features/user/repositories/review.repository';
import { UserReviewService } from '@/features/user/services/user-review.service';
import { S3Service } from '@/global/storage/s3.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const VALID_CONTENT = '맛있었고 포장도 깔끔했습니다. 다음에 또 주문할게요.';

describe('UserReviewService (real DB)', () => {
  let service: UserReviewService;
  let prisma: PrismaClient;
  let s3Service: jest.Mocked<S3Service>;

  beforeAll(async () => {
    s3Service = {
      createUploadUrl: jest.fn(),
    } as unknown as jest.Mocked<S3Service>;

    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserReviewService,
        ReviewRepository,
        { provide: S3Service, useValue: s3Service },
      ],
    });
    service = module.get(UserReviewService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.clearAllMocks();
  });

  /** 리뷰 작성 가능한 상태(PICKED_UP 주문 + 본인 아이템)를 세팅 */
  async function setupReviewableOrderItem(): Promise<{
    accountId: bigint;
    storeId: bigint;
    productId: bigint;
    orderItemId: bigint;
  }> {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    const store = await createStore(prisma, { store_name: '매장R' });
    const product = await createProduct(prisma, {
      store_id: store.id,
      name: '상품R',
    });
    const order = await createOrder(prisma, {
      account_id: account.id,
      status: 'PICKED_UP',
    });
    const item = await createOrderItem(prisma, {
      order_id: order.id,
      product_id: product.id,
      product_name_snapshot: '상품R 스냅샷',
    });
    return {
      accountId: account.id,
      storeId: store.id,
      productId: product.id,
      orderItemId: item.id,
    };
  }

  // ─── writeReview ───
  describe('writeReview', () => {
    it('PICKED_UP 주문 아이템에 리뷰와 미디어를 생성한다', async () => {
      const ctx = await setupReviewableOrderItem();

      const result = await service.writeReview(ctx.accountId, {
        orderItemId: ctx.orderItemId.toString(),
        rating: 4.5,
        content: VALID_CONTENT,
        media: [
          {
            mediaType: 'IMAGE',
            mediaUrl: 'https://s3.example.com/image1.jpg',
            sortOrder: 0,
          },
          {
            mediaType: 'VIDEO',
            mediaUrl: 'https://s3.example.com/video1.mp4',
            thumbnailUrl: 'https://s3.example.com/video1-thumb.jpg',
            sortOrder: 1,
          },
        ],
      });

      expect(result.rating).toBe(4.5);
      expect(result.content).toBe(VALID_CONTENT);
      expect(result.storeName).toBe('매장R');
      expect(result.productName).toBe('상품R 스냅샷');
      expect(result.media).toHaveLength(2);

      const saved = await prisma.review.findUniqueOrThrow({
        where: { id: BigInt(result.reviewId) },
        include: { media: true },
      });
      expect(saved.media).toHaveLength(2);
      expect(saved.media.some((m) => m.media_type === 'VIDEO')).toBe(true);
    });

    it('rating이 1 미만이거나 0.5 단위가 아니면 BadRequestException', async () => {
      const ctx = await setupReviewableOrderItem();

      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 0,
          content: VALID_CONTENT,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 4.3,
          content: VALID_CONTENT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rating이 5 초과면 BadRequestException', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 6,
          content: VALID_CONTENT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('content가 20자 미만이면 BadRequestException', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 5,
          content: '짧아요',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('content가 1000자 초과면 BadRequestException', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 5,
          content: 'a'.repeat(1001),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('사진 10장 + 동영상 1개(총 11개)는 통과한다', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 5,
          content: VALID_CONTENT,
          media: [
            ...Array.from({ length: 10 }, (_, i) => ({
              mediaType: 'IMAGE' as const,
              mediaUrl: `https://s3.example.com/${i}.jpg`,
              sortOrder: i,
            })),
            {
              mediaType: 'VIDEO' as const,
              mediaUrl: 'https://s3.example.com/v.mp4',
              sortOrder: 10,
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('사진 11장이면 BadRequestException (TOO_MANY_IMAGES)', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 5,
          content: VALID_CONTENT,
          media: Array.from({ length: 11 }, (_, i) => ({
            mediaType: 'IMAGE' as const,
            mediaUrl: `https://s3.example.com/${i}.jpg`,
            sortOrder: i,
          })),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('동영상 2개면 BadRequestException (TOO_MANY_VIDEOS)', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 5,
          content: VALID_CONTENT,
          media: [
            {
              mediaType: 'VIDEO' as const,
              mediaUrl: 'https://s3.example.com/v1.mp4',
              sortOrder: 0,
            },
            {
              mediaType: 'VIDEO' as const,
              mediaUrl: 'https://s3.example.com/v2.mp4',
              sortOrder: 1,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('사진 0 + 동영상 1개만 있어도 통과한다', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 5,
          content: VALID_CONTENT,
          media: [
            {
              mediaType: 'VIDEO' as const,
              mediaUrl: 'https://s3.example.com/v.mp4',
              sortOrder: 0,
            },
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('orderItem이 본인 소유가 아니면 NotFoundException', async () => {
      const me = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: me.id });
      const other = await setupReviewableOrderItem();

      await expect(
        service.writeReview(me.id, {
          orderItemId: other.orderItemId.toString(),
          rating: 5,
          content: VALID_CONTENT,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('주문이 PICKED_UP 이전 상태면 BadRequestException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });
      const product = await createProduct(prisma);
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
      });

      await expect(
        service.writeReview(account.id, {
          orderItemId: item.id.toString(),
          rating: 5,
          content: VALID_CONTENT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('활성 리뷰가 이미 있으면 ConflictException', async () => {
      const ctx = await setupReviewableOrderItem();
      await service.writeReview(ctx.accountId, {
        orderItemId: ctx.orderItemId.toString(),
        rating: 5,
        content: VALID_CONTENT,
      });

      await expect(
        service.writeReview(ctx.accountId, {
          orderItemId: ctx.orderItemId.toString(),
          rating: 5,
          content: VALID_CONTENT,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('soft-delete된 리뷰가 있으면 복원하여 새 rating/content/media를 반영한다', async () => {
      const ctx = await setupReviewableOrderItem();
      const NEW_CONTENT = '복원 후 새 내용입니다. 아주 만족스럽습니다.';

      // 첫 작성 (media 1건 포함) 후 soft-delete
      const first = await service.writeReview(ctx.accountId, {
        orderItemId: ctx.orderItemId.toString(),
        rating: 3,
        content: VALID_CONTENT,
        media: [
          {
            mediaType: 'IMAGE',
            mediaUrl: 'https://i.example/old.png',
            sortOrder: 0,
          },
        ],
      });
      await service.deleteMyReview(ctx.accountId, first.reviewId);

      // 다시 작성 → 같은 row 복원, rating/content/media 모두 새 값으로 교체되어야 함
      const restored = await service.writeReview(ctx.accountId, {
        orderItemId: ctx.orderItemId.toString(),
        rating: 5,
        content: NEW_CONTENT,
        media: [
          {
            mediaType: 'IMAGE',
            mediaUrl: 'https://i.example/new1.png',
            sortOrder: 0,
          },
          {
            mediaType: 'VIDEO',
            mediaUrl: 'https://i.example/new2.mp4',
            sortOrder: 1,
          },
        ],
      });

      expect(restored.reviewId).toBe(first.reviewId);
      const saved = await prisma.review.findUniqueOrThrow({
        where: { id: BigInt(restored.reviewId) },
      });
      expect(saved.deleted_at).toBeNull();
      expect(Number(saved.rating)).toBe(5);
      expect(saved.content).toBe(NEW_CONTENT);

      // media: 새 값 2건만 남고 stale 1건은 정리됐는지 확인
      const mediaRows = await prisma.reviewMedia.findMany({
        where: { review_id: BigInt(restored.reviewId), deleted_at: null },
      });
      const mediaUrls = mediaRows.map((m) => m.media_url).sort();
      expect(mediaUrls).toEqual([
        'https://i.example/new1.png',
        'https://i.example/new2.mp4',
      ]);
    });
  });

  // ─── myReviews ───
  describe('myReviews', () => {
    it('본인 리뷰 목록을 최신순으로 반환 + hasMore 계산', async () => {
      const ctx = await setupReviewableOrderItem();
      await service.writeReview(ctx.accountId, {
        orderItemId: ctx.orderItemId.toString(),
        rating: 5,
        content: VALID_CONTENT,
      });

      const result = await service.myReviews(ctx.accountId, {
        offset: 0,
        limit: 10,
      });

      expect(result.totalCount).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.items[0]).toMatchObject({
        productName: '상품R 스냅샷',
        storeName: '매장R',
      });
    });

    it('다른 유저 리뷰는 포함되지 않는다', async () => {
      const me = await setupReviewableOrderItem();
      const other = await setupReviewableOrderItem();
      await service.writeReview(me.accountId, {
        orderItemId: me.orderItemId.toString(),
        rating: 5,
        content: VALID_CONTENT,
      });
      await service.writeReview(other.accountId, {
        orderItemId: other.orderItemId.toString(),
        rating: 5,
        content: VALID_CONTENT,
      });

      const result = await service.myReviews(me.accountId);
      expect(result.totalCount).toBe(1);
    });

    it('offset 음수면 BadRequestException', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.myReviews(ctx.accountId, { offset: -1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('limit이 50 초과면 BadRequestException', async () => {
      const ctx = await setupReviewableOrderItem();
      await expect(
        service.myReviews(ctx.accountId, { limit: 51 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── myReviewForOrderItem ───
  describe('myReviewForOrderItem', () => {
    it('작성 전 + PICKED_UP이면 canWrite=true, review=null', async () => {
      const ctx = await setupReviewableOrderItem();

      const result = await service.myReviewForOrderItem(
        ctx.accountId,
        ctx.orderItemId.toString(),
      );

      expect(result).toEqual({
        review: null,
        canWrite: true,
        reasonIfCannotWrite: null,
      });
    });

    it('작성 전 + PICKED_UP 아님이면 canWrite=false, 사유는 "픽업 완료"', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });
      const product = await createProduct(prisma);
      const order = await createOrder(prisma, {
        account_id: account.id,
        status: 'SUBMITTED',
      });
      const item = await createOrderItem(prisma, {
        order_id: order.id,
        product_id: product.id,
      });

      const result = await service.myReviewForOrderItem(
        account.id,
        item.id.toString(),
      );

      expect(result.canWrite).toBe(false);
      expect(result.reasonIfCannotWrite).toContain('픽업 완료');
      expect(result.review).toBeNull();
    });

    it('활성 리뷰가 있으면 review 반환 + canWrite=false', async () => {
      const ctx = await setupReviewableOrderItem();
      await service.writeReview(ctx.accountId, {
        orderItemId: ctx.orderItemId.toString(),
        rating: 5,
        content: VALID_CONTENT,
      });

      const result = await service.myReviewForOrderItem(
        ctx.accountId,
        ctx.orderItemId.toString(),
      );

      expect(result.canWrite).toBe(false);
      expect(result.reasonIfCannotWrite).toContain('이미 리뷰');
      expect(result.review).not.toBeNull();
      expect(result.review?.productName).toBe('상품R 스냅샷');
    });

    it('orderItem이 본인 소유가 아니면 NotFoundException', async () => {
      const me = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: me.id });
      const other = await setupReviewableOrderItem();

      await expect(
        service.myReviewForOrderItem(me.id, other.orderItemId.toString()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── deleteMyReview ───
  describe('deleteMyReview', () => {
    it('본인 리뷰를 soft-delete하고 true 반환', async () => {
      const ctx = await setupReviewableOrderItem();
      const review = await service.writeReview(ctx.accountId, {
        orderItemId: ctx.orderItemId.toString(),
        rating: 5,
        content: VALID_CONTENT,
      });

      const result = await service.deleteMyReview(
        ctx.accountId,
        review.reviewId,
      );

      expect(result).toBe(true);
      const saved = await prisma.review.findUniqueOrThrow({
        where: { id: BigInt(review.reviewId) },
      });
      expect(saved.deleted_at).not.toBeNull();
    });

    it('존재하지 않거나 타인 리뷰면 NotFoundException', async () => {
      const me = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: me.id });

      await expect(service.deleteMyReview(me.id, '999999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── createReviewMediaUploadUrl ───
  describe('createReviewMediaUploadUrl', () => {
    it('IMAGE 타입이면 REVIEW_IMAGE purpose로 S3Service 위임', async () => {
      const expected = {
        uploadUrl: 'https://presigned.example.com',
        publicUrl: 'https://s3.example.com/img.jpg',
        key: 'review-images/x/uuid.jpg',
        expiresInSeconds: 600,
      };
      s3Service.createUploadUrl.mockResolvedValue(expected);

      const result = await service.createReviewMediaUploadUrl(BigInt(1), {
        mediaType: 'IMAGE',
        contentType: 'image/jpeg',
        contentLength: 1024,
      });

      expect(result).toEqual(expected);
      expect(s3Service.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'REVIEW_IMAGE' }),
      );
    });

    it('VIDEO 타입이면 REVIEW_VIDEO purpose로 위임', async () => {
      s3Service.createUploadUrl.mockResolvedValue({
        uploadUrl: 'x',
        publicUrl: 'y',
        key: 'z',
        expiresInSeconds: 600,
      });

      await service.createReviewMediaUploadUrl(BigInt(1), {
        mediaType: 'VIDEO',
        contentType: 'video/mp4',
        contentLength: 1024 * 1024,
      });

      expect(s3Service.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'REVIEW_VIDEO' }),
      );
    });
  });
});
