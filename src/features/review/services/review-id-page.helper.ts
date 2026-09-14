import { parseId } from '@/common/utils/id-parser';
import {
  buildCountIdCursor,
  parseCountIdCursor,
} from '@/common/utils/keyset-cursor';
import { sliceCursorPage } from '@/common/utils/pagination';
import type { ReviewLikeRankRow } from '@/features/review/types/review-listing.type';

/** 리뷰 목록 정렬. SDL의 ReviewSort와 1:1. */
export type ReviewSort = 'LATEST' | 'LIKES';

export interface ReviewIdPage {
  pageIds: bigint[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * 정렬별 리뷰 id 페이지 + 다음 커서 계산.
 *
 * 상품 리뷰와 매장 리뷰가 이 45줄을 각각 갖고 있었다(조회 메서드 이름만 달랐다).
 * 조회를 콜백으로 받아 한 벌로 합친다.
 *
 * 커서 규약:
 * - 좋아요순은 "<likeCount>:<id>" 불투명 토큰 — 경계 시점의 좋아요 수를 담아,
 *   이후 좋아요 수가 변해도 페이지가 중복/누락되지 않는다.
 * - 최신순은 마지막 리뷰 id.
 * - 커서는 동일 sort 안에서만 유효하다(정렬이 바뀌면 무효).
 */
export async function fetchReviewIdPage(args: {
  sort: ReviewSort;
  limit: number;
  cursorRaw?: string;
  listByLikes: (params: {
    limit: number;
    cursor?: { count: number; id: bigint };
  }) => Promise<ReviewLikeRankRow[]>;
  listLatest: (params: { limit: number; cursor?: bigint }) => Promise<bigint[]>;
}): Promise<ReviewIdPage> {
  if (args.sort === 'LIKES') {
    const rows = await args.listByLikes({
      limit: args.limit,
      cursor: args.cursorRaw
        ? parseCountIdCursor(args.cursorRaw, 'INVALID_LIKES_CURSOR')
        : undefined,
    });
    const page = sliceCursorPage(rows, args.limit, (last) =>
      buildCountIdCursor(last.likeCount, last.id),
    );
    return {
      pageIds: page.items.map((row) => row.id),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  const ids = await args.listLatest({
    limit: args.limit,
    // 0n도 유효 커서(parseId("0")=0n)라 truthiness 로 떨구지 않는다
    cursor: args.cursorRaw !== undefined ? parseId(args.cursorRaw) : undefined,
  });
  const page = sliceCursorPage(ids, args.limit, (last) => last.toString());
  return {
    pageIds: page.items,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}
