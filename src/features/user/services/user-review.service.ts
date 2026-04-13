import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, ReviewMediaType } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import { USER_REVIEW_ERRORS } from '@/features/user/constants/user-review-error-messages';
import { ReviewRepository } from '@/features/user/repositories/review.repository';
import type {
  CreateReviewMediaUploadUrlInput,
  WriteReviewInput,
} from '@/features/user/types/user-review-input.type';
import type {
  MyReview,
  MyReviewConnection,
  MyReviewOrNull,
  ReviewMediaUploadUrl,
} from '@/features/user/types/user-review-output.type';
import { S3Service } from '@/global/storage/s3.service';
import type { UploadPurpose } from '@/global/storage/types/storage.types';

interface ReviewRow {
  id: bigint;
  order_item_id: bigint;
  product_id: bigint;
  rating: { toNumber?: () => number } | number;
  content: string | null;
  created_at: Date;
  order_item?: {
    product_name_snapshot: string;
    store?: { store_name: string };
    product?: {
      images?: { image_url: string }[];
    };
  } | null;
  media?: {
    media_type: string;
    media_url: string;
    thumbnail_url: string | null;
    sort_order: number;
  }[];
}

const MIN_CONTENT_LENGTH = 20;
const MAX_CONTENT_LENGTH = 1000;
const MAX_MEDIA_COUNT = 10;
const MAX_LIMIT = 50;

@Injectable()
export class UserReviewService {
  constructor(
    private readonly reviewRepo: ReviewRepository,
    private readonly s3Service: S3Service,
  ) {}

  async writeReview(
    accountId: bigint,
    input: WriteReviewInput,
  ): Promise<MyReview> {
    this.validateRating(input.rating);
    this.validateContent(input.content);
    this.validateMedia(input.media);

    const orderItemId = parseId(input.orderItemId);
    const orderItem = await this.reviewRepo.findOrderItemForReview({
      orderItemId,
      accountId,
    });

    if (!orderItem) {
      throw new NotFoundException(USER_REVIEW_ERRORS.ORDER_ITEM_NOT_FOUND);
    }

    if (orderItem.order.status !== OrderStatus.PICKED_UP) {
      throw new BadRequestException(USER_REVIEW_ERRORS.CANNOT_WRITE_REVIEW);
    }

    if (orderItem.review && !orderItem.review.deleted_at) {
      throw new ConflictException(USER_REVIEW_ERRORS.REVIEW_ALREADY_EXISTS);
    }

    // soft-delete된 기존 리뷰가 있으면 복원, 없으면 신규 생성
    const existingDeletedReviewId = orderItem.review?.deleted_at
      ? orderItem.review.id
      : undefined;

    const review = await this.reviewRepo.createOrRestoreReviewWithMedia({
      orderItemId,
      accountId,
      storeId: orderItem.store_id,
      productId: orderItem.product_id,
      rating: input.rating,
      content: input.content,
      existingDeletedReviewId,
      media: (input.media ?? []).map((m, i) => ({
        media_type:
          m.mediaType === 'VIDEO'
            ? ReviewMediaType.VIDEO
            : ReviewMediaType.IMAGE,
        media_url: m.mediaUrl,
        thumbnail_url: m.thumbnailUrl ?? null,
        sort_order: i,
      })),
    });

    return this.mapReview(review!);
  }

  async myReviews(
    accountId: bigint,
    input?: { offset?: number; limit?: number },
  ): Promise<MyReviewConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 20;

