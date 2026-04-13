import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';

import { USER_REVIEW_ERRORS } from '@/features/user/constants/user-review-error-messages';
import { ReviewRepository } from '@/features/user/repositories/review.repository';
import { UserReviewService } from '@/features/user/services/user-review.service';
import { S3Service } from '@/global/storage/s3.service';

describe('UserReviewService', () => {
  let service: UserReviewService;
  let reviewRepo: jest.Mocked<ReviewRepository>;
  let s3Service: jest.Mocked<S3Service>;

  const accountId = BigInt(1);

  const mockOrderItem = {
    id: BigInt(200),
    store_id: BigInt(10),
    product_id: BigInt(300),
    product_name_snapshot: '딸기 케이크',
    order: { status: OrderStatus.PICKED_UP, account_id: accountId },
    review: null,
    store: { store_name: '스웨이드 베이커리' },
    product: {
      id: BigInt(300),
      name: '딸기 케이크',
      images: [{ image_url: 'https://s3.example.com/cake.jpg' }],
    },
  };

  const validInput = {
    orderItemId: '200',
    rating: 4.5,
    content: '정말 맛있는 케이크였습니다. 데코레이션도 예쁘고 추천합니다!',
    media: [],
  };

  beforeEach(async () => {
    reviewRepo = {
      findOrderItemForReview: jest.fn(),
      findReviewById: jest.fn(),
      createOrRestoreReviewWithMedia: jest.fn(),
      listMyReviews: jest.fn(),
      softDeleteReview: jest.fn(),
    } as unknown as jest.Mocked<ReviewRepository>;

    s3Service = {
      createUploadUrl: jest.fn(),
    } as unknown as jest.Mocked<S3Service>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserReviewService,
        { provide: ReviewRepository, useValue: reviewRepo },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get<UserReviewService>(UserReviewService);
  });

  describe('writeReview', () => {
    it('유효한 입력이면 리뷰를 생성해야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue(
        mockOrderItem as never,
      );
      reviewRepo.createOrRestoreReviewWithMedia.mockResolvedValue({
        id: BigInt(500),
        order_item_id: BigInt(200),
        product_id: BigInt(300),
        rating: 4.5 as never,
        content: validInput.content,
        created_at: new Date(),
        order_item: {
          id: BigInt(200),
          product_name_snapshot: '딸기 케이크',
          store: { store_name: '스웨이드 베이커리' },
          product: {
            id: BigInt(300),
            images: [{ image_url: 'https://s3.example.com/cake.jpg' }],
          },
        },
        media: [],
      } as never);

      const result = await service.writeReview(accountId, validInput);

      expect(result.reviewId).toBe('500');
      expect(result.rating).toBe(4.5);
      expect(result.productName).toBe('딸기 케이크');
    });

    it('주문 아이템이 없으면 NotFoundException을 던져야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue(null);

      await expect(service.writeReview(accountId, validInput)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('PICKED_UP이 아니면 BadRequestException을 던져야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue({
        ...mockOrderItem,
        order: { status: OrderStatus.CONFIRMED, account_id: accountId },
      } as never);

      await expect(service.writeReview(accountId, validInput)).rejects.toThrow(
        USER_REVIEW_ERRORS.CANNOT_WRITE_REVIEW,
      );
    });

    it('이미 리뷰가 있으면 ConflictException을 던져야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue({
        ...mockOrderItem,
        review: { id: BigInt(1), deleted_at: null },
      } as never);

      await expect(service.writeReview(accountId, validInput)).rejects.toThrow(
        ConflictException,
      );
    });

    it('media가 undefined이면 빈 배열로 처리해야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue(
        mockOrderItem as never,
      );
      reviewRepo.createOrRestoreReviewWithMedia.mockResolvedValue({
        id: BigInt(502),
        order_item_id: BigInt(200),
        product_id: BigInt(300),
        rating: 4.5 as never,
        content: validInput.content,
        created_at: new Date(),
        order_item: {
          product_name_snapshot: '딸기 케이크',
          store: { store_name: '스웨이드 베이커리' },
          product: { images: [] },
        },
        media: [],
      } as never);

      const inputWithoutMedia = {
        orderItemId: '200',
        rating: 4.5,
        content: validInput.content,
      };

      const result = await service.writeReview(
        accountId,
        inputWithoutMedia as never,
      );

      expect(result.reviewId).toBe('502');
      expect(reviewRepo.createOrRestoreReviewWithMedia).toHaveBeenCalledWith(
        expect.objectContaining({ media: [] }),
      );
    });

    it('rating이 toNumber 메서드를 가진 Decimal 객체이면 toNumber()로 변환해야 한다', async () => {
      const decimalRating = { toNumber: () => 4.5 };
      reviewRepo.findOrderItemForReview.mockResolvedValue(
        mockOrderItem as never,
      );
      reviewRepo.createOrRestoreReviewWithMedia.mockResolvedValue({
        id: BigInt(503),
        order_item_id: BigInt(200),
        product_id: BigInt(300),
        rating: decimalRating as never,
        content: validInput.content,
        created_at: new Date(),
        order_item: {
          product_name_snapshot: '딸기 케이크',
          store: { store_name: '스웨이드 베이커리' },
          product: { images: [] },
        },
        media: [],
      } as never);

      const result = await service.writeReview(accountId, validInput);

      expect(result.rating).toBe(4.5);
    });

    it('media가 undefined이면 빈 미디어로 생성해야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue(
        mockOrderItem as never,
      );
      reviewRepo.createOrRestoreReviewWithMedia.mockResolvedValue({
        id: BigInt(502),
        order_item_id: BigInt(200),
        product_id: BigInt(300),
        rating: 4.5 as never,
        content: validInput.content,
        created_at: new Date(),
        order_item: {
          id: BigInt(200),
          product_name_snapshot: '딸기 케이크',
          store: { store_name: '스웨이드 베이커리' },
          product: { id: BigInt(300), images: [] },
        },
        media: [],
      } as never);

      const { media: _, ...inputWithoutMedia } = validInput;
      const result = await service.writeReview(accountId, inputWithoutMedia);

      expect(result.reviewId).toBe('502');
      expect(reviewRepo.createOrRestoreReviewWithMedia).toHaveBeenCalledWith(
        expect.objectContaining({ media: [] }),
      );
    });

    it('media에 VIDEO 타입이 포함되면 올바르게 매핑해야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue(
        mockOrderItem as never,
      );
      reviewRepo.createOrRestoreReviewWithMedia.mockResolvedValue({
        id: BigInt(503),
        order_item_id: BigInt(200),
        product_id: BigInt(300),
        rating: 4.0 as never,
        content: validInput.content,
        created_at: new Date(),
        order_item: {
          id: BigInt(200),
          product_name_snapshot: '딸기 케이크',
          store: { store_name: '스웨이드 베이커리' },
          product: { id: BigInt(300), images: [] },
        },
        media: [
          {
            media_type: 'VIDEO',
            media_url: 'https://s3.example.com/vid.mp4',
            thumbnail_url: null,
            sort_order: 0,
          },
        ],
      } as never);

      const result = await service.writeReview(accountId, {
        ...validInput,
        media: [
          {
            mediaType: 'VIDEO' as const,
            mediaUrl: 'https://s3.example.com/vid.mp4',
            sortOrder: 0,
          },
        ],
      });

      expect(result.media[0].mediaType).toBe('VIDEO');
    });

    it('soft-delete된 리뷰가 있으면 새 리뷰를 작성할 수 있어야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue({
        ...mockOrderItem,
        review: { id: BigInt(1), deleted_at: new Date() },
      } as never);
      reviewRepo.createOrRestoreReviewWithMedia.mockResolvedValue({
        id: BigInt(501),
        order_item_id: BigInt(200),
        product_id: BigInt(300),
        rating: 4.5 as never,
        content: validInput.content,
        created_at: new Date(),
        order_item: {
          id: BigInt(200),
          product_name_snapshot: '딸기 케이크',
          store: { store_name: '스웨이드 베이커리' },
          product: { id: BigInt(300), images: [] },
        },
        media: [],
      } as never);

      const result = await service.writeReview(accountId, validInput);

      expect(result.reviewId).toBe('501');
    });

    describe('입력 검증', () => {
      beforeEach(() => {
        reviewRepo.findOrderItemForReview.mockResolvedValue(
          mockOrderItem as never,
        );
      });

      it('별점이 0.5 단위가 아니면 에러를 던져야 한다', async () => {
        await expect(
          service.writeReview(accountId, { ...validInput, rating: 4.3 }),
        ).rejects.toThrow(USER_REVIEW_ERRORS.INVALID_RATING);
      });

      it('별점이 0이면 에러를 던져야 한다', async () => {
        await expect(
          service.writeReview(accountId, { ...validInput, rating: 0 }),
        ).rejects.toThrow(USER_REVIEW_ERRORS.INVALID_RATING);
      });

      it('별점이 5.5이면 에러를 던져야 한다', async () => {
        await expect(
          service.writeReview(accountId, { ...validInput, rating: 5.5 }),
        ).rejects.toThrow(USER_REVIEW_ERRORS.INVALID_RATING);
      });

      it('내용이 20자 미만이면 에러를 던져야 한다', async () => {
        await expect(
          service.writeReview(accountId, {
            ...validInput,
            content: '짧은 리뷰',
          }),
        ).rejects.toThrow(USER_REVIEW_ERRORS.CONTENT_TOO_SHORT);
      });

      it('내용이 1000자 초과이면 에러를 던져야 한다', async () => {
        await expect(
          service.writeReview(accountId, {
            ...validInput,
            content: 'a'.repeat(1001),
          }),
        ).rejects.toThrow(USER_REVIEW_ERRORS.CONTENT_TOO_LONG);
      });

      it('미디어가 10개 초과이면 에러를 던져야 한다', async () => {
        const media = Array.from({ length: 11 }, (_, i) => ({
          mediaType: 'IMAGE' as const,
          mediaUrl: `https://s3.example.com/${i}.jpg`,
          sortOrder: i,
        }));

        await expect(
          service.writeReview(accountId, { ...validInput, media }),
        ).rejects.toThrow(USER_REVIEW_ERRORS.TOO_MANY_MEDIA);
      });
    });
  });

  describe('myReviews', () => {
    it('리뷰 목록을 반환해야 한다', async () => {
      reviewRepo.listMyReviews.mockResolvedValue({
        items: [],
        totalCount: 0,
      });

      const result = await service.myReviews(accountId);

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('hasMore가 true인 경우를 올바르게 계산해야 한다', async () => {
      const makeReviewRow = (id: number) => ({
        id: BigInt(id),
        order_item_id: BigInt(200),
        product_id: BigInt(300),
        rating: 4.5,
        content: '맛있어요',
        created_at: new Date(),
        order_item: {
          product_name_snapshot: '딸기 케이크',
          store: { store_name: '스웨이드 베이커리' },
          product: { images: [] },
        },
        media: [],
      });

      reviewRepo.listMyReviews.mockResolvedValue({
        items: Array.from({ length: 10 }, (_, i) => makeReviewRow(i + 1)),
        totalCount: 25,
      } as never);

      const result = await service.myReviews(accountId, {
        offset: 0,
        limit: 10,
      });

      expect(result.items).toHaveLength(10);
      expect(result.totalCount).toBe(25);
      expect(result.hasMore).toBe(true);
    });

    it('offset이 음수이면 BadRequestException을 던져야 한다', async () => {
      await expect(
        service.myReviews(accountId, { offset: -1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('limit이 0이면 BadRequestException을 던져야 한다', async () => {
      await expect(service.myReviews(accountId, { limit: 0 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('limit이 50 초과이면 BadRequestException을 던져야 한다', async () => {
      await expect(service.myReviews(accountId, { limit: 51 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rating이 Decimal 객체(toNumber 메서드)일 때 올바르게 변환해야 한다', async () => {
      reviewRepo.listMyReviews.mockResolvedValue({
        items: [
          {
            id: BigInt(1),
            order_item_id: BigInt(200),
            product_id: BigInt(300),
            rating: { toNumber: () => 3.5 } as never,
            content: '맛있어요',
            created_at: new Date(),
            order_item: {
              product_name_snapshot: '딸기 케이크',
              store: { store_name: '스웨이드 베이커리' },
              product: { images: [] },
            },
            media: undefined,
          },
        ],
        totalCount: 1,
      } as never);

      const result = await service.myReviews(accountId, {
        offset: 0,
        limit: 10,
      });

      expect(result.items[0].rating).toBe(3.5);
      expect(result.items[0].media).toEqual([]);
    });

    it('rating이 toNumber 메서드 없는 객체일 때 Number()로 변환해야 한다', async () => {
      // Decimal 객체에 toNumber가 없는 케이스 대비
      reviewRepo.listMyReviews.mockResolvedValue({
        items: [
          {
            id: BigInt(1),
            order_item_id: BigInt(200),
            product_id: BigInt(300),
            rating: { valueOf: () => 4.5 } as never,
            content: '맛있어요',
            created_at: new Date(),
            order_item: null,
            media: [],
          },
        ],
        totalCount: 1,
      } as never);

      const result = await service.myReviews(accountId, {
        offset: 0,
        limit: 10,
      });

      expect(result.items[0].rating).toBeCloseTo(4.5, 0);
    });
  });

  describe('deleteMyReview', () => {
    it('삭제 성공 시 true를 반환해야 한다', async () => {
      reviewRepo.softDeleteReview.mockResolvedValue(true);

      const result = await service.deleteMyReview(accountId, '500');

      expect(result).toBe(true);
    });

    it('리뷰를 찾을 수 없으면 NotFoundException을 던져야 한다', async () => {
      reviewRepo.softDeleteReview.mockResolvedValue(false);

      await expect(service.deleteMyReview(accountId, '999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createReviewMediaUploadUrl', () => {
    it('IMAGE 타입이면 REVIEW_IMAGE purpose로 위임해야 한다', async () => {
      s3Service.createUploadUrl.mockResolvedValue({
        uploadUrl: 'https://presigned.url',
        publicUrl: 'https://s3.example.com/img.jpg',
        key: 'review-media/images/1/img.jpg',
        expiresInSeconds: 600,
      });

      await service.createReviewMediaUploadUrl(accountId, {
        mediaType: 'IMAGE',
        contentType: 'image/jpeg',
        contentLength: 1024,
      });

      expect(s3Service.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'REVIEW_IMAGE' }),
      );
    });

    it('VIDEO 타입이면 REVIEW_VIDEO purpose로 위임해야 한다', async () => {
      s3Service.createUploadUrl.mockResolvedValue({
        uploadUrl: 'https://presigned.url',
        publicUrl: 'https://s3.example.com/vid.mp4',
        key: 'review-media/videos/1/vid.mp4',
        expiresInSeconds: 600,
      });

      await service.createReviewMediaUploadUrl(accountId, {
        mediaType: 'VIDEO',
        contentType: 'video/mp4',
        contentLength: 1024,
      });

      expect(s3Service.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'REVIEW_VIDEO' }),
      );
    });
  });

  describe('myReviewForOrderItem', () => {
    it('리뷰가 없고 PICKED_UP이면 canWrite: true를 반환해야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue(
        mockOrderItem as never,
      );

      const result = await service.myReviewForOrderItem(accountId, '200');

      expect(result.canWrite).toBe(true);
      expect(result.review).toBeNull();
    });

    it('PICKED_UP이 아니면 canWrite: false를 반환해야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue({
        ...mockOrderItem,
        order: { status: OrderStatus.CONFIRMED, account_id: accountId },
      } as never);

      const result = await service.myReviewForOrderItem(accountId, '200');

      expect(result.canWrite).toBe(false);
      expect(result.reasonIfCannotWrite).toContain('픽업 완료');
    });

    it('주문 아이템이 없으면 NotFoundException을 던져야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue(null);

      await expect(
        service.myReviewForOrderItem(accountId, '999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('활성 리뷰가 있고 findReviewById가 리뷰를 반환하면 canWrite: false와 리뷰를 반환해야 한다', async () => {
      const reviewRow = {
        id: BigInt(500),
        order_item_id: BigInt(200),
        product_id: BigInt(300),
        rating: 4.5,
        content: '정말 맛있어요!',
        created_at: new Date(),
        order_item: {
          product_name_snapshot: '딸기 케이크',
          store: { store_name: '스웨이드 베이커리' },
          product: { images: [] },
        },
        media: [],
      };

      reviewRepo.findOrderItemForReview.mockResolvedValue({
        ...mockOrderItem,
        review: { id: BigInt(500), deleted_at: null },
      } as never);
      reviewRepo.findReviewById.mockResolvedValue(reviewRow as never);

      const result = await service.myReviewForOrderItem(accountId, '200');

      expect(result.canWrite).toBe(false);
      expect(result.review).not.toBeNull();
      expect(result.review?.reviewId).toBe('500');
      expect(result.reasonIfCannotWrite).toContain('이미 리뷰가 작성된');
    });

    it('활성 리뷰가 있지만 findReviewById가 null을 반환하면 review가 null이어야 한다', async () => {
      reviewRepo.findOrderItemForReview.mockResolvedValue({
        ...mockOrderItem,
        review: { id: BigInt(500), deleted_at: null },
      } as never);
      reviewRepo.findReviewById.mockResolvedValue(null);

      const result = await service.myReviewForOrderItem(accountId, '200');

      expect(result.canWrite).toBe(false);
      expect(result.review).toBeNull();
    });
  });
});
