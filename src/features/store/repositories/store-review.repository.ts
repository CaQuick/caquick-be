import { Injectable } from '@nestjs/common';

import type { ReviewMediaRow } from '@/features/review';
import { Prisma } from '@/generated/prisma/client';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

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
  media: ReviewMediaRow[];
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
}
