import { BadRequestException, Injectable } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { sliceCursorPage } from '@/common/utils/pagination';
import { STORE_REVIEW_ERRORS } from '@/features/store/constants/store-review-error-messages';
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
  constructor(private readonly repo: StoreReviewRepository) {}

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

  /**
   * 정렬별 리뷰 id 페이지 + 다음 커서 계산.
   *
   * 좋아요순 커서는 "<likeCount>:<id>" 불투명 토큰 — 경계 시점의 좋아요 수를
   * 담아, 이후 좋아요 수가 변해도 페이지가 중복/누락되지 않는다.
   * 최신순 커서는 마지막 리뷰 id. 커서는 동일 sort 안에서만 유효하다.
   */
  private async fetchReviewIdPage(args: {
    storeId: bigint;
    photoOnly: boolean;
    sort: 'LATEST' | 'LIKES';
    limit: number;
    cursorRaw?: string;
  }): Promise<{
    pageIds: bigint[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    if (args.sort === 'LIKES') {
      const rows = await this.repo.listStoreReviewIdsByLikes({
        storeId: args.storeId,
        photoOnly: args.photoOnly,
        limit: args.limit,
        cursor: args.cursorRaw
          ? this.parseLikesCursor(args.cursorRaw)
          : undefined,
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

    const ids = await this.repo.listStoreReviewIdsLatest({
      storeId: args.storeId,
      photoOnly: args.photoOnly,
      limit: args.limit,
      cursor: args.cursorRaw ? parseId(args.cursorRaw) : undefined,
    });
    const page = sliceCursorPage(ids, args.limit, (last) => last.toString());
    return {
      pageIds: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  /** 좋아요순 커서 파싱. "<likeCount>:<id>" 형식이 아니면 BAD_USER_INPUT. */
  private parseLikesCursor(raw: string): { likeCount: number; id: bigint } {
    const match = /^(\d+):(\d+)$/.exec(raw);
    if (!match) {
      throw new BadRequestException(STORE_REVIEW_ERRORS.INVALID_LIKES_CURSOR);
    }
    const likeCount = Number(match[1]);
    // 자릿수 폭탄(예: 309자리)은 Number 변환 시 Infinity가 되어 raw SQL에
    // 비유한 값이 흘러간다. 안전 정수 범위를 벗어나면 형식 오류로 거부한다.
    if (!Number.isSafeInteger(likeCount)) {
      throw new BadRequestException(STORE_REVIEW_ERRORS.INVALID_LIKES_CURSOR);
    }
    return { likeCount, id: BigInt(match[2]) };
  }

  /** id 페이지 순서를 유지하며 본문 + 집계(좋아요/isLiked)를 채운다. */
  private async hydrateReviews(
    reviewIds: bigint[],
    accountId?: bigint,
  ): Promise<StoreReview[]> {
    if (reviewIds.length === 0) return [];

    const [rows, likeCounts, likedIds] = await Promise.all([
      this.repo.findStoreReviewRowsByIds(reviewIds),
      this.repo.aggregateLikeCounts(reviewIds),
      accountId !== undefined
        ? this.repo.findLikedReviewIds({ reviewIds, accountId })
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
