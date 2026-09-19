import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { buildRegionLabel } from '@/common/utils/region-label';
import type { CreateReviewMediaUploadUrlInput } from '@/features/mypage/dto/inputs/create-review-media-upload-url.input';
import type { MyReviewableOrderItemsInput } from '@/features/mypage/dto/inputs/my-reviewable-order-items.input';
import type { MyReviewsInput } from '@/features/mypage/dto/inputs/my-reviews.input';
import type { WriteReviewInput } from '@/features/mypage/dto/inputs/write-review.input';
import type {
  MyReview,
  MyReviewableOrderItemConnection,
  MyReviewConnection,
  MyReviewOrNull,
} from '@/features/mypage/types/mypage-review-output.type';
import { OrderRepository } from '@/features/order';
import { ReviewRepository } from '@/features/review';
import { toReviewMedia } from '@/features/review';
import { OrderStatus, ReviewMediaType } from '@/generated/prisma/client';
import { S3Service } from '@/global/storage/s3.service';
import type {
  CreateUploadUrlOutput,
  UploadPurpose,
} from '@/global/storage/types/storage.types';

interface ReviewRow {
  id: bigint;
  order_item_id: bigint;
  product_id: bigint;
  rating: { toNumber?: () => number } | number;
  content: string | null;
  created_at: Date;
  order_item?: {
    product_name_snapshot: string;
    store_name_snapshot: string;
    product_thumbnail_url_snapshot: string | null;
  } | null;
  media?: {
    media_type: ReviewMediaType;
    media_url: string;
    thumbnail_url: string | null;
    sort_order: number;
  }[];
}

// 사진 최대 10장 / 동영상 1개 — 합쳐서 최대 11개.
const MAX_IMAGE_COUNT = 10;
const MAX_VIDEO_COUNT = 1;

@Injectable()
export class UserReviewService {
  constructor(
    private readonly reviewRepo: ReviewRepository,
    private readonly orderRepo: OrderRepository,
    private readonly s3Service: S3Service,
  ) {}

  async myReviewableOrderItems(
    accountId: bigint,
    input?: MyReviewableOrderItemsInput,
  ): Promise<MyReviewableOrderItemConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 20;

    const { items, totalCount } = await this.orderRepo.listReviewableOrderItems(
      { accountId, offset, limit },
    );

    return {
      items: items.map((item) => ({
        orderItemId: item.id.toString(),
        productId: item.product_id.toString(),
        productName: item.product_name_snapshot,
        productImageUrl: item.product_thumbnail_url_snapshot,
        storeName: item.store_name_snapshot,
        regionLabel: item.store ? buildRegionLabel(item.store) : null,
        pickedUpAt: item.order?.picked_up_at ?? null,
      })),
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
    };
  }

  async writeReview(
    accountId: bigint,
    input: WriteReviewInput,
  ): Promise<MyReview> {
    // rating·content 길이는 DTO가 담당. 미디어 카운트와 URL 소유권(이 계정에 발급된 publicUrl) 같은 도메인 invariant만 여기서.
    this.validateMedia(accountId, input.media);

    const orderItemId = parseId(input.orderItemId);
    const orderItem = await this.reviewRepo.findOrderItemForReview({
      orderItemId,
      accountId,
    });

    if (!orderItem) {
      throw new DomainException('ORDER_ITEM_NOT_FOUND');
    }

    if (orderItem.order.status !== OrderStatus.PICKED_UP) {
      throw new DomainException('CANNOT_WRITE_REVIEW');
    }

    if (orderItem.review && !orderItem.review.deleted_at) {
      throw new DomainException('REVIEW_ALREADY_EXISTS');
    }

    const existingDeletedReviewId = orderItem.review?.deleted_at
      ? orderItem.review.id
      : undefined;

    const review = await this.reviewRepo.createOrRestoreReviewWithMedia({
      orderItemId,
      accountId,
      storeId: orderItem.store_id,
      productId: orderItem.product_id,
      rating: input.rating,
      content: input.content.trim(),
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
    input?: MyReviewsInput,
  ): Promise<MyReviewConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 20;

    const { items, totalCount } = await this.reviewRepo.listMyReviews({
      accountId,
      offset,
      limit,
    });

    return {
      items: items.map((r) => this.mapReview(r)),
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
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
      throw new DomainException('ORDER_ITEM_NOT_FOUND');
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
      throw new DomainException('REVIEW_NOT_FOUND');
    }

    return true;
  }

  async createReviewMediaUploadUrl(
    accountId: bigint,
    input: CreateReviewMediaUploadUrlInput,
  ): Promise<CreateUploadUrlOutput> {
    const purpose: UploadPurpose =
      input.mediaType === 'VIDEO' ? 'REVIEW_VIDEO' : 'REVIEW_IMAGE';

    return this.s3Service.createUploadUrl({
      accountId,
      purpose,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }

  private validateMedia(
    accountId: bigint,
    media?: { mediaType: string; mediaUrl: string; thumbnailUrl?: string }[],
  ): void {
    if (!media || media.length === 0) return;

    let imageCount = 0;
    let videoCount = 0;
    for (const m of media) {
      if (m.mediaType === 'VIDEO') videoCount++;
      else imageCount++;
    }

    if (imageCount > MAX_IMAGE_COUNT) {
      throw new DomainException('TOO_MANY_IMAGES');
    }
    if (videoCount > MAX_VIDEO_COUNT) {
      throw new DomainException('TOO_MANY_VIDEOS');
    }

    // 미디어 URL은 저장 시 그대로 노출되므로 이 계정에 발급된 publicUrl만 받는다.
    // 썸네일은 mediaType과 무관하게 IMAGE 용도로 발급된다. null은 미제공(undefined)과 같다.
    for (const m of media) {
      const purpose: UploadPurpose =
        m.mediaType === 'VIDEO' ? 'REVIEW_VIDEO' : 'REVIEW_IMAGE';
      const owned =
        this.s3Service.isOwnedUploadUrl(m.mediaUrl, purpose, accountId) &&
        (m.thumbnailUrl == null ||
          this.s3Service.isOwnedUploadUrl(
            m.thumbnailUrl,
            'REVIEW_IMAGE',
            accountId,
          ));
      if (!owned) {
        throw new DomainException('INVALID_MEDIA_URL');
      }
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
      productImageUrl: r.order_item?.product_thumbnail_url_snapshot ?? null,
      storeName: r.order_item?.store_name_snapshot ?? '',
      rating,
      content: r.content,
      media: (r.media ?? []).map(toReviewMedia),
      createdAt: r.created_at,
    };
  }
}
