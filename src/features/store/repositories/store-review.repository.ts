import { Injectable } from '@nestjs/common';
import { Prisma, type ReviewMediaType } from '@prisma/client';

import { PrismaService } from '@/prisma';

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

  /** 매장 공개 리뷰 목록(최신순, 커서 id desc). soft-delete 제외. */
  async listStoreReviews(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
  }): Promise<StoreReviewRow[]> {
    return this.prisma.review.findMany({
      where: {
        store_id: args.storeId,
        deleted_at: null,
        // storeDetail과 동일하게 비활성/삭제 매장의 리뷰는 노출하지 않는다
        store: { is_active: true, deleted_at: null },
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
      },
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
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          select: {
            media_type: true,
            media_url: true,
            thumbnail_url: true,
            sort_order: true,
          },
        },
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  /** 매장 활성 리뷰 수(후기 탭 카운트). 비활성/삭제 매장은 0. */
  async countStoreReviews(storeId: bigint): Promise<number> {
    return this.prisma.review.count({
      where: {
        store_id: storeId,
        deleted_at: null,
        store: { is_active: true, deleted_at: null },
      },
    });
  }

  /** 리뷰별 좋아요 수. */
  async aggregateLikeCounts(reviewIds: bigint[]): Promise<Map<bigint, number>> {
    if (reviewIds.length === 0) return new Map();
    const rows = await this.prisma.reviewLike.groupBy({
      by: ['review_id'],
      where: { review_id: { in: reviewIds }, deleted_at: null },
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
        deleted_at: null,
      },
      select: { review_id: true },
    });
    return new Set(rows.map((r) => r.review_id.toString()));
  }
}
