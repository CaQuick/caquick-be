import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import {
  parseIdCursor,
  parseNumberIdCursor,
} from '@/common/utils/keyset-cursor';
import { sliceCursorPage } from '@/common/utils/pagination';
import {
  DEFAULT_REVIEWS_LIMIT,
  type ReviewSort,
} from '@/features/review/constants/review.constants';
import type { ProductReviewsInput } from '@/features/review/dto/inputs/product-reviews.input';
import type { StoreReviewsInput } from '@/features/review/dto/inputs/store-reviews.input';
import {
  ReviewReadRepository,
  type ReviewListRow,
  type ReviewScope,
} from '@/features/review/repositories/review-read.repository';
import {
  toProductReview,
  toStoreReview,
} from '@/features/review/services/review-listing-mappers.helper';
import type {
  ProductReviewConnection,
  StoreReviewConnection,
} from '@/features/review/types/review-listing-output.type';

interface ListingArgs {
  photoOnly?: boolean;
  sort?: ReviewSort;
  cursor?: string;
  limit?: number;
}

interface ListingPage {
  rows: ReviewListRow[];
  likeCounts: Map<bigint, number>;
  likedIds: Set<string>;
  commentCounts: Map<bigint, number>;
  totalCount: number;
  photoTotalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/** id 페이지 → hydrate → 좋아요 집계 → 내가 누른 id 순서로 한 파이프라인을 타고, 범위(product/store)와 카드 매퍼만 다르다. */
@Injectable()
export class ReviewListingService {
  constructor(private readonly repo: ReviewReadRepository) {}

  async productReviews(
    input: ProductReviewsInput,
    accountId?: bigint,
  ): Promise<ProductReviewConnection> {
    const page = await this.listPage(
      { kind: 'product', productId: parseId(input.productId) },
      input,
      accountId,
      { withCommentCount: true },
    );
    return {
      items: page.rows.map((row) =>
        toProductReview(row, {
          likeCount: page.likeCounts.get(row.id) ?? 0,
          isLiked: page.likedIds.has(row.id.toString()),
          commentCount: page.commentCounts.get(row.id) ?? 0,
        }),
      ),
      totalCount: page.totalCount,
      photoTotalCount: page.photoTotalCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async storeReviews(
    input: StoreReviewsInput,
    accountId?: bigint,
  ): Promise<StoreReviewConnection> {
    const page = await this.listPage(
      { kind: 'store', storeId: parseId(input.storeId) },
      input,
      accountId,
      { withCommentCount: false },
    );
    return {
      items: page.rows.map((row) =>
        toStoreReview(row, {
          likeCount: page.likeCounts.get(row.id) ?? 0,
          isLiked: page.likedIds.has(row.id.toString()),
        }),
      ),
      totalCount: page.totalCount,
      photoTotalCount: page.photoTotalCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  private async listPage(
    scope: ReviewScope,
    input: ListingArgs,
    accountId: bigint | undefined,
    options: { withCommentCount: boolean },
  ): Promise<ListingPage> {
    const limit = input.limit ?? DEFAULT_REVIEWS_LIMIT;
    const photoOnly = input.photoOnly ?? false;
    const sort = input.sort ?? 'LATEST';

    // photoTotalCount는 필터와 무관하게 항상 사진 리뷰 총수
    const [idPage, totalCount, photoTotalCount] = await Promise.all([
      this.fetchReviewIdPage({
        scope,
        photoOnly,
        sort,
        limit,
        cursorRaw: input.cursor,
      }),
      this.repo.countReviews({ scope, photoOnly: false }),
      this.repo.countReviews({ scope, photoOnly: true }),
    ]);

    const reviewIds = idPage.pageIds;
    const [rows, likeCounts, likedIds, commentCounts] = await Promise.all([
      this.repo.findReviewRowsByIds(reviewIds),
      this.repo.aggregateLikeCounts(reviewIds),
      accountId !== undefined
        ? this.repo.findLikedReviewIds({ reviewIds, accountId })
        : Promise.resolve(new Set<string>()),
      options.withCommentCount
        ? this.repo.aggregateCommentCounts(reviewIds)
        : Promise.resolve(new Map<bigint, number>()),
    ]);

    // id 페이지 조회와 hydrate 사이에 삭제된 리뷰는 건너뛴다
    const rowById = new Map(rows.map((row) => [row.id.toString(), row]));
    const ordered = reviewIds.flatMap((id) => {
      const row = rowById.get(id.toString());
      return row ? [row] : [];
    });

    return {
      rows: ordered,
      likeCounts,
      likedIds,
      commentCounts,
      totalCount,
      photoTotalCount,
      hasMore: idPage.hasMore,
      nextCursor: idPage.nextCursor,
    };
  }

  /** 좋아요순 커서는 경계 시점의 좋아요 수를 담아, 이후 좋아요 수가 변해도 페이지가 중복/누락되지 않는다. 커서는 동일 sort 안에서만 유효하다. */
  private async fetchReviewIdPage(args: {
    scope: ReviewScope;
    photoOnly: boolean;
    sort: ReviewSort;
    limit: number;
    cursorRaw?: string;
  }): Promise<{
    pageIds: bigint[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    if (args.sort === 'LIKES') {
      const cursor =
        args.cursorRaw !== undefined
          ? parseNumberIdCursor(args.cursorRaw, 'INVALID_LIKES_CURSOR')
          : undefined;
      const rows = await this.repo.listReviewIdsByLikes({
        scope: args.scope,
        photoOnly: args.photoOnly,
        limit: args.limit,
        cursor: cursor ? { likeCount: cursor.value, id: cursor.id } : undefined,
      });
      const page = sliceCursorPage(
        rows,
        args.limit,
        (last) => `${last.likeCount}:${last.id.toString()}`,
      );
      return {
        pageIds: page.items.map((row) => row.id),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    }

    const ids = await this.repo.listReviewIdsLatest({
      scope: args.scope,
      photoOnly: args.photoOnly,
      limit: args.limit,
      cursor:
        args.cursorRaw !== undefined
          ? parseIdCursor(args.cursorRaw)
          : undefined,
    });
    const page = sliceCursorPage(ids, args.limit, (last) => last.toString());
    return {
      pageIds: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}
