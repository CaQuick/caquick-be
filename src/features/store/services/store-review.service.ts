import { Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import {
  fetchReviewIdPage,
  ReviewListingRepository,
  type ReviewIdPage,
  type ReviewSort,
} from '@/features/review';
import { DEFAULT_STORE_REVIEWS_LIMIT } from '@/features/store/constants/store-review.constants';
import type { StoreReviewsInput } from '@/features/store/dto/inputs/store-reviews.input';
import { StoreReviewRepository } from '@/features/store/repositories/store-review.repository';
import { toStoreReview } from '@/features/store/services/store-review-mappers.helper';
import type {
  StoreReview,
  StoreReviewConnection,
} from '@/features/store/types/store-review-output.type';

@Injectable()
export class StoreReviewService {
  constructor(
    private readonly repo: StoreReviewRepository,
    private readonly listing: ReviewListingRepository,
  ) {}

  /**
   * 매장 공개 리뷰 목록(커서). 사진 필터·정렬(최신/좋아요) 지원.
   * id 페이지를 먼저 정한 뒤 본문·집계를 일괄 hydrate한다.
   */
  async storeReviews(
    input: StoreReviewsInput,
    accountId?: bigint,
  ): Promise<StoreReviewConnection> {
    const storeId = parseId(input.storeId);
    const limit = input.limit ?? DEFAULT_STORE_REVIEWS_LIMIT;
    const photoOnly = input.photoOnly ?? false;
    const sort = input.sort ?? 'LATEST';

    // photoTotalCount는 필터와 무관하게 항상 사진 리뷰 총수(productReviews와 동일 의미)
    const [idPage, totalCount, photoTotalCount] = await Promise.all([
      this.fetchReviewIdPage({
        storeId,
        photoOnly,
        sort,
        limit,
        cursorRaw: input.cursor,
      }),
      this.repo.countStoreReviews({ storeId, photoOnly: false }),
      this.repo.countStoreReviews({ storeId, photoOnly: true }),
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

  /** 정렬별 id 페이지. 커서 규약·절단은 공용 헬퍼가 단일 소스. */
  private fetchReviewIdPage(args: {
    storeId: bigint;
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
          scope: { kind: 'store', storeId: args.storeId },
          photoOnly: args.photoOnly,
          ...params,
        }),
      listLatest: (params) =>
        this.repo.listStoreReviewIdsLatest({
          storeId: args.storeId,
          photoOnly: args.photoOnly,
          ...params,
        }),
    });
  }

  /** id 페이지 순서를 유지하며 본문 + 집계(좋아요/isLiked)를 채운다. */
  private async hydrateReviews(
    reviewIds: bigint[],
    accountId?: bigint,
  ): Promise<StoreReview[]> {
    if (reviewIds.length === 0) return [];

    const [rows, likeCounts, likedIds] = await Promise.all([
      this.repo.findStoreReviewRowsByIds(reviewIds),
      this.listing.aggregateLikeCounts(reviewIds),
      accountId !== undefined
        ? this.listing.findLikedReviewIds({ reviewIds, accountId })
        : Promise.resolve(new Set<string>()),
    ]);

    const rowById = new Map(rows.map((row) => [row.id.toString(), row]));
    return reviewIds.flatMap((id) => {
      const row = rowById.get(id.toString());
      // id 페이지 조회와 hydrate 사이에 삭제된 리뷰는 건너뛴다
      if (!row) return [];
      return [
        toStoreReview(
          row,
          likeCounts.get(row.id) ?? 0,
          likedIds.has(row.id.toString()),
        ),
      ];
    });
  }
}