    if (offset < 0) {
      throw new BadRequestException('오프셋은 0 이상이어야 합니다.');
    }
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException('조회 개수는 1~50 사이여야 합니다.');
    }

    const { items, totalCount } = await this.reviewRepo.listMyReviews({
      accountId,
      offset,
      limit,
    });

    return {
      items: items.map((r) => this.mapReview(r)),
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  async myReviewForOrderItem(
    accountId: bigint,
    orderItemIdStr: string,
  ): Promise<MyReviewOrNull> {
    const orderItemId = parseId(orderItemIdStr);
    const orderItem = await this.reviewRepo.findOrderItemForReview({
      orderItemId,
      accountId,
    });

    if (!orderItem) {
      throw new NotFoundException(USER_REVIEW_ERRORS.ORDER_ITEM_NOT_FOUND);
    }

    const isPickedUp = orderItem.order.status === OrderStatus.PICKED_UP;
    const hasActiveReview = orderItem.review && !orderItem.review.deleted_at;

    if (hasActiveReview) {
      const review = await this.reviewRepo.findReviewById(orderItem.review!.id);

      return {
        review: review ? this.mapReview(review) : null,
        canWrite: false,
        reasonIfCannotWrite: '이미 리뷰가 작성된 주문 아이템입니다.',
      };
    }

    if (!isPickedUp) {
      return {
        review: null,
        canWrite: false,
        reasonIfCannotWrite: '픽업 완료된 주문만 리뷰를 작성할 수 있습니다.',
      };
    }

    return {
      review: null,
      canWrite: true,
      reasonIfCannotWrite: null,
    };
  }

  async deleteMyReview(
    accountId: bigint,
    reviewIdStr: string,
  ): Promise<boolean> {
    const reviewId = parseId(reviewIdStr);
    const deleted = await this.reviewRepo.softDeleteReview({
      reviewId,
      accountId,
      now: new Date(),
    });

    if (!deleted) {
      throw new NotFoundException(USER_REVIEW_ERRORS.REVIEW_NOT_FOUND);
    }

    return true;
  }

  async createReviewMediaUploadUrl(
    accountId: bigint,
    input: CreateReviewMediaUploadUrlInput,
  ): Promise<ReviewMediaUploadUrl> {
    const purpose: UploadPurpose =
      input.mediaType === 'VIDEO' ? 'REVIEW_VIDEO' : 'REVIEW_IMAGE';

    return this.s3Service.createUploadUrl({
      accountId,
      purpose,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }

  private validateRating(rating: number): void {
    if (rating < 1 || rating > 5 || (rating * 10) % 5 !== 0) {
      throw new BadRequestException(USER_REVIEW_ERRORS.INVALID_RATING);
    }
  }

  private validateContent(content: string): void {
    const trimmed = content.trim();
    if (trimmed.length < MIN_CONTENT_LENGTH) {
      throw new BadRequestException(USER_REVIEW_ERRORS.CONTENT_TOO_SHORT);
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(USER_REVIEW_ERRORS.CONTENT_TOO_LONG);
    }
  }

  private validateMedia(
    media?: { mediaType: string; mediaUrl: string }[],
  ): void {
    if (media && media.length > MAX_MEDIA_COUNT) {
      throw new BadRequestException(USER_REVIEW_ERRORS.TOO_MANY_MEDIA);
    }
  }

  private mapReview(r: ReviewRow): MyReview {
    const rating =
      typeof r.rating === 'number'
        ? r.rating
        : typeof r.rating?.toNumber === 'function'
          ? r.rating.toNumber()
          : Number(r.rating);

    return {
      reviewId: r.id.toString(),
      orderItemId: r.order_item_id.toString(),
      productId: r.product_id.toString(),
      productName: r.order_item?.product_name_snapshot ?? '',
      productImageUrl: r.order_item?.product?.images?.[0]?.image_url ?? null,
      storeName: r.order_item?.store?.store_name ?? '',
      rating,
      content: r.content,
      media: (r.media ?? []).map((m) => ({
        mediaType: m.media_type as 'IMAGE' | 'VIDEO',
        mediaUrl: m.media_url,
        thumbnailUrl: m.thumbnail_url,
        sortOrder: m.sort_order,
      })),
      createdAt: r.created_at,
    };
  }
}
