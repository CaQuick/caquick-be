import type { ReviewMediaType } from '@/generated/prisma/client';

/**
 * 리뷰 첨부 미디어 row. 상품·매장 리뷰 목록이 같은 형태를 읽는다.
 * (예전엔 두 repository가 같은 인터페이스를 각각 선언하고 있었다.)
 */
export interface ReviewMediaRow {
  media_type: ReviewMediaType;
  media_url: string;
  thumbnail_url: string | null;
  sort_order: number;
}

/**
 * 좋아요순 리뷰 id 조회의 대상 범위.
 *
 * 세 화면이 같은 raw 키셋 SQL을 쓰면서 JOIN·WHERE만 달랐다. 범위를 값으로 받아
 * SQL 한 벌로 합친다 — 가시성 조건(비활성·삭제 매장/상품 제외)이 한곳에 모인다.
 */
export type ReviewLikesScope =
  | { kind: 'product'; productId: bigint }
  | { kind: 'store'; storeId: bigint }
  /** 홈 제작 후기 쇼케이스: 범위 제한 없이 Before/After가 모두 있는 리뷰만 */
  | { kind: 'showcase' };

/** 좋아요순 페이지의 한 행. 커서가 (likeCount, id)를 이어받는다. */
export interface ReviewLikeRankRow {
  id: bigint;
  likeCount: number;
}
