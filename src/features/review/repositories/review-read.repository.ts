import { Injectable } from '@nestjs/common';

import { Prisma, type ReviewMediaType } from '@/generated/prisma/client';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

/** 목록 범위. 상품 리뷰는 상품·매장 가시성, 매장 리뷰는 매장 가시성만 가드한다(D34: 현행 유지). */
export type ReviewScope =
  { kind: 'product'; productId: bigint } | { kind: 'store'; storeId: bigint };

export interface ReviewMediaRow {
  media_type: ReviewMediaType;
  media_url: string;
  thumbnail_url: string | null;
  sort_order: number;
}

/** 리뷰 작성자 프로필 row(탈퇴 여부 포함, 매퍼에서 익명화). */
export interface ReviewAuthorRow {
  user_profile: {
    nickname: string;
    profile_image_url: string | null;
    deleted_at: Date | null;
  } | null;
}

/** 상품 리뷰 카드 매퍼 입력(리뷰 상세도 같은 shape). */
export interface ProductReviewRow {
  id: bigint;
  rating: Prisma.Decimal;
  content: string | null;
  created_at: Date;
  account: ReviewAuthorRow;
  media: ReviewMediaRow[];
  order_item: {
    option_items: {
      group_name_snapshot: string;
      option_title_snapshot: string;
    }[];
  };
}

/** 매장 리뷰 카드 매퍼 입력. */
export interface StoreReviewRow {
  id: bigint;
  rating: Prisma.Decimal;
  content: string | null;
  created_at: Date;
  account: {
    user_profile: { nickname: string; deleted_at: Date | null } | null;
  };
  media: ReviewMediaRow[];
  order_item: { product_name_snapshot: string };
}

/** 목록 hydrate row — 두 카드가 필요한 컬럼의 합집합 1벌. */
export interface ReviewListRow extends ProductReviewRow {
  order_item: ProductReviewRow['order_item'] & StoreReviewRow['order_item'];
}

/** 홈 제작 후기 쇼케이스 row. */
export interface ShowcaseReviewRow {
  id: bigint;
  store_id: bigint;
  content: string | null;
  account: {
    user_profile: { nickname: string; deleted_at: Date | null } | null;
  };
  media: { media_url: string }[];
  order_item: { free_edits: { crop_image_url: string }[] };
}

/**
 * 공개 리뷰 읽기 전용 repository. 상품·매장 리뷰 목록과 홈 쇼케이스가 공유한다.
 * 쓰기(작성·수정·삭제)는 user feature의 ReviewRepository 소관.
 */
