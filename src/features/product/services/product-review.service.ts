import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import { sliceCursorPage } from '@/common/utils/pagination';
import { DEFAULT_REVIEW_COMMENTS_LIMIT } from '@/features/product/constants/product-review.constants';
import type { ReviewCommentsInput } from '@/features/product/dto/inputs/review-comments.input';
import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import {
  toReviewCommentItem,
  toReviewDetailProduct,
} from '@/features/product/services/product-review-mappers.helper';
import type {
  ReviewCommentConnection,
  ReviewDetail,
} from '@/features/product/types/product-review-output.type';
import { ReviewReadRepository, toProductReview } from '@/features/review';

@Injectable()
export class ProductReviewService {
  constructor(
    private readonly repo: ProductReviewRepository,
    private readonly reviews: ReviewReadRepository,
  ) {}

  async reviewDetail(
    reviewIdRaw: string,
    accountId?: bigint,
  ): Promise<ReviewDetail> {
    const reviewId = parseId(reviewIdRaw);
    const row = await this.repo.findReviewDetailById(reviewId);
    if (!row) {
      throw new DomainException('REVIEW_NOT_FOUND');
    }

    const [likeCounts, likedIds, commentCounts] = await Promise.all([
      this.reviews.aggregateLikeCounts([reviewId]),
      accountId !== undefined
        ? this.reviews.findLikedReviewIds({ reviewIds: [reviewId], accountId })
        : Promise.resolve(new Set<string>()),
      this.reviews.aggregateCommentCounts([reviewId]),
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

  async reviewComments(
    input: ReviewCommentsInput,
    accountId?: bigint,
  ): Promise<ReviewCommentConnection> {
    const reviewId = parseId(input.reviewId);
    const exists = await this.repo.existsPublicReview(reviewId);
    if (!exists) {
      throw new DomainException('REVIEW_NOT_FOUND');
    }

    const limit = input.limit ?? DEFAULT_REVIEW_COMMENTS_LIMIT;
    const [rows, totalCount] = await Promise.all([
      this.repo.listReviewComments({
        reviewId,
        limit,
        cursor: input.cursor ? parseIdCursor(input.cursor) : undefined,
      }),
      this.repo.countReviewComments(reviewId),
    ]);

    const page = sliceCursorPage(rows, limit, (last) => last.id.toString());

    return {
      items: page.items.map((row) => toReviewCommentItem(row, accountId)),
      totalCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}
