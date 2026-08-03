import { Injectable, NotFoundException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { PRODUCT_REVIEW_ERRORS } from '@/features/product/constants/product-review-error-messages';
import {
  DEFAULT_PRODUCT_REVIEWS_LIMIT,
  DEFAULT_REVIEW_COMMENTS_LIMIT,
} from '@/features/product/constants/product-review.constants';
import type { ProductReviewsInput } from '@/features/product/dto/inputs/product-reviews.input';
import type { ReviewCommentsInput } from '@/features/product/dto/inputs/review-comments.input';
import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import {
  toProductReview,
  toReviewCommentItem,
  toReviewDetailProduct,
} from '@/features/product/services/product-review-mappers.helper';
import type {
  ProductReview,
  ProductReviewConnection,
  ReviewCommentConnection,
  ReviewDetail,
} from '@/features/product/types/product-review-output.type';

@Injectable()
export class ProductReviewService {
  constructor(private readonly repo: ProductReviewRepository) {}

  /**
   * 상품 공개 리뷰 목록(커서). 사진 필터·정렬(최신/좋아요) 지원.
   * id 페이지를 먼저 정한 뒤 본문·집계를 일괄 hydrate한다.
   */
  async productReviews(
    input: ProductReviewsInput,
    accountId?: bigint,
  ): Promise<ProductReviewConnection> {
    const productId = parseId(input.productId);
    const limit = input.limit ?? DEFAULT_PRODUCT_REVIEWS_LIMIT;
    const photoOnly = input.photoOnly ?? false;
    const sort = input.sort ?? 'LATEST';
    const cursor = input.cursor ? parseId(input.cursor) : undefined;

    const [ids, totalCount, photoTotalCount] = await Promise.all([
      sort === 'LIKES'
        ? this.repo.listProductReviewIdsByLikes({
            productId,
            photoOnly,
            limit,
            cursor,
          })
        : this.repo.listProductReviewIdsLatest({
            productId,
            photoOnly,
            limit,
            cursor,
          }),
      this.repo.countProductReviews({ productId, photoOnly: false }),
      this.repo.countProductReviews({ productId, photoOnly: true }),
    ]);

    const hasMore = ids.length > limit;
    const pageIds = hasMore ? ids.slice(0, limit) : ids;
    const items = await this.hydrateReviews(pageIds, accountId);

    return {
      items,
      totalCount,
      photoTotalCount,
      hasMore,
      nextCursor: hasMore ? pageIds[pageIds.length - 1].toString() : null,
    };
  }

  /** 리뷰 상세(본문 + 현재 상품 기준 판매 케이크 정보). 없으면 NOT_FOUND. */
  async reviewDetail(
    reviewIdRaw: string,
    accountId?: bigint,
  ): Promise<ReviewDetail> {
    const reviewId = parseId(reviewIdRaw);
    const row = await this.repo.findReviewDetailById(reviewId);
    if (!row) {
      throw new NotFoundException(PRODUCT_REVIEW_ERRORS.REVIEW_NOT_FOUND);
    }

    const [likeCounts, likedIds, commentCounts] = await Promise.all([
      this.repo.aggregateLikeCounts([reviewId]),
      accountId !== undefined
        ? this.repo.findLikedReviewIds({ reviewIds: [reviewId], accountId })
        : Promise.resolve(new Set<string>()),
      this.repo.aggregateCommentCounts([reviewId]),
    ]);

    return {
      review: toProductReview(row, {
        likeCount: likeCounts.get(reviewId) ?? 0,
        isLiked: likedIds.has(reviewId.toString()),
        commentCount: commentCounts.get(reviewId) ?? 0,
      }),
      product: toReviewDetailProduct(row.product),
    };
  }

  /** 리뷰 댓글 목록(등록순, 커서). 리뷰가 없으면 NOT_FOUND. */
  async reviewComments(
    input: ReviewCommentsInput,
    accountId?: bigint,
  ): Promise<ReviewCommentConnection> {
    const reviewId = parseId(input.reviewId);
    const exists = await this.repo.existsPublicReview(reviewId);
    if (!exists) {
      throw new NotFoundException(PRODUCT_REVIEW_ERRORS.REVIEW_NOT_FOUND);
    }

    const limit = input.limit ?? DEFAULT_REVIEW_COMMENTS_LIMIT;
    const [rows, totalCount] = await Promise.all([
      this.repo.listReviewComments({
        reviewId,
        limit,
        cursor: input.cursor ? parseId(input.cursor) : undefined,
      }),
      this.repo.countReviewComments(reviewId),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map((row) => toReviewCommentItem(row, accountId)),
      totalCount,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1].id.toString() : null,
    };
  }

  /** id 페이지 순서를 유지하며 본문 + 집계(좋아요/댓글/isLiked)를 채운다. */
  private async hydrateReviews(
    reviewIds: bigint[],
    accountId?: bigint,
  ): Promise<ProductReview[]> {
    if (reviewIds.length === 0) return [];

    const [rows, likeCounts, likedIds, commentCounts] = await Promise.all([
      this.repo.findProductReviewRowsByIds(reviewIds),
      this.repo.aggregateLikeCounts(reviewIds),
      accountId !== undefined
        ? this.repo.findLikedReviewIds({ reviewIds, accountId })
        : Promise.resolve(new Set<string>()),
      this.repo.aggregateCommentCounts(reviewIds),
    ]);

    const rowById = new Map(rows.map((row) => [row.id.toString(), row]));
    return reviewIds.flatMap((id) => {
      const row = rowById.get(id.toString());
      // id 페이지 조회와 hydrate 사이에 삭제된 리뷰는 건너뛴다
      if (!row) return [];
      return [
        toProductReview(row, {
          likeCount: likeCounts.get(row.id) ?? 0,
          isLiked: likedIds.has(row.id.toString()),
          commentCount: commentCounts.get(row.id) ?? 0,
        }),
      ];
    });
  }
}
