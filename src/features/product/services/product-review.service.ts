import { Injectable } from '@nestjs/common';

import { domainError } from '@/common/errors';
import { parseId } from '@/common/utils/id-parser';
import { sliceCursorPage } from '@/common/utils/pagination';
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
import {
  fetchReviewIdPage,
  ReviewListingRepository,
  type ReviewIdPage,
  type ReviewSort,
} from '@/features/review';

@Injectable()
export class ProductReviewService {
  constructor(
    private readonly repo: ProductReviewRepository,
    private readonly listing: ReviewListingRepository,
  ) {}

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

    const [idPage, totalCount, photoTotalCount] = await Promise.all([
      this.fetchReviewIdPage({
        productId,
        photoOnly,
        sort,
        limit,
        cursorRaw: input.cursor,
      }),
      this.repo.countProductReviews({ productId, photoOnly: false }),
      this.repo.countProductReviews({ productId, photoOnly: true }),
    ]);

    const items = await this.hydrateReviews(idPage.pageIds, accountId);

    return {
      items,
      totalCount,
      photoTotalCount,
      hasMore: idPage.hasMore,
      nextCursor: idPage.nextCursor,
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
      throw domainError('REVIEW_NOT_FOUND');
    }

    const [likeCounts, likedIds, commentCounts] = await Promise.all([
      this.listing.aggregateLikeCounts([reviewId]),
      accountId !== undefined
        ? this.listing.findLikedReviewIds({ reviewIds: [reviewId], accountId })
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
      throw domainError('REVIEW_NOT_FOUND');
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

    const page = sliceCursorPage(rows, limit, (last) => last.id.toString());

    return {
      items: page.items.map((row) => toReviewCommentItem(row, accountId)),
      totalCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  /** 정렬별 id 페이지. 커서 규약·절단은 공용 헬퍼가 단일 소스. */
  private fetchReviewIdPage(args: {
    productId: bigint;
    photoOnly: boolean;
    sort: ReviewSort;
    limit: number;
    cursorRaw?: string;
  }): Promise<ReviewIdPage> {
    return fetchReviewIdPage({
      sort: args.sort,
      limit: args.limit,
      cursorRaw: args.cursorRaw,
      listByLikes: (params) =>
        this.listing.listReviewIdsByLikes({
          scope: { kind: 'product', productId: args.productId },
          photoOnly: args.photoOnly,
          ...params,
        }),
      listLatest: (params) =>
        this.repo.listProductReviewIdsLatest({
          productId: args.productId,
          photoOnly: args.photoOnly,
          ...params,
        }),
    });
  }

  /** id 페이지 순서를 유지하며 본문 + 집계(좋아요/댓글/isLiked)를 채운다. */
  private async hydrateReviews(
    reviewIds: bigint[],
    accountId?: bigint,
  ): Promise<ProductReview[]> {
    if (reviewIds.length === 0) return [];

    const [rows, likeCounts, likedIds, commentCounts] = await Promise.all([
      this.repo.findProductReviewRowsByIds(reviewIds),
      this.listing.aggregateLikeCounts(reviewIds),
      accountId !== undefined
        ? this.listing.findLikedReviewIds({ reviewIds, accountId })
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
