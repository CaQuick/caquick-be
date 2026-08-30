import { Injectable } from '@nestjs/common';
import { Prisma, type ReviewMediaType } from '@prisma/client';

import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

export interface StoreReviewMediaRow {
  media_type: ReviewMediaType;
  media_url: string;
  thumbnail_url: string | null;
  sort_order: number;
}

/** 매장 공개 리뷰 조회 결과 row. storeReviews 매퍼 입력. */
export interface StoreReviewRow {
  id: bigint;
  rating: Prisma.Decimal;
  content: string | null;
  created_at: Date;
  account: {
    user_profile: { nickname: string; deleted_at: Date | null } | null;
  };
  order_item: { product_name_snapshot: string };
  media: StoreReviewMediaRow[];
}

/**
 * 매장 공개 리뷰 조회 전용 repository.
 *
 * user feature의 ReviewRepository(본인 리뷰 작성/관리)와 책임이 분리된다.
 * 같은 review 테이블을 읽지만 "매장의 공개 리뷰 목록 + 좋아요 집계"는 매장 조회 유스케이스.
 */
@Injectable()
export class StoreReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 매장 공개 리뷰 공통 가드: 리뷰·매장 활성(photoOnly면 활성 미디어 존재). */
  private publicReviewWhere(photoOnly: boolean): Prisma.ReviewWhereInput {
    return {
      ...activeWhere,
      // storeDetail과 동일하게 비활성/삭제 매장의 리뷰는 노출하지 않는다
      store: visibleWhere,
      ...(photoOnly ? { media: { some: activeWhere } } : {}),
    };
  }

  /** 매장 리뷰 id 페이지(최신순, 커서 id desc). */
  async listStoreReviewIdsLatest(args: {
    storeId: bigint;
    photoOnly: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<bigint[]> {
    const rows = await this.prisma.review.findMany({
      where: {
        store_id: args.storeId,
        ...this.publicReviewWhere(args.photoOnly),
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
   * 매장 리뷰 id 페이지(좋아요순 desc, 동률이면 id desc).
   *
   * soft-delete된 좋아요를 제외한 집계 기준 정렬이 Prisma orderBy(_count)로는
   * 불가능하므로 raw 키셋 페이지네이션으로 조회한다. 커서는 이전 페이지 경계의
   * (likeCount, id) 값을 그대로 받아 이어간다 — 경계 리뷰의 좋아요 수가 요청
   * 사이에 변해도 페이지가 중복/누락되지 않는다.
   */
  async listStoreReviewIdsByLikes(args: {
    storeId: bigint;
    photoOnly: boolean;
    limit: number;
    cursor?: { likeCount: number; id: bigint };
  }): Promise<{ id: bigint; likeCount: number }[]> {
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
      JOIN store s
        ON s.id = r.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
      LEFT JOIN review_like l
        ON l.review_id = r.id AND l.deleted_at IS NULL
      WHERE r.store_id = ${args.storeId} AND r.deleted_at IS NULL
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

  /** id 페이지의 리뷰 본문 row 일괄 조회(정렬은 service에서 id 순서로 복원). */
  async findStoreReviewRowsByIds(
    reviewIds: bigint[],
  ): Promise<StoreReviewRow[]> {
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
          // deleted_at을 함께 읽어 탈퇴 작성자 닉네임은 매퍼에서 익명화한다
          select: {
            user_profile: { select: { nickname: true, deleted_at: true } },
          },
        },
        order_item: { select: { product_name_snapshot: true } },
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
      },
    });
  }

  /** 매장 활성 리뷰 수(photoOnly=true면 사진 리뷰 수). 비활성/삭제 매장은 0. */
  async countStoreReviews(args: {
    storeId: bigint;
    photoOnly: boolean;
  }): Promise<number> {
    return this.prisma.review.count({
      where: {
        store_id: args.storeId,
        ...this.publicReviewWhere(args.photoOnly),
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
}
