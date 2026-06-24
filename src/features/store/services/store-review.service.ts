import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { DEFAULT_STORE_REVIEWS_LIMIT } from '@/features/store/constants/store-review.constants';
import type { StoreReviewsInput } from '@/features/store/dto/inputs/store-reviews.input';
import { StoreReviewRepository } from '@/features/store/repositories/store-review.repository';
import { toStoreReview } from '@/features/store/services/store-review-mappers.helper';
import type { StoreReviewConnection } from '@/features/store/types/store-review-output.type';

@Injectable()
export class StoreReviewService {
  constructor(private readonly repo: StoreReviewRepository) {}

  /**
   * 매장 공개 리뷰 목록(커서). soft-delete 제외, 최신순.
   * 좋아요 수는 집계, isLiked는 로그인 사용자에 한해 채운다(비로그인 false).
   */
  async storeReviews(
    input: StoreReviewsInput,
    accountId?: bigint,
  ): Promise<StoreReviewConnection> {
    const storeId = parseId(input.storeId);
    const limit = input.limit ?? DEFAULT_STORE_REVIEWS_LIMIT;

    const [rows, totalCount] = await Promise.all([
      this.repo.listStoreReviews({
        storeId,
        limit,
        cursor: input.cursor ? parseId(input.cursor) : undefined,
      }),
      this.repo.countStoreReviews(storeId),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const reviewIds = page.map((row) => row.id);

    const [likeCounts, likedIds] = await Promise.all([
      this.repo.aggregateLikeCounts(reviewIds),
      accountId !== undefined
        ? this.repo.findLikedReviewIds({ reviewIds, accountId })
        : Promise.resolve(new Set<string>()),
    ]);

    return {
      items: page.map((row) =>
        toStoreReview(
          row,
          likeCounts.get(row.id) ?? 0,
          likedIds.has(row.id.toString()),
        ),
      ),
      totalCount,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1].id.toString() : null,
    };
  }
}
