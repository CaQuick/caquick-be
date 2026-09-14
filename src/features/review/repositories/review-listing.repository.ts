import { Injectable } from '@nestjs/common';

import type { CountIdCursor } from '@/common/utils/keyset-cursor';
import type {
  ReviewLikeRankRow,
  ReviewLikesScope,
} from '@/features/review/types/review-listing.type';
import { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/**
 * 리뷰 목록 조회의 공용 부분(좋아요 집계·좋아요순 키셋 페이지).
 *
 * 상품 리뷰·매장 리뷰·홈 쇼케이스가 같은 코드를 각각 갖고 있었다 — 좋아요 집계와
 * 내가 누른 id 조회는 바이트 단위로 같았고, 좋아요순 raw SQL은 JOIN·WHERE만 달랐다.
 * 화면별 고유 조회(본문 row·댓글·카운트)는 각 feature repository에 남는다.
 */
@Injectable()
export class ReviewListingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 좋아요순 리뷰 id 페이지(좋아요 desc, 동률이면 id desc).
   *
   * soft-delete된 좋아요를 제외한 집계 기준 정렬이 Prisma orderBy(_count)로는
   * 불가능해 raw 키셋 페이지네이션을 쓴다. 커서는 이전 페이지 경계의
   * (likeCount, id)를 그대로 받아 이어간다 — 경계 리뷰의 좋아요 수가 요청 사이에
   * 변해도 페이지가 중복/누락되지 않는다.
   */
  async listReviewIdsByLikes(args: {
    scope: ReviewLikesScope;
    photoOnly?: boolean;
    limit: number;
    cursor?: CountIdCursor;
  }): Promise<ReviewLikeRankRow[]> {
    const { scopeJoin, scopeWhere, extraWhere } = this.buildScopeSql(
      args.scope,
    );

    const photoFilter = args.photoOnly
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM review_media m
          WHERE m.review_id = r.id AND m.deleted_at IS NULL
        )`
      : Prisma.empty;

    const cursorHaving =
      args.cursor !== undefined
        ? Prisma.sql`HAVING COUNT(l.id) < ${args.cursor.count}
          OR (COUNT(l.id) = ${args.cursor.count} AND r.id < ${args.cursor.id})`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { id: bigint; like_count: bigint }[]
    >(Prisma.sql`
      SELECT r.id AS id, COUNT(l.id) AS like_count
      FROM review r
      ${scopeJoin}
      LEFT JOIN review_like l
        ON l.review_id = r.id AND l.deleted_at IS NULL
      WHERE r.deleted_at IS NULL
      ${scopeWhere}
      ${extraWhere}
      ${photoFilter}
      GROUP BY r.id
      ${cursorHaving}
      ORDER BY like_count DESC, r.id DESC
      LIMIT ${args.limit + 1}
    `);

    return rows.map((row) => ({
      id: row.id,
      likeCount: Number(row.like_count),
    }));
  }

  /** 리뷰별 좋아요 수. */
  async aggregateLikeCounts(reviewIds: bigint[]): Promise<Map<bigint, number>> {
    if (reviewIds.length === 0) return new Map();
    const rows = await this.prisma.reviewLike.groupBy({
      by: ['review_id'],
      where: { review_id: { in: reviewIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.review_id, r._count._all]));
  }

  /** 로그인 사용자가 좋아요한 review_id 집합(string). */
  async findLikedReviewIds(args: {
    reviewIds: bigint[];
    accountId: bigint;
  }): Promise<Set<string>> {
    if (args.reviewIds.length === 0) return new Set();
    const rows = await this.prisma.reviewLike.findMany({
      where: {
        review_id: { in: args.reviewIds },
        account_id: args.accountId,
      },
      select: { review_id: true },
    });
    return new Set(rows.map((r) => r.review_id.toString()));
  }

  /**
   * 범위별 JOIN·WHERE 조각.
   *
   * raw SQL이라 soft-delete extension이 닿지 않는다 — 가시성 조건(is_active,
   * deleted_at)을 여기서 명시한다. 상품 범위는 상품과 그 매장을 모두 확인한다.
   */
  private buildScopeSql(scope: ReviewLikesScope): {
    scopeJoin: Prisma.Sql;
    scopeWhere: Prisma.Sql;
    extraWhere: Prisma.Sql;
  } {
    switch (scope.kind) {
      case 'product':
        return {
          scopeJoin: Prisma.sql`
            JOIN product p
              ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
            JOIN store s
              ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL`,
          scopeWhere: Prisma.sql`AND r.product_id = ${scope.productId}`,
          extraWhere: Prisma.empty,
        };
      case 'store':
        return {
          scopeJoin: Prisma.sql`
            JOIN store s
              ON s.id = r.store_id AND s.is_active = 1 AND s.deleted_at IS NULL`,
          scopeWhere: Prisma.sql`AND r.store_id = ${scope.storeId}`,
          extraWhere: Prisma.empty,
        };
      case 'showcase':
        return {
          scopeJoin: Prisma.sql`
            JOIN product p
              ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
            JOIN store s
              ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL`,
          scopeWhere: Prisma.empty,
          // Before(주문 커스텀 자유편집 크롭)/After(리뷰 이미지)가 모두 있어야 한다 —
          // 대비 연출이 섹션의 본질이라 한쪽 없는 카드는 제외(정책 확정).
          extraWhere: Prisma.sql`
            AND EXISTS (
              SELECT 1 FROM review_media m
              WHERE m.review_id = r.id
                AND m.deleted_at IS NULL
                AND m.media_type = 'IMAGE'
            )
            AND EXISTS (
              SELECT 1 FROM order_item_custom_free_edit fe
              WHERE fe.order_item_id = r.order_item_id AND fe.deleted_at IS NULL
            )`,
        };
    }
  }
}