@Injectable()
export class ReviewReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  private publicReviewWhere(
    scope: ReviewScope,
    photoOnly: boolean,
  ): Prisma.ReviewWhereInput {
    return {
      ...activeWhere,
      store: visibleWhere,
      ...(scope.kind === 'product'
        ? { product_id: scope.productId, product: visibleWhere }
        : { store_id: scope.storeId }),
      ...(photoOnly ? { media: { some: activeWhere } } : {}),
    };
  }

  /** 리뷰 id 페이지(최신순, 커서 id desc). */
  async listReviewIdsLatest(args: {
    scope: ReviewScope;
    photoOnly: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<bigint[]> {
    const rows = await this.prisma.review.findMany({
      where: {
        ...this.publicReviewWhere(args.scope, args.photoOnly),
        // 0n도 유효 인자(parseId("0")=0n). truthiness는 0n을 falsy로 떨궈
        // zero cursor가 페이지를 리셋하므로 undefined로만 분기한다.
        ...(args.cursor !== undefined ? { id: { lt: args.cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
    return rows.map((row) => row.id);
  }

  /**
   * 리뷰 id 페이지(좋아요순 desc, 동률이면 id desc).
   *
   * soft-delete된 좋아요를 제외한 집계 기준 정렬이 Prisma orderBy(_count)로는
   * 불가능하므로 raw 키셋 페이지네이션으로 조회한다. 커서는 이전 페이지 경계의
   * (likeCount, id) 값을 그대로 받아 이어간다 — 경계 리뷰의 좋아요 수가 요청
   * 사이에 변해도 페이지가 중복/누락되지 않는다.
   */
  async listReviewIdsByLikes(args: {
    scope: ReviewScope;
    photoOnly: boolean;
    limit: number;
    cursor?: { likeCount: number; id: bigint };
  }): Promise<{ id: bigint; likeCount: number }[]> {
    const scopeJoin =
      args.scope.kind === 'product'
        ? Prisma.sql`JOIN product p
            ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
          JOIN store s
            ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL`
        : Prisma.sql`JOIN store s
            ON s.id = r.store_id AND s.is_active = 1 AND s.deleted_at IS NULL`;
    const scopeWhere =
      args.scope.kind === 'product'
        ? Prisma.sql`r.product_id = ${args.scope.productId}`
        : Prisma.sql`r.store_id = ${args.scope.storeId}`;
    const photoFilter = args.photoOnly
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM review_media m
          WHERE m.review_id = r.id AND m.deleted_at IS NULL
        )`
      : Prisma.empty;
    const cursorHaving =
      args.cursor !== undefined
        ? Prisma.sql`HAVING COUNT(l.id) < ${args.cursor.likeCount}
          OR (COUNT(l.id) = ${args.cursor.likeCount} AND r.id < ${args.cursor.id})`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { id: bigint; like_count: bigint }[]
    >(Prisma.sql`
      SELECT r.id AS id, COUNT(l.id) AS like_count
      FROM review r
      ${scopeJoin}
      LEFT JOIN review_like l
        ON l.review_id = r.id AND l.deleted_at IS NULL
      WHERE ${scopeWhere} AND r.deleted_at IS NULL
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

  /** 범위 내 활성 리뷰 수(photoOnly=true면 사진 리뷰 수). 비가시 매장/상품은 0. */
  async countReviews(args: {
    scope: ReviewScope;
    photoOnly: boolean;
  }): Promise<number> {
    return this.prisma.review.count({
      where: this.publicReviewWhere(args.scope, args.photoOnly),
    });
  }

  /** id 페이지의 리뷰 본문 row 일괄 조회(정렬은 service에서 id 순서로 복원). */
  async findReviewRowsByIds(reviewIds: bigint[]): Promise<ReviewListRow[]> {
    if (reviewIds.length === 0) return [];
    return this.prisma.review.findMany({
      where: { id: { in: reviewIds } },
      select: {
        id: true,
        rating: true,
        content: true,
        created_at: true,
        account: {
          // soft-delete extension은 nested relation에 deleted_at을 주입하지 않으므로
          // deleted_at을 함께 읽어 탈퇴 작성자는 매퍼에서 익명화한다
          select: {
            user_profile: {
              select: {
                nickname: true,
                profile_image_url: true,
                deleted_at: true,
              },
            },
          },
        },
        media: {
          where: activeWhere,
          orderBy: { sort_order: 'asc' },
          select: {
            media_type: true,
            media_url: true,
            thumbnail_url: true,
            sort_order: true,
          },
        },
        order_item: {
          select: {
            product_name_snapshot: true,
            option_items: {
              where: activeWhere,
              orderBy: { id: 'asc' },
              select: {
                group_name_snapshot: true,
                option_title_snapshot: true,
              },
            },
          },
        },
      },
    });
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

  /** 리뷰별 댓글 수. */
  async aggregateCommentCounts(
    reviewIds: bigint[],
  ): Promise<Map<bigint, number>> {
    if (reviewIds.length === 0) return new Map();
    const rows = await this.prisma.reviewComment.groupBy({
      by: ['review_id'],
      where: { review_id: { in: reviewIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.review_id, r._count._all]));
  }

  /**
   * 홈 제작 후기 쇼케이스 후보 id(전체기간 좋아요순 desc, 동률이면 id desc).
   *
   * Before(주문 커스텀 자유편집 크롭)/After(리뷰 이미지)가 모두 있는 리뷰만
   * 후보로 삼는다 — 대비 연출이 섹션의 본질이라 한쪽 없는 카드는 제외.
   * 목록 좋아요순과 형태가 달라(범위 필터·커서 없음, EXISTS 2) SQL을 따로 둔다.
   */
  async listShowcaseReviewIdsByLikes(
    limit: number,
  ): Promise<{ id: bigint; likeCount: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { id: bigint; like_count: bigint }[]
    >(Prisma.sql`
      SELECT r.id AS id, COUNT(l.id) AS like_count
      FROM review r
      JOIN product p
        ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
      JOIN store s
        ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
      LEFT JOIN review_like l
        ON l.review_id = r.id AND l.deleted_at IS NULL
      WHERE r.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM review_media m
          WHERE m.review_id = r.id
            AND m.deleted_at IS NULL
            AND m.media_type = 'IMAGE'
        )
        AND EXISTS (
          SELECT 1 FROM order_item_custom_free_edit fe
          WHERE fe.order_item_id = r.order_item_id AND fe.deleted_at IS NULL
        )
      GROUP BY r.id
      ORDER BY like_count DESC, r.id DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      id: row.id,
      likeCount: Number(row.like_count),
    }));
  }

  /** 쇼케이스 id 페이지의 본문 row 일괄 조회(정렬은 service에서 id 순서로 복원). */
  async findShowcaseReviewRowsByIds(
    reviewIds: bigint[],
  ): Promise<ShowcaseReviewRow[]> {
    if (reviewIds.length === 0) return [];
    return this.prisma.review.findMany({
      where: { id: { in: reviewIds } },
      select: {
        id: true,
        store_id: true,
        content: true,
        account: {
          select: {
            user_profile: { select: { nickname: true, deleted_at: true } },
          },
        },
        media: {
          where: { ...activeWhere, media_type: 'IMAGE' },
          orderBy: { sort_order: 'asc' },
          take: 1,
          select: { media_url: true },
        },
        order_item: {
          select: {
            free_edits: {
              where: activeWhere,
              orderBy: { sort_order: 'asc' },
              take: 1,
              select: { crop_image_url: true },
            },
          },
        },
      },
    });
  }
}
